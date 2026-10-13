import { type DynamicModule, Module } from '@nestjs/common';
import { type AuditLabels, AuditLabelRegistry } from '../audit/audit-label.registry';
import type { AnyNotificationTemplate } from '../notifications/notification-template';
import { NotificationTemplateRegistry } from '../notifications/notification-template.registry';
import { type EnumOption, EnumRegistry } from './enum.registry';
import { type WorkflowMeta, WorkflowRegistry } from './workflow.registry';

export interface CoreExtensions {
  /**
   * Notification templates (SPEC §7). Usually not needed: templates in
   * `src/modules/<m>/mail/*.notification.ts` are discovered automatically.
   */
  notifications?: readonly AnyNotificationTemplate[];
  /** Enums served by `GET /meta/enums` (API.md §3.6 EnumName). */
  enums?: Record<string, EnumOption[]>;
  /** Workflow diagrams served by `GET /meta/workflows/{name}`. */
  workflows?: readonly WorkflowMeta[];
  /** Field labels / masked fields / summary phrases per audited entity type. */
  auditLabels?: Record<string, AuditLabels>;
}

let counter = 0;

/**
 * The one registration point for module metadata. In a feature module:
 *
 * ```ts
 * @Module({
 *   imports: [CoreExtensionsModule.forFeature({ notifications: [...], enums: {...}, workflows: [...] })],
 *   providers: [...],
 * })
 * ```
 */
@Module({})
export class CoreExtensionsModule {
  static forFeature(extensions: CoreExtensions): DynamicModule {
    return {
      module: CoreExtensionsModule,
      providers: [
        {
          provide: `CORE_EXTENSIONS_${counter++}`,
          inject: [NotificationTemplateRegistry, EnumRegistry, WorkflowRegistry, AuditLabelRegistry],
          useFactory: (
            notifications: NotificationTemplateRegistry,
            enums: EnumRegistry,
            workflows: WorkflowRegistry,
            auditLabels: AuditLabelRegistry,
          ) => {
            notifications.register(extensions.notifications ?? []);
            for (const [name, options] of Object.entries(extensions.enums ?? {})) enums.register(name, options);
            for (const workflow of extensions.workflows ?? []) workflows.register(workflow);
            for (const [type, labels] of Object.entries(extensions.auditLabels ?? {}))
              auditLabels.register(type, labels);
            return extensions;
          },
        },
      ],
    };
  }
}
