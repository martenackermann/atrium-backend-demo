import { Module } from '@nestjs/common';
import { CoreExtensionsModule } from '@/modules/core/meta/core-extensions.module';
import { PeopleAbilities } from './abilities/people.abilities';
import { JobRolesController } from './controllers/job-roles.controller';
import { PeopleQueuesController } from './controllers/people-queues.controller';
import { PeopleRequestsController } from './controllers/people-requests.controller';
import { PeopleRequestWorkflow } from './machines/people-request.workflow';
import { PEOPLE_AUDIT_LABELS, PEOPLE_ENUMS, peopleRequestWorkflowMeta } from './people.enums';
import { JobRolesService } from './services/job-roles.service';
import { PeopleAttachmentPolicy } from './services/people-attachment.policy';
import { PeopleInboxProvider } from './services/people-inbox.provider';
import { PeopleNotifier } from './services/people-notifier.service';
import { PeopleRequestsService } from './services/people-requests.service';
import { PeopleSearchProvider } from './services/people-search.provider';

/** Slice A4 - onboarding / offboarding / role change requests (SPEC §3.4, §4.5, §5.4). */
@Module({
  imports: [
    CoreExtensionsModule.forFeature({
      enums: PEOPLE_ENUMS,
      workflows: [peopleRequestWorkflowMeta],
      auditLabels: PEOPLE_AUDIT_LABELS,
    }),
  ],
  // Static paths (job-roles, queues/counts) live in their own controllers, before /:id routes.
  controllers: [JobRolesController, PeopleQueuesController, PeopleRequestsController],
  providers: [
    PeopleAbilities,
    PeopleNotifier,
    PeopleRequestWorkflow,
    PeopleRequestsService,
    JobRolesService,
    PeopleInboxProvider,
    PeopleSearchProvider,
    PeopleAttachmentPolicy,
  ],
  exports: [PeopleRequestsService],
})
export class PeopleModule {}
