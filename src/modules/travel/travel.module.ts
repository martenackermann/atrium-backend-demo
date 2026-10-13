import { Module } from '@nestjs/common';
import { CoreExtensionsModule } from '@/modules/core/meta/core-extensions.module';
import { TravelAbilities } from './abilities/travel.abilities';
import { CarClassesController, TravelQueuesController } from './controllers/travel-misc.controller';
import { TravelRequestsController } from './controllers/travel-requests.controller';
import { TravelJobs } from './jobs/travel.jobs';
import { travelRequestWorkflowMeta } from './machines/travel-request.machine';
import { TravelWorkflow } from './machines/travel-request.workflow';
import { CarClassesService } from './services/car-classes.service';
import { TravelAccessService } from './services/travel-access.service';
import { TravelNotifier } from './services/travel-notifier.service';
import {
  TravelAttachmentPolicy,
  TravelInboxProvider,
  TravelMyDayContributor,
  TravelSearchProvider,
} from './services/travel-providers';
import { TravelRequestsService } from './services/travel-requests.service';
import { TRAVEL_AUDIT_LABELS, TRAVEL_ENUMS } from './travel.enums';

/**
 * Travel (slice A2): car / train / flight requests, needsApproval rules, approvals, desk
 * booking with confirmations + encrypted PIN, cancellations, car-class catalogue, digest.
 * Notification templates in `mail/` and the seeder in `seed/` are discovered by core.
 */
@Module({
  imports: [
    CoreExtensionsModule.forFeature({
      enums: TRAVEL_ENUMS,
      workflows: [travelRequestWorkflowMeta],
      auditLabels: TRAVEL_AUDIT_LABELS,
    }),
  ],
  // Static paths before /:id routes (SPEC_RESOLUTIONS #30): queues/counts lives in its own controller.
  controllers: [TravelQueuesController, CarClassesController, TravelRequestsController],
  providers: [
    TravelAbilities,
    TravelAccessService,
    TravelNotifier,
    TravelWorkflow,
    TravelRequestsService,
    CarClassesService,
    TravelInboxProvider,
    TravelSearchProvider,
    TravelMyDayContributor,
    TravelAttachmentPolicy,
    TravelJobs,
  ],
})
export class TravelModule {}
