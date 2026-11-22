# Phase 1 tenancy foundation

Organization creation remains disabled by default. The integrated Phase 1 implementation scopes HR controllers through `services/hrModels`, uses selected HR authentication, validates file ownership, isolates realtime delivery and runs background work with explicit organization predicates. Raw models are reserved for global identity, migrations and services that supply validated ownership explicitly.

## Migration command

Run existing versioned migrations first, back up the database, drain legacy application instances/writers, and run against an explicit schema. The command never changes the application connection's Sequelize schema.

```sh
npm run migrate:tenancy -- --dry-run --database-url "$DATABASE_URL" --schema "$DB_SCHEMA"
npm run migrate:tenancy -- --apply --database-url "$DATABASE_URL" --schema "$DB_SCHEMA"
npm run migrate:tenancy -- --verify --database-url "$DATABASE_URL" --schema "$DB_SCHEMA"
```

`DATABASE_URL` and `DB_SCHEMA` are accepted instead of flags. Dry-run and verify use read-only transactions. Apply uses one transaction and a schema-specific advisory transaction lock, checks before/after legacy-row fingerprints, and rolls back on errors. It preserves IDs, timestamps, credential hashes, status, permission configuration and object references. No files move. Fingerprints currently aggregate row hashes in memory; large production rehearsals should measure that cost.

`tenancy_migration_state` freezes the original legacy identity population on the first successful apply. Reruns only backfill that snapshot, never enroll future users from another organization into stechad, never reset edited profiles or memberships, and reject ownerless rows appearing after cutover. `users` stays global. Every legacy user, including deleted users, receives a separate membership and HR profile. Suspended/deleted identity state initializes membership status without assigning platform privileges. Bootstrap role IDs and custom permission arrays stay intact.

The inventory in `services/tenancyInventory.js` includes all 31 tenant-owned HR and file registry tables, including `ChatParticipants` and `talent_project`. Absent tables and unclassified tables are reported; unclassified tables block apply/verify. Tenant keys, role names, employee IDs in HR profiles, settings, departments, attendance and other owned uniqueness are indexed per organization. Global identity email/referral uniqueness stays global. Existing compatibility-only employee fields on User are no longer authoritative.

Same-organization composite foreign keys protect new scalar relationship writes, including joins and actor references. Retained orphan references are reported under `unresolvedRelationships`; their constraints stay `NOT VALID` so historical rows survive while new violations fail. Cross-organization references are separately reported and fail apply/verify. References embedded inside JSON/arrays (chat participant/read state, project tasks/team) still require scoped application validation. Verify also checks that expected same-organization relationship constraints exist. A report with retained orphan history is not proof that the entire application is isolated.

The stechad ID is `STECHAD_ORGANIZATION_ID` from the inventory module. Post-cutover role startup avoids legacy global role uniqueness/FK rewrites and seeds stechad explicitly. `ensureStechadMembership(user, { transaction })` is the narrow legacy signup/bootstrap path; it does not reactivate or overwrite existing membership/profile state.

## Request and repository interfaces

`middleware/organization.requireOrganization` runs after authentication. It reads `X-Organization-Id`, validates active identity, organization, membership and HR profile, and sets `req.tenant`. A sole active membership may be inferred. Multiple memberships require explicit selection (`409 ORGANIZATION_REQUIRED`); unavailable membership returns `403 MEMBERSHIP_UNAVAILABLE`.

`services/tenantContext` exports:

- `resolveTenantContext({ userId, organizationId?, transaction? })`: resolves `{ organizationId, membershipId, userId, membershipRole, roleId, hrProfile, role, organization }` with the HR profile's scoped role as authority.
- `runWithTenant(context, callback)` / `getTenantContext()`: immutable request-local context; missing context fails closed.
- `revalidateTenantContext(context?, { transaction? })`: checks current access again, including revocation.
- `peekTenantContext()` / `runWithoutTenant(callback)`: explicit global identity/bootstrap dispatch boundaries.
- `getHRIdentity(user, context?)`: plain compatibility projection of scoped HR fields and role object, strips credentials. This projection must not be saved to User. Employment writes go to HRProfile. Organization membership metadata can be attached by identity endpoints.

