import { basename } from 'node:path';
import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { lookup } from 'mime-types';
import { Public } from '@/common/auth/public.decorator';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { ProblemException } from '@/common/http/problem';
import { FILES_ROUTE, StorageService } from './storage.service';

/** RFC 6266 header with an ASCII fallback and a UTF-8 file name. */
export function contentDisposition(fileName: string, type: 'inline' | 'attachment' = 'attachment'): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

@ApiTags('files')
@Public()
@Controller(FILES_ROUTE)
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Get(':token')
  @ApiOperation({
    summary: 'Download a file through a signed, expiring URL',
    description: 'URLs are created server-side by StorageService.createDownloadUrl(); no bearer token needed.',
  })
  @ApiOkResponse({ description: 'File content', content: { 'application/octet-stream': {} } })
  @ApiProblemResponses(403, 404, 410)
  async download(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const payload = this.storage.verifyDownloadToken(token);
    if (!(await this.storage.exists(payload.k))) throw ProblemException.notFound('File');

    const remaining = Math.max(0, payload.e - Math.floor(Date.now() / 1000));
    res.setHeader('Cache-Control', `private, max-age=${remaining}`);
    return new StreamableFile(this.storage.openRead(payload.k), {
      type: payload.t ?? (lookup(payload.k) || 'application/octet-stream'),
      disposition: contentDisposition(payload.n ?? basename(payload.k), payload.d),
    });
  }
}
