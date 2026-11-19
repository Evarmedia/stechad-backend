# User management and personal preferences

The feature migrations are `20261119090000-user-management.js`, `20261119100000-admin-workflow-simplification.js`, and `20261119110000-custom-role-permissions.js`. Apply them before serving the updated API; deploy the frontend after the backend. Normal startup runs pending migrations and then installs transactional audit and notification hooks. Automatic Sequelize synchronization remains disabled.

## Administration

These endpoints require the Admin or Super Admin role:

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/api/admin/users` | Paginated directory excluding Talent and Super Admin accounts, eligible role definitions, permission catalog, and separate current/deleted counts |
| DELETE | `/api/admin/users/:id` | Soft-delete, revoke sessions, and preserve dependent history |
| POST | `/api/admin/users/:id/restore` | Restore the account with its former active/inactive status; a fresh login is required |
| PUT | `/api/admin/users/:id/employee-id` | Set a trimmed, nonempty Employee ID of at most 255 characters for a non-talent workforce account |
| PUT | `/api/admin/users/:id/permissions` | Replace additive individual `workforce_permissions` with known catalog keys |
| GET | `/api/admin/users/:id/attendance` | Paginated attendance, including for deleted users, with summaries across the full matching set |
| GET | `/api/admin/audit-logs` | Read-only activity records |
| POST | `/api/admin/notifications/broadcast` | Persist and publish a custom announcement to every nondeleted account |

Directory filters: `search`, `role`, `status=current|active|inactive|deleted|all`, `page`, and `limit`. Directory counts exclude Talent and Super Admin accounts. `counts.totalUsers` includes eligible inactive accounts and excludes deleted accounts; `counts.deletedUsers` counts eligible deleted accounts separately. Platform-wide overview totals retain their existing meaning. Notification previews use those platform totals rather than the restricted directory counts, so talents and Super Admin still receive broadcasts. Limits are 1–100, defaulting to 25.

Attendance filters: `start_date`, `end_date` in `YYYY-MM-DD` format, `status=present|late|completed|absent|cancelled`, `source=manual|automatic`, and pagination. Empty date boundaries default to the current company attendance month through today. Entries retain raw timestamps and summaries include completed hours across all filtered records.

Audit filters: `actor_user_id`, `action`, `target_type`, `target_id`, `outcome`, `start_date`, `end_date`, and pagination. Audit timestamps are UTC; date boundaries for audit searches are UTC dates. Changed personal fields are represented as change flags; credentials, tokens, collected coordinates, and message content are excluded. Successful model mutations and their audit inserts share a transaction. API and background actions use the same hooks; audit persistence failures roll back the associated mutation. No audit mutation API exists.

Deletion returns HTTP 409 with `blockers.departments`, `blockers.directReports`, and `blockers.projects` when reassignment is required. Planning, in-progress, and on-hold projects count as active assignments. Self-deletion and deletion of the sole Super Admin are prohibited. Existing talent and PM deletion routes use the same lifecycle service. Email and Employee ID values remain reserved after deletion; invitations reserve IDs as well.

Historical project, application, interview, workforce request, and chat relationships retain deleted identities. Notification creation filters deleted recipients across both legacy and broadcast writers. Project updates share the deletion lock and reject unavailable assignees. Admins can clear or reassign the manager using `project_manager_id`, and managers can replace the assigned talent list with `talent_ids` on `PUT /api/projects/:id`; a creation grant alone does not allow assignment changes. Reactivating a completed project requires available assignees or explicit reassignment.

Broadcast body: `{ broadcast_id, title, message, type }`, where the caller supplies a UUID `broadcast_id`, title has 1–200 characters, message has 1–5000 characters, and type is `info`, `success`, or `warning`. Repeating the same identifier and payload returns the original broadcast. Reusing it for another payload returns 409. The response includes `recipient_count`. Inactive accounts receive durable records; deleted accounts are excluded. Online delivery uses the authenticated `user_<id>` Socket.IO rooms and the existing `notification_created: { notification }` event after commit. Reconnection retrieves persisted notification history.

## Personal settings and authentication

`GET /api/auth/preferences` returns the current user. `PUT /api/auth/preferences` accepts only boolean `auto_clock_out_enabled` and `notification_sound_enabled`. The optional boolean `import_sound_preference` makes sound initialization conditional on an unset server preference, preserving an existing browser mute choice once. Both endpoints require authentication and apply only to the caller. Admin and Super Admin cannot update automatic clock-out preferences (403); their stored clock-out values are false/null. Sound preferences remain available.

- Automatic clock-out defaults off, with a null time. Enabling sets the time to `17:00:00`; arbitrary times are not accepted. The database enforces the boolean/time invariant.
- Attendance uses `ATTENDANCE_UTC_OFFSET_MINUTES`, defaulting to 60 (UTC+1). Each open entry snapshots its deadline in `auto_clock_out_at`. Changes update or cancel today's pending deadline.
- Enabling after 5 PM during an open session returns 409. Clock-in at or after 5 PM requires automatic clock-out to be off.
- Startup and minute-by-minute reconciliation close eligible sessions at the scheduled timestamp and record `clock_out_source=automatic`. Manual summaries remain required for manual clock-out; automatic completion does not invent a summary. Existing end-of-day absence processing remains in place.
- `POST /api/auth/edit-password` retains the existing `old_password`, `new_password`, and `confirm_password` fields. Success returns replacement `data.token` and `data.refreshToken`. Clients must store both and reconnect Socket.IO. A passwordless account receives 409 and can establish a password through the existing reset flow.
- Successful password and Google logins set `is_verified=true` and update `last_login`. Inactive and deleted identities cannot authenticate. A client-supplied `googleSignIn` flag cannot authenticate an identity; Google authentication uses the provider redirect.
- Access and refresh JWTs include `session_version`. Legacy tokens imply version zero. Deletion and password changes increment the stored version, and REST, refresh, and socket authentication reject mismatches. Existing sockets are disconnected. Restoration does not revive old tokens.

`PUT /api/staff/location-sharing` remains the consent endpoint for every authenticated role. Disabling clears every collected browser-location field and attendance coordinate/accuracy in a single transaction, preserving manually entered city/country. All location writers check current consent under a user-row lock. A consent version prevents delayed geocoding from repopulating purged data after a disable/re-enable cycle. The migration purges collected data for accounts already opted out. The browser requests permission only after an explicit enable action and polls location only during an opted-in active attendance session.

## Admin navigation and role exemptions

Admin and Super Admin use one Workforce page at `/admin/workforce`, with People, Departments, Approvals, Holidays, KPIs, Zoho and Permissions tabs. Existing permission checks still control named operations. `/workforce/manage` redirects admins to this page; `/approvals` redirects them to `/admin/workforce?tab=approvals`. The delegated management screen remains available to other permitted roles.

Admin Settings at `/admin/settings` combines Account (sounds, privacy and password) and System (Employee ID prefix) tabs. Account is the default; `?tab=system` selects System. `/settings` redirects admins here. The individual Employee ID form has moved into People → Edit employment. The workforce directory includes seeded non-talent roles and custom roles, with an `employment` object containing the shared editor's raw fields and reporting provenance. Talents remain in Users and talent-specific administration; their employment and Employee IDs cannot be edited.

Admin personal attendance and expense pages redirect to `/admin`. GET `/api/staff/attendance`, POST `/api/staff/attendance/clock-in`, POST `/api/staff/attendance/clock-out`, and GET/POST `/api/staff/expenses` return 403 for both admin roles, including Super Admin's wildcard. Workforce approvals and `/api/admin/users/:id/attendance` remain available. Admin location polling no longer requests personal attendance.

The forward migration disables admin clock-out preferences and clears open deadlines. Open sessions become `cancelled`, retaining clock-in, location consent history and work summary without adding clock-out or duration. Completed and previously absent history stays intact. Role promotion applies the same cancellation transactionally. Reconciliation locks the user before attendance, skips locked users for the next pass, and excludes cancelled sessions and admin accounts from automatic completion and absence processing. Workforce attendance rates exclude admin accounts. The migration's rollback is a no-op: previous preferences and cancelled sessions are not reconstructed.

## Permissions and reporting

`utils/permissions.js` defines the canonical catalog and resolver. Effective access combines configured role permissions with individual additive grants; Super Admin retains `*`. `create_project` is accepted as an alias for `create_projects`. Removing a grant leaves any matching role entitlement active. Custom roles use their own validated `permission_keys`, plus additive individual grants; role names never imply Admin/PM access. Unknown roles receive no implicit system-role permissions.

Every non-admin role, including PM, staff, talent and custom roles, uses **Manage workforce** at `/workforce/manage`. The sidebar and route require any of `manage_staff`, `manage_departments`, `manage_kpis`, `approve_leave`, `approve_expenses`, `verify_receipts`, or `approve_invoices`. People, Departments and KPIs retain their existing management requirements. An **Approvals** tab appears for any of the four approval permissions, at `/workforce/manage?tab=approvals`; approval-only users see only this tab and the browser requests no workforce directory, department or KPI data. The queue loads only while its permitted tab is active. Removing the selected tab's entitlement switches to the first permitted tab; removing all relevant entitlements denies entry.

There are no standalone Approvals sidebar links. `/approvals`, `/dashboard/pm/approvals` and `/dashboard/staff/approvals` redirect any authenticated role to its Workforce Approvals tab (admins use `/admin/workforce?tab=approvals`). New approval notifications and emails link to `/approvals` so the recipient's current role selects the destination. Existing bookmarks and persisted notifications continue to resolve. This navigation change adds no APIs, permission definitions, default grants or migrations.

The shared tab reuses `GET /api/staff/approvals` and `PUT /api/staff/approvals/:type/:request_id` with `{ action, notes }`. Reads require an approval permission and return only matching queues: leave approval/rejection needs `approve_leave`, expense approval/rejection needs `approve_expenses`, receipt verification needs `verify_receipts`, and invoice review/accounts actions need `approve_invoices`. Writes evaluate the current action permission server-side and reject invalid request state transitions. An approval grant does not grant access to workforce management lookups or mutations. Notes, receipt links, confirmation dialogs, load/retry errors and existing workflow behavior are retained.

Delegated management lives under `/api/workforce/management`:

| Endpoint | Required permission |
| --- | --- |
| GET `/users` | Any of `manage_staff`, `manage_departments`, `manage_kpis`; non-staff managers receive only minimal identity lookups |
| PUT `/users/:user_id` | `manage_staff`; employment/reporting fields, plus admin-only Employee ID |
| GET `/departments` | `manage_departments` or `manage_staff` |
| POST, PUT, DELETE `/departments[/:department_id]` | `manage_departments` |
| GET, POST, PUT, DELETE `/kpis[/:kpi_id]` | `manage_kpis` |
| POST `/kpis/:kpi_id/appraisals` | `manage_kpis` |

Employment updates reject talent targets. Admin callers with `manage_staff` may include `employee_id` in `PUT /api/workforce/management/users/:user_id`; its validation and all employment changes share one transaction, so an ID conflict rolls back the entire edit. Delegated editors cannot change roles, grants, activation, Employee IDs, or deletion state. Existing admin mutation endpoints also enforce their named permissions, and every approval route checks the required permission for that action. Project creation requires `create_projects`; a grantee without a PM profile creates unassigned projects and reads their own creations. Creators with a current `create_projects` grant can edit title, description, priority and deadline on their own projects, and delete their own projects only while planning, on hold or cancelled. Existing Admin, PM and assigned-talent rights remain in place.

Reporting fields are `reporting_manager_mode=department|override` and `reports_to_user_id`. Department mode derives the manager from `Department.manager_user_id`; a department manager does not report to themselves. Override mode accepts a specific active manager or explicit null. Existing nonempty reporting assignments migrate as overrides. Department changes and invitation acceptance apply the shared resolver. Changes to department management update inherited links only; deletion clears inherited links and preserves overrides. A transaction-scoped hierarchy lock prevents concurrent updates or deletion/assignment races from creating invalid relationships. Self-reporting, unavailable managers, and cycles are rejected.

## Directory protection, project creators and custom roles

Super Admin accounts are excluded from User/Workforce directories, employee lookups, birthday lists and assignment candidates before filtering, pagination and counts, for every caller including Super Admin. User directory also excludes talents, including deleted talent accounts. Roles still lists the protected Super Admin **role definition**, not the account. Directory-linked attendance and account-management endpoints return 404 for Super Admin targets. Self authentication/profile editing, internal notification delivery, existing chat contacts/history, audit identities and reporting links are unchanged. Existing hidden reporting/department managers can be retained during unrelated edits without becoming selectable candidates. Live PM/talent assignment candidates must still hold that built-in role; retained historical profiles confer no authority.

`GET /api/projects?created_by_me=true` filters to the caller's recorded creations for every role (`true|false`, otherwise 400). `PUT /api/projects/:projects_id` and `DELETE /api/projects/:projects_id` now admit current creators with `create_projects` (including the `create_project` alias); permission, creator identity and deletion status are checked with the mutation. Creator-only editing accepts title, description, priority and deadline, and rejects ownership, assignment and unrelated field writes (403). Non-admin deletion of in-progress/completed projects returns 400. Other users' projects remain forbidden, and legacy null creators are not guessed. Existing PM/Admin/assigned-talent access is retained. The shared Create projects page offers edit, cancel and confirmed deletion with errors and restrictions shown inline.

`Role.permission_keys` is a non-null JSONB array, initially empty for existing/new custom roles. The versioned migration is schema-aware and repeatable and does not alter built-in switches or individual grants. Legacy role bootstrap applies this migration before seeding through the current model; the regular migration runner subsequently records it. Rollback removes only this added configuration and requires a compatible application rollback; re-upgrade initializes empty role permissions.

Super Admin-only `POST /api/admin/roles` and `PUT /api/admin/roles/:role_id` accept `permission_keys` arrays from the existing catalog; unknown keys, wildcard grants and invalid types return 400. `GET /api/admin/roles` retains its `data` array and adds top-level `permission_catalog`. Role records include `permission_keys`. System definitions remain protected; assigned/deleted-user/invitation role reservations remain in force. Permission changes are audited transactionally and emit `account_updated` to affected users after commit; REST always resolves current role configuration.

`GET /api/admin/workforce` adds eligible `roles` metadata. People role controls and invitations use these definitions, including custom roles; Admins may assign existing roles, while only Super Admin may edit custom-role permission definitions. Workforce Permissions displays custom roles alongside the unchanged built-in switches. Role choices refresh on entry/focus, and saved names are shown across profiles, lists, navigation and chat.

Custom-role users log into the staff-style employee dashboard and personal attendance, leave, KPIs, holidays, profile, messages and settings routes. Staff routes explicitly admit validated custom employee roles, without granting Admin, PM or group-management authority. Expense submission and management features use effective permissions. Custom employees are eligible for workforce employment/status updates, KPI assignments, birthdays, holiday delivery and staff-level direct chat contact rules; notification links resolve to valid employee routes. Invitation acceptance and built-in role transitions retain profile/history provisioning and admin attendance exemptions.

## Verification and rollout

Run backend tests with isolated PostgreSQL schemas:

```sh
AUTH_TEST_DATABASE_URL=postgresql://localhost/test_database \
CHAT_TEST_DATABASE_URL=postgresql://localhost/test_database \
WORKFORCE_TEST_DATABASE_URL=postgresql://localhost/test_database npm test
```

Without these variables the integration suites explicitly skip; ordinary model/unit tests still run. The new suites cover upgrades, repeated migrations, rollback, role and individual permission enforcement, deletion/restore, credentials, session revocation, identifier conflicts, reporting, attendance boundaries/concurrency, consent races, broadcasts, and audit redaction/rollback. Frontend component tests run with `npm test` in the frontend repository.

For a local browser fixture, run `WORKFORCE_TEST_DATABASE_URL=... node test/support/feature-preview.js`. It creates a unique temporary schema and test accounts, uses API port 55040, and writes test-only details to `/tmp/stechad-feature-preview.json`. Start Vite with `VITE_BACKEND_URL=http://127.0.0.1:55040/api VITE_SOCKET_URL=http://127.0.0.1:55040` on port 58087. The fixture includes admin, Super Admin, custom, staff, delegated staff, PM and talent accounts, plus pending/approved expenses and a staff invoice for approval checks. SIGINT/SIGTERM removes the temporary schema.

