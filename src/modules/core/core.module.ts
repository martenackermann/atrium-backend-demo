import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { CoreAbilities } from './abilities/core.abilities';
import { AdminController, AuditController } from './admin/admin.controller';
import { AdminUsersService } from './admin/admin-users.service';
import { AttachmentsController, FilesController } from './attachments/attachments.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { DeputiesController } from './deputies/deputies.controller';
import { DeputiesService } from './deputies/deputies.service';
import { InboxController, SearchController } from './inbox/inbox.controller';
import { CoreJobs } from './jobs/core.jobs';
import { JobRegistry } from './jobs/job.registry';
import { CORE_AUDIT_LABELS, CORE_ENUMS } from './meta/core.enums';
import { CoreExtensionsModule } from './meta/core-extensions.module';
import { MetaController } from './meta/meta.controller';
import { MailJobs } from './notifications/mail.jobs';
import { MailPreviewController } from './notifications/mail-preview.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { OrgController } from './users/org.controller';
import { MeController, UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

/**
 * Core module (foundation): auth endpoints, users/org, deputies, inbox/search aggregation,
 * notifications, attachments, meta, audit, admin, jobs. Shared core services are global
 * (CoreRegistryModule, CoreAuthModule) so slices can inject them without importing this.
 */
@Module({
  imports: [DiscoveryModule, CoreExtensionsModule.forFeature({ enums: CORE_ENUMS, auditLabels: CORE_AUDIT_LABELS })],
  controllers: [
    AuthController,
    MeController,
    UsersController,
    OrgController,
    DeputiesController,
    NotificationsController,
    InboxController,
    SearchController,
    AttachmentsController,
    FilesController,
    MetaController,
    AuditController,
    AdminController,
    MailPreviewController,
  ],
  providers: [
    AuthService,
    UsersService,
    DeputiesService,
    AdminUsersService,
    CoreAbilities,
    JobRegistry,
    CoreJobs,
    MailJobs,
  ],
})
export class CoreModule {}
