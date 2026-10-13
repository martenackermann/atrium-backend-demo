# Travel module (`src/modules/travel`) — slice A2

Car/van, train and flight requests with the SPEC §6.3 `needsApproval` rules, approvals through
the core `ApprovalService`, travel-desk booking with confirmation PDFs and an encrypted PIN,
cancellations, the car-class catalogue and the high-priority digest.

| Area         | Files                                                                                                                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rules (pure) | `domain/travel-rules.ts` (reasons, route, high priority), `domain/pin-cipher.ts` (AES-256-GCM), `domain/travel-format.ts`                                                                                                                                       |
| Lifecycle    | `machines/travel-request.machine.ts` (XState, SPEC §5.2 + #11 `close`/`withdraw` from `booking_impossible`), `machines/travel-request.workflow.ts` (persistence, permissions, notifications)                                                                    |
| HTTP         | `controllers/travel-requests.controller.ts` (`/travel/requests*`, static paths first), `controllers/travel-misc.controller.ts` (`/travel/queues/counts`, `/travel/car-classes*`)                                                                                |
| Services     | `travel-requests.service.ts` (list scopes, preview, create, PIN, export, counts), `travel-access.service.ts` (SPEC §3.2 relationship rules), `travel-notifier.service.ts`, `car-classes.service.ts`, `travel-providers.ts` (inbox, search, my-day, attachments) |
| Mail         | `mail/travel.*.notification.ts` (all SPEC §7 `travel.*` templates)                                                                                                                                                                                              |
| Jobs         | `jobs/travel.jobs.ts` (`travel.high-priority-digest`)                                                                                                                                                                                                           |
| Seed         | `seed/travel.seed.ts` + `seed/travel-seed.data.ts` (SPEC §10.3: 40 requests, story records TRV-000001..13, 7 car classes)                                                                                                                                       |

Decisions:

- `approval` (Decision) holds the approval step's decision: approve, auto-approval or decline.
- A manually chosen approver has `approverSelection = manual` and `approverReason = null`.
- `view_pin` is offered only while the booking is live (`booked`, `cancellation_requested`).
- Booking confirmations are attachments with `entityType = travel_booking`, `entityId = requestId`.
- Seed ids come from a travel-only faker so they don't depend on other slices' seeds.