Monitor attendance reconciliation errors, audit persistence failures, authorization failures, and notification publication failures. Back up before upgrading. Schema rollback cannot recover purged location data, revoked sessions, or removed audit storage. The admin workflow migration also leaves cancellations and disabled preferences in place when rolled back. Once soft deletion is used, do not roll back to a backend that ignores deletion metadata; use a compatible forward fix instead. No production database or deployment is modified by these tests.

### Local verification, 19 November 2026

- PostgreSQL 17: all 79 backend tests passed, with no skipped suites, including each independent approval permission for PM/staff/custom users, denied unrelated lookups and actions, role-switch preservation, revocation, review notes, notification/email destinations, and existing user-management, attendance, migration, privacy, broadcast and audit coverage.
- Frontend: all 68 Vitest component tests passed; the Vite production build passed. Approval coverage includes sidebar visibility, legacy redirects for every role, independent and combined grants, lazy queue fetching, no lookup leakage, tab fallback, revocation during review, receipt links and retry/action errors.
- Local Chrome/Playwright: admin login/profile editing, user directory/restoration, attendance history, Employee ID editing, audit history, independent preferences and location consent, live broadcasts, delegated project creation, reporting edits, KPI appraisals, live permission revocation and password replacement sessions passed. Both admin roles were checked for merged Workforce/Settings, obsolete-route redirects, custom-role editing, absence of talent editing, password replacement sessions and retained attendance oversight. A staff leave request was approved in Workforce, and staff/PM personal workflows and delegated editing were checked. The merged Workforce and Settings layouts were checked at 390px, with no uncaught page errors.
- Approval tab Chrome/Playwright: PM leave approval/rejection with persisted notes, staff expense approval/empty queue, custom-role receipt verification and invoice/accounts actions, and talent approval access passed. Approval-only accounts requested no workforce lookups. All three legacy links were checked, both admin roles retained their Workforce tab, and revoking permission closed an open review and selected People before final revocation denied entry. Load/retry and stale-action errors preserved review notes. Desktop layouts, mixed tabs and confirmation dialogs were checked, including 390px mobile views; no uncaught browser errors occurred.
- `tsc --noEmit -p tsconfig.app.json` reports 13 existing errors in legacy PM applicant, application, interview, job and project-form types. The same errors were reproduced from the unchanged frontend HEAD; the new components introduce no additional TypeScript errors.

