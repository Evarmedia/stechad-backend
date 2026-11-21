# Phase 1 tenancy foundation

This additive foundation does not enable production organization creation. The remaining Phase 1 work must scope existing controllers, authentication projections, realtime delivery, file authorization, jobs and external connections before enabling additional production organizations. Raw legacy model calls are still available until that integration lands; use the explicit primitives below for new code.

## Migration command

Run existing versioned migrations first, back up the database, drain legacy application instances/writers, and run against an explicit schema. The command never changes the application connection's Sequelize schema.

```sh
npm run migrate:tenancy -- --dry-run --database-url "$DATABASE_URL" --schema "$DB_SCHEMA"
npm run migrate:tenancy -- --apply --database-url "$DATABASE_URL" --schema "$DB_SCHEMA"
npm run migrate:tenancy -- --verify --database-url "$DATABASE_URL" --schema "$DB_SCHEMA"
```

`DATABASE_URL` and `DB_SCHEMA` are accepted instead of flags. Dry-run and verify use read-only transactions. Apply uses one transaction and a schema-specific advisory transaction lock, checks before/after legacy-row fingerprints, and rolls back on errors. It preserves IDs, timestamps, credential hashes, status, permission configuration and object references. No files move. Fingerprints currently aggregate row hashes in memory; large production rehearsals should measure that cost.

`tenancy_migration_state` freezes the original legacy identity population on the first successful apply. Reruns only backfill that snapshot, never enroll future users from another organization into stechad, never reset edited profiles or memberships, and reject ownerless rows appearing after cutover. `users` stays global. Every legacy user, including deleted users, receives a separate membership and HR profile. Suspended/deleted identity state initializes membership status without assigning platform privileges. Bootstrap role IDs and custom permission arrays stay intact.

The inventory in `services/tenancyInventory.js` includes all 30 current HR tables, including `ChatParticipants` and `talent_project`. Absent tables and unclassified tables are reported; unclassified tables block apply/verify. Tenant keys, role names, employee IDs in HR profiles, settings, departments, attendance and other owned uniqueness are indexed per organization. Global identity email/referral uniqueness stays global. Existing compatibility-only employee fields on User are no longer authoritative.

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

## Verification

The approved migration-command test uses disposable PostgreSQL schemas and runs dry-run, repeated apply and verify against custom grants, deleted users, orphan actors, pending invites, finance/file references and chat personal state. It also proves future organization-B identities are not enrolled into stechad by a rerun, and same-role names can coexist across organizations while cross-org role references fail.

The approved HTTP/PostgreSQL test covers concurrent A/B requests, ambiguous/malformed/forged selection, scoped by-ID reads, server-owned writes, suspension and contextless repository rejection. Configure `TENANCY_TEST_DATABASE_URL` to run both tests.
