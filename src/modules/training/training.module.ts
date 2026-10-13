import { Module } from '@nestjs/common';
import { CoreExtensionsModule } from '@/modules/core/meta/core-extensions.module';
import { TrainingAbilities } from './abilities/training.abilities';
import { TrainingParticipationsController } from './controllers/training-participations.controller';
import { TrainingQueuesController, TrainingRatingsController } from './controllers/training-ratings.controller';
import { TrainingRequestsController } from './controllers/training-requests.controller';
import { TrainingJobs } from './jobs/training.jobs';
import { trainingAttendeeWorkflowMeta } from './machines/training-attendee.machine';
import { TrainingAttendeeWorkflow } from './machines/training-attendee.workflow';
import { TrainingAccess } from './services/training-access.service';
import { TrainingAttachmentPolicy } from './services/training-attachment.policy';
import { TrainingEntryService } from './services/training-entry.service';
import { TrainingInboxProvider } from './services/training-inbox.provider';
import { TrainingMapper } from './services/training-mapper.service';
import { TrainingMyDayContributor } from './services/training-my-day.contributor';
import { TrainingNotifier } from './services/training-notifier.service';
import { TrainingParticipationsService } from './services/training-participations.service';
import { TrainingQueuesService } from './services/training-queues.service';
import { TrainingRatingsService } from './services/training-ratings.service';
import { TrainingRequestsService } from './services/training-requests.service';
import { TrainingSearchProvider } from './services/training-search.provider';
import { TRAINING_AUDIT_LABELS, TRAINING_ENUMS } from './training.enums';

/**
 * Slice A1 - training requests, participations (SPEC §5.1), approvals, booking, cancellation,
 * goals and rating loops 1-3. Notification templates (`mail/*.notification.ts`) and the seed
 * (`seed/training.seed.ts`) are discovered by core.
 */
@Module({
  imports: [
    CoreExtensionsModule.forFeature({
      enums: TRAINING_ENUMS,
      workflows: [trainingAttendeeWorkflowMeta],
      auditLabels: TRAINING_AUDIT_LABELS,
    }),
  ],
  // Static paths (export.csv, stats, queues/counts, preview) come before /:id inside each controller.
  controllers: [
    TrainingQueuesController,
    TrainingRatingsController,
    TrainingParticipationsController,
    TrainingRequestsController,
  ],
  providers: [
    TrainingAbilities,
    TrainingAccess,
    TrainingMapper,
    TrainingNotifier,
    TrainingEntryService,
    TrainingAttendeeWorkflow,
    TrainingParticipationsService,
    TrainingRequestsService,
    TrainingRatingsService,
    TrainingQueuesService,
    TrainingInboxProvider,
    TrainingSearchProvider,
    TrainingMyDayContributor,
    TrainingAttachmentPolicy,
    TrainingJobs,
  ],
})
export class TrainingModule {}
