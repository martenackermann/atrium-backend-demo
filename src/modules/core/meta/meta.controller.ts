import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { attachmentPurposeSchema, moneySchema } from '@/common/domain/schemas';
import { ATTACHMENT_PURPOSES } from '@/common/domain/vocabulary';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { ProblemException } from '@/common/http/problem';
import { AppConfig } from '@/config/app-config';
import { ALLOWED_MIME_BY_PURPOSE } from '../attachments/attachment-rules';
import { enumOptionSchema, EnumRegistry } from './enum.registry';
import { workflowDefinitionSchema, WorkflowRegistry } from './workflow.registry';

const publicConfigSchema = z.object({
  timezone: z.string(),
  demoMode: z.boolean(),
  trainingExecutiveThreshold: moneySchema,
  trainingHighPriorityDays: z.number().int(),
  travelHighPriorityDays: z.number().int(),
  goalsReminderDaysBefore: z.number().int(),
  ratingDelaysDays: z.object({ loop1: z.number().int(), loop2: z.number().int(), loop3: z.number().int() }),
  peopleReopenWindowDays: z.number().int(),
  ratingReminderMax: z.number().int(),
  ratingReminderCadenceDays: z.number().int(),
  ratingOverdueDays: z.number().int(),
  assetAcceptanceDueDays: z.number().int(),
  uploadMaxBytes: z.number().int(),
  allowedMimeTypes: z.record(attachmentPurposeSchema, z.array(z.string())),
});
class PublicConfigDto extends createZodDto(publicConfigSchema) {}
class EnumsDto extends createZodDto(z.record(z.string(), z.array(enumOptionSchema))) {}
class WorkflowListItemDto extends createZodDto(z.object({ name: z.string(), label: z.string() })) {}
class WorkflowDefinitionDto extends createZodDto(z.object(workflowDefinitionSchema.shape)) {}

@ApiTags('meta')
@Controller('meta')
export class MetaController {
  constructor(
    private readonly enums: EnumRegistry,
    private readonly workflows: WorkflowRegistry,
    private readonly config: AppConfig,
  ) {}

  @Get('enums')
  @ApiOperation({ summary: 'Labels and badge tones for every enum (registered by the modules)' })
  @ApiOkResponse({ type: EnumsDto })
  getEnums(): Record<string, z.infer<typeof enumOptionSchema>[]> {
    return this.enums.all();
  }

  @Get('config')
  @ZodResponse({ type: PublicConfigDto })
  getConfig(): PublicConfigDto {
    const c = this.config;
    return {
      timezone: c.get('APP_TIMEZONE'),
      demoMode: c.get('DEMO_MODE'),
      trainingExecutiveThreshold: { amountCents: c.get('TRAINING_EXECUTIVE_THRESHOLD_CENTS'), currency: 'EUR' },
      trainingHighPriorityDays: c.get('TRAINING_HIGH_PRIORITY_DAYS'),
      travelHighPriorityDays: c.get('TRAVEL_HIGH_PRIORITY_DAYS'),
      goalsReminderDaysBefore: c.get('GOALS_REMINDER_DAYS_BEFORE'),
      ratingDelaysDays: {
        loop1: c.get('RATING_LOOP1_DELAY_DAYS'),
        loop2: c.get('RATING_LOOP2_DELAY_DAYS'),
        loop3: c.get('RATING_LOOP3_DELAY_DAYS'),
      },
      peopleReopenWindowDays: c.get('PEOPLE_REOPEN_WINDOW_DAYS'),
      ratingReminderMax: c.get('RATING_REMINDER_MAX'),
      ratingReminderCadenceDays: c.get('RATING_REMINDER_CADENCE_DAYS'),
      ratingOverdueDays: c.get('RATING_OVERDUE_DAYS'),
      assetAcceptanceDueDays: c.get('ASSET_ACCEPTANCE_DUE_DAYS'),
      uploadMaxBytes: c.get('UPLOAD_MAX_BYTES'),
      allowedMimeTypes: Object.fromEntries(
        ATTACHMENT_PURPOSES.map((purpose) => [purpose, [...ALLOWED_MIME_BY_PURPOSE[purpose]]]),
      ) as PublicConfigDto['allowedMimeTypes'],
    };
  }

  @Get('workflows')
  @ZodResponse({ type: [WorkflowListItemDto] })
  listWorkflows(): WorkflowListItemDto[] {
    return this.workflows.list();
  }

  @Get('workflows/:name')
  @ApiOperation({ summary: 'States and transitions of a workflow, for diagrams' })
  @ZodResponse({ type: WorkflowDefinitionDto })
  @ApiProblemResponses(404)
  getWorkflow(@Param('name') name: string): WorkflowDefinitionDto {
    const definition = this.workflows.describe(name);
    if (!definition) throw ProblemException.notFound('Workflow');
    return definition;
  }
}
