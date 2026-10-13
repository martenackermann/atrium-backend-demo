import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { timelineEntrySchema } from '@/common/domain/schemas';

/** TimelineEntry response (the shared schema has a `.meta({ id })`, so copy its shape). */
export class TimelineDto extends createZodDto(z.object(timelineEntrySchema.shape)) {}
