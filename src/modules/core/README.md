# Core module (`src/modules/core`)

**Owner:** foundation. Implements the core API (API.md §3): auth and demo personas, `/me`,
users and org, approver chains, deputies, inbox/search aggregation, notifications, attachments
and signed files, meta (enums, config, workflows), audit log, user/role admin and the job runner.

It also provides what every slice builds on (see `CONVENTIONS.md` §1):

| Folder           | Slice-facing API                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `approvals/`     | `ApprovalService` - approver resolution (SPEC §6.1), `canDecide` (§6.2), deputies, reporting trees  |
| `workflow/`      | `defineWorkflow`, `WorkflowService` (`availableActions`, `apply`), `workflowActions`, `lockRow`     |
| `contracts/`     | `InboxProvider`, `SearchProvider`, `MyDayContributor`, `AttachmentPolicy` + registration decorators |
| `notifications/` | `defineNotification`, `NotificationService.send` (email outbox + in-app)                            |
| `attachments/`   | `AttachmentService` (`link`, `listFor`, `downloadUrl`)                                              |
| `audit/`         | `AuditService` (`record`, `diff`, `timeline`), `AuditLabelRegistry`                                 |
| `meta/`          | `CoreExtensionsModule.forFeature({ enums, workflows, auditLabels })`, `enumOptions`                 |
| `jobs/`          | `@ScheduledJob` (cron + manual run + `job_runs`)                                                    |
| `seed/`          | core seed (52 users, personas, deputies) and the pure org plan used by `seed:export-users`          |

Feature folders replace the generic `controllers/ services/ dto/` layout here because core is larger
than a slice.
