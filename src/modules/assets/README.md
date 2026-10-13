# Assets module (`src/modules/assets`) — slice A3

IT assets: the catalogue (device types, manufacturers, platforms, models), the inventory, the
assignment/acceptance lifecycle, the admin dashboard, cost-centre sync and acceptance reminders.
Spec: SPEC §3.3, §4.4, §5.3, §7 (assets.\*), §8, §10.4; API.md §6; SPEC_RESOLUTIONS #21–#24, #30.

## Layout

```
assets.module.ts            registrations (enums, workflow diagram, audit labels), controllers, providers
assets.domain.ts            statuses, actions, AST-00001 tags, acceptance due-date rule (#23)
assets.enums.ts             /meta/enums (DESIGN tones) + AuditLabelRegistry labels and phrases
abilities/                  CASL: Asset (own rows for everyone, all for asset_admin/it_admin), AssetCatalog, AssetDashboard
machines/asset.machine.ts   XState machine + WorkflowMeta (in_stock → pending_acceptance → in_use / in_repair / scrapped)
machines/asset.workflow.ts  defineWorkflow: visibility (404), assignment rows, cost-centre switch, notifications
controllers/                /assets/catalog/* first, then /assets (static paths before /:id)
services/                   list/detail/create/edit/delete/export, dashboard + counts, catalogue, providers
jobs/assets.jobs.ts         assets.cost-center-sync (nightly), assets.acceptance-reminders (weekdays, reminder cron)
mail/*.notification.ts      the five assets.* templates (auto-discovered)
seed/                       catalogue + 120 assets replayed from event histories (assets-story.plan.ts)
```

## Rules worth knowing

- Only the assigned user accepts or declines (admins get 403). Accept needs an applicable, active
  platform when the device type requires one; the cost centre switches to the user's. Decline,
  unassign, return and scrap put the asset back on `DEFAULT_COST_CENTER_CODE`.
- While an asset is assigned its cost centre is read-only (422, #22); the nightly sync copies the
  user's cost centre onto accepted devices (in use / in repair) and writes an audited diff.
- `acceptanceOverdue`: 00:00 (APP_TIMEZONE) of assignment day + `ASSET_ACCEPTANCE_DUE_DAYS`; the
  inbox `dueAt` uses the same instant (#23, #31).
- Timelines and assignment history are admin-only (#24): the holder gets 403, others 404.
- Action notes are stored as the audit `reason`; timelines add the assignee to `assign` entries.
- Soft delete only in stock or scrapped; models referenced by any asset (incl. deleted) → 409
  `model_in_use`; device types referenced by models → 409 `in_use`.

Tests: `src/modules/assets/**/*.spec.ts` (machine, domain) and `test/e2e/assets-*.e2e-spec.ts`.