The HR resolver requires an HR profile. Organization management without HR access should resolve membership separately in the organization-management slice.

`services/tenantRepository.tenantRepository(Model, context?)` provides `findAll`, `findOne`, `findByPk`, `count`, `findAndCountAll`, `create`, `bulkCreate`, `update`, `destroy`, and `require(id)`. Reads/writes revalidate access, add tenant predicates explicitly, and create server-owned organization IDs. Conflicting supplied IDs fail. Explicit tenant-owned nested includes are recursively scoped; identity includes require the HR identity projection. Bulk upserts and nested association creates require a dedicated scoped implementation. Composite PK models use an explicit where predicate. Returned Sequelize instances and direct legacy model methods are not a global authorization boundary; downstream wiring must guard those paths too.

Existing HR controllers import `services/hrModels` instead of raw models. This compatibility boundary exports the same model names and preserves Sequelize associations. Its User reads require an organization HR profile, project employment fields from that profile in SQL, and join the organization's HR role; search, ordering, pagination and counts therefore use employment in the selected organization. User instance and bulk employment writes update HRProfile, activation and removal update membership, and reward increments update the profile balance. Removing a membership through the legacy permanent-delete route preserves the global account and historical rows. Profile role hooks cancel only that organization's personal attendance when a role becomes administrative. Returned instances retain a frozen tenant context, including nested actors, and reject mutation in another context or forged organization writes. Generic HR relationships and association mutations validate organization ownership; nested creates remain explicit. Global account changes use the separate raw identity service. With `TENANCY_ENFORCED=true`, missing context fails closed; contextless legacy fallback exists only for pre-cutover tests and bootstrap. `getInstanceTenant(row)` exposes the frozen context to authorization-aware serializers and storage services.

## Verification

The approved migration-command test uses disposable PostgreSQL schemas and runs dry-run, repeated apply and verify against custom grants, deleted users, orphan actors, pending invites, finance/file references and chat personal state. It also proves future organization-B identities are not enrolled into stechad by a rerun, and same-role names can coexist across organizations while cross-org role references fail.

The approved HTTP/PostgreSQL test covers concurrent A/B requests, ambiguous/malformed/forged selection, scoped by-ID reads, server-owned writes, suspension and contextless repository rejection. Configure `TENANCY_TEST_DATABASE_URL` to run both tests.


## Runtime and delivery cutover

The server always enables `TENANCY_ENFORCED=true` before loading HR routes. Standalone startup and serverless requests fail closed until the explicit migration checkpoint and verification pass. Existing versioned migrations add invitation digests, the tenant file registry and global identity audit history; they do not perform the legacy tenancy backfill. Run versioned migrations, then the explicit tenancy command while old writers are drained. Repeat apply after introducing new relationship constraints, then verify before starting the new application.

`services/hrModels` is the compatibility boundary for existing HR controllers and helpers. It scopes reads, aggregates, nested includes, associations and writes, projects employment fields from HRProfile and protects returned instance mutations. Authentication/global identity services import raw models deliberately. Contextless legacy behavior exists only for old regression fixtures; it is disabled in the server composition. Conflicting body/query organization IDs fail; only authenticated selection supplies ownership.

Realtime rooms include organization ID. Actions and each recipient delivery revalidate membership. Membership revocation disconnects that organization's sockets; global credential/session changes disconnect all identity sockets. `online_users` uses `{ organization_id, users }` for tenant sockets. Deferred hooks capture immutable tenant context. Global `account_updated` carries no tenant data and only triggers identity refetch.

New uploads register owner and organization and use organization-prefixed object names. Signing/deletion checks database ownership first; legacy CVs, receipts, avatars and chat attachment references retain original paths. Existing signed URLs cannot be revoked after issue, so their configured expiry remains the access limit. Identity audit events have a separate global table; tenant audit events retain explicit ownership, including scheduled jobs. Legacy Zoho environment credentials are usable only inside stechad; other organizations report unconfigured.

Organization owners and HR administrators remain separate. Creating an organization currently gives its owner a basic staff HR profile; automatic HR super-admin provisioning was rejected by automatic approval review. Existing stechad HR super-admin access is preserved. New production organization creation stays gated pending deployment review and trusted HR-role provisioning; no platform privileges are inferred.
