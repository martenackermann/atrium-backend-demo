import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ApprovalService } from './approvals/approval.service';
import { AttachmentService } from './attachments/attachment.service';
import { AuditService } from './audit/audit.service';
import { AuditLabelRegistry } from './audit/audit-label.registry';
import { ProviderRegistry } from './contracts/provider.registry';
import { InboxService } from './inbox/inbox.service';
import { EnumRegistry } from './meta/enum.registry';
import { WorkflowRegistry } from './meta/workflow.registry';
import { NotificationService } from './notifications/notification.service';
import { NotificationTemplateRegistry } from './notifications/notification-template.registry';
import { WorkflowService } from './workflow/workflow.service';

/**
 * Core services that every feature module may inject (global): approvals, attachments,
 * audit, notifications, workflow engine and the registries behind `CoreExtensionsModule`.
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    ApprovalService,
    AttachmentService,
    AuditService,
    AuditLabelRegistry,
    EnumRegistry,
    InboxService,
    NotificationService,
    NotificationTemplateRegistry,
    ProviderRegistry,
    WorkflowRegistry,
    WorkflowService,
  ],
  exports: [
    ApprovalService,
    AttachmentService,
    AuditService,
    AuditLabelRegistry,
    EnumRegistry,
    InboxService,
    NotificationService,
    NotificationTemplateRegistry,
    ProviderRegistry,
    WorkflowRegistry,
    WorkflowService,
  ],
})
export class CoreRegistryModule {}
