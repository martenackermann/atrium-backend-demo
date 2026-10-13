# Training module (`src/modules/training`) — slice A1

Training requests with 1–20 attendees, each attendee ("participation") with its own lifecycle
(SPEC §5.1 + SPEC_RESOLUTIONS #11), approvals via the core `ApprovalService` rules, booking,
cancellation, learning goals and the rating loops 1–3 (single `training_ratings` table).

| Area      | Files                                                                                                                                                                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema    | `prisma/schema/training.prisma` (+ A1 block in `core.prisma`), migration `*_a1_training_init`                                                                                                                                                                           |
| Lifecycle | `machines/training-attendee.machine.ts` (XState + diagram meta), `machines/training-attendee.workflow.ts` (permissions, persistence, side effects)                                                                                                                      |
| Endpoints | `controllers/*`: `/training/requests*`, `/training/participations*`, `/training/ratings*`, `/training/queues/counts` (static paths before `/:id`)                                                                                                                       |
| Services  | `services/training-{requests,participations,ratings,queues}.service.ts`, `training-entry.service.ts` (entry plan, SPEC §5.1 table), `training-access.service.ts` (visibility and scopes), `training-mapper.service.ts` (DTOs), `training-notifier.service.ts` (SPEC §7) |
| Providers | inbox, search, my-day (`upcoming`), attachment policy (`training_request`, `training_attendee`)                                                                                                                                                                         |
| Jobs      | `jobs/training.jobs.ts`: `training.rating-reminders`, `training.goals-reminders` (`reminder: true`)                                                                                                                                                                     |
| Mail      | `mail/*.notification.ts`: the 14 `training.*` templates                                                                                                                                                                                                                 |
| Seed      | `seed/training-story.plan.ts` (SPEC §10.2 as data, mirrored by the frontend MSW seed), `seed/training.seed.ts`                                                                                                                                                          |
| Tests     | `training.spec.ts` (unit), `test/e2e/training-*.e2e-spec.ts`                                                                                                                                                                                                            |

Decisions worth knowing:

- Entry: executive attendee → both steps auto (`executive_self`); requester is the resolved
  approver → manager step auto (`requester_is_approver`), and the executive step completes too when
  the executive approver is the requester (`same_approver`). Auto-approved participations get
  `training.participation_approved` + `training.booking_requested` (SPEC_RESOLUTIONS #28).
- Approving the manager step as the named executive (or when the executive is the requester)
  completes the executive step automatically (D8), audited as `auto_approve`.
- `approve` and `retry_booking` need `startsOn >= today`; `request_cancellation` needs
  `endsOn >= today`. From `booking_impossible`: back office `close {reason}`, attendee/requester
  `withdraw` (#11).
- `RatingSubmission` is accepted as one flat object (`loop` selects the answer set; other loops'
  fields → 422), wire-compatible with the API.md union.
