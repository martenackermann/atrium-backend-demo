import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { Public } from '@/common/auth/public.decorator';
import { attachmentDtoSchema, attachmentPurposeSchema, isoDateTimeSchema } from '@/common/domain/schemas';
import { ATTACHMENT_PURPOSES } from '@/common/domain/vocabulary';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { ProblemException } from '@/common/http/problem';
import { UuidPipe } from '@/common/http/uuid.pipe';
import { AttachmentService } from './attachment.service';

/** Hard cap for the multipart parser; the configurable UPLOAD_MAX_BYTES check happens in the service. */
const MULTIPART_HARD_LIMIT = 50 * 1024 * 1024;

/** Root DTO schemas must not carry a `.meta({ id })`: copy the shape of shared schemas. */
class AttachmentDto extends createZodDto(z.object(attachmentDtoSchema.shape)) {}
class UploadAttachmentDto extends createZodDto(z.object({ purpose: attachmentPurposeSchema })) {}
class DownloadUrlQuery extends createZodDto(
  z.object({ disposition: z.enum(['attachment', 'inline']).default('attachment') }),
) {}
class DownloadUrlDto extends createZodDto(z.object({ url: z.string(), expiresAt: isoDateTimeSchema })) {}

/** RFC 6266/5987 header with an ASCII fallback and a UTF-8 file name. */
export function contentDisposition(fileName: string, type: 'inline' | 'attachment' = 'attachment'): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

@ApiTags('attachments')
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MULTIPART_HARD_LIMIT, files: 1 } }))
  @ApiOperation({ summary: 'Stage an upload; link it later by id from the owning resource' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'purpose'],
      properties: {
        file: { type: 'string', format: 'binary' },
        purpose: { type: 'string', enum: [...ATTACHMENT_PURPOSES] },
      },
    },
  })
  @ZodResponse({ type: AttachmentDto, status: 201 })
  @ApiProblemResponses(403, 413, 415, 422)
  upload(
    @CurrentUser() user: AuthUser,
    @Body() body: UploadAttachmentDto,
    @UploadedFile() file?: { buffer: Buffer; originalname: string; size: number },
  ): Promise<AttachmentDto> {
    return this.attachments.upload(user, file, body.purpose);
  }

  @Get(':id')
  @ZodResponse({ type: AttachmentDto })
  @ApiProblemResponses(404)
  async get(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<AttachmentDto> {
    return this.attachments.toView(await this.attachments.findVisible(user, id));
  }

  @Get(':id/download-url')
  @ApiOperation({ summary: 'Short-lived signed URL for GET /files/{token}' })
  @ZodResponse({ type: DownloadUrlDto })
  @ApiProblemResponses(404)
  async downloadUrl(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Query() query: DownloadUrlQuery,
  ): Promise<DownloadUrlDto> {
    const row = await this.attachments.findVisible(user, id);
    return this.attachments.downloadUrl(user, row.id, query.disposition);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Staged attachment deleted' })
  @ApiProblemResponses(404, 409)
  async remove(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<void> {
    await this.attachments.deleteStaged(user, id);
  }
}

@ApiTags('attachments')
@Public()
@Controller('files')
export class FilesController {
  constructor(private readonly attachments: AttachmentService) {}

  @Get(':token')
  @ApiOperation({ summary: 'Stream a file through a signed, expiring token (no bearer token needed)' })
  @ApiOkResponse({ description: 'File content', content: { 'application/octet-stream': {} } })
  @ApiProblemResponses(404)
  async download(@Param('token') token: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const resolved = await this.attachments.resolveToken(token);
    if (!resolved) throw ProblemException.notFound('File');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The signed, expiring token is the access control: let the SPA on another origin embed
    // files (<img> news covers) - helmet's default `same-origin` would block them.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return new StreamableFile(this.attachments.openRead(resolved.row.storageKey), {
      type: resolved.row.mimeType,
      length: resolved.row.sizeBytes,
      disposition: contentDisposition(resolved.row.originalName, resolved.disposition),
    });
  }
}