### Directory, creator and custom-role verification

All 79 backend tests passed on isolated PostgreSQL 17 without skipped suites. Added coverage includes legacy role bootstrap and repeated startup, migration upgrade/repeat/rollback, directory exclusions/counts/filters, hidden-account API denials, preserved reporting relationships, custom-role invitation/assignment/status transitions, effective role plus individual grants, committed socket refreshes, employee APIs, KPI/holiday eligibility, staff contact rules, creator field/ownership restrictions, status-limited deletion, and concurrent project state changes and individual-grant revocation after authentication while a deletion is queued. Retained PM/talent profile detail paths also deny Super Admin access. Project deletion coverage also identified and fixed association-object leakage in audit changes while preserving scalar permission flags.

All 68 frontend tests and the production build passed. Tests cover custom-role configuration/assignment/read-only Admin controls, employee routes/sidebar, preserved hidden manager selections, creator editing/deletion/errors, and existing approval/settings/privacy behavior. Local Playwright/Chrome desktop and 390px mobile journeys passed for custom-role creation and Admin assignment, User directory exclusions for both admin roles, unchanged Super Admin self-auth/audit/chat identities, custom employee login and personal pages, creator edit persistence/delete confirmation/status denial, live role renaming and permission revocation/tab fallback, live profile labels and directory focus refresh, and staff/PM/talent dashboard regressions. Notification preview was verified against all-role platform totals without sending a broadcast. No uncaught browser errors occurred. The existing 13 legacy PM TypeScript errors remain; the changed application and test files add none.
