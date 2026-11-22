# Explicit platform administration

Platform grants are global and independent of HR roles, organization ownership and memberships. No identity receives a platform grant on signup, Google sign-in, organization creation or migration. The initial catalog is fixed in `services/platformCatalog.js`:

| Role | Authority |
| --- | --- |
| `platform_super_admin` | Organization/user metadata and status, grants/catalog and platform audits |
| `platform_operator` | Organization/user metadata and status, platform audits; cannot mutate privileged identities |
| `platform_viewer` | Organization/user metadata and platform audits |

Platform grants confer no HR access. Customer HR routes continue to require active organization membership, an HR profile and the applicable tenant HR permission. The internal administration frontend uses the separate `/platform-admin.html` entry; production hostnames remain a deployment configuration choice.

## Configuration and migration

Set `PLATFORM_MFA_ENCRYPTION_KEY` to one cryptographically random 32-byte key, encoded as canonical base64. Generate it with the deployment secret manager or `node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"` in a trusted operator environment. Store it as a secret, supply the same value to every API instance, and protect its backup separately from database backups. Never commit it, log it, or put it in browser configuration.

Run the existing versioned migration workflow with an explicitly selected database/schema during an approved rollout. `20261122100000-managed-auth-sessions.js` must precede `20261122110000-explicit-platform-authority.js`; the latter adds five global tables and seeds only the three role records. It never grants a user. Follow with `migrate-tenancy --verify` for the same explicit database/schema. The global tables must have no `organization_id` ownership column.

Missing or invalid MFA encryption configuration fails closed with `503 MFA_UNAVAILABLE`. Existing ciphertext is bound to its user ID with AES-256-GCM. Replacing the environment key alone makes current factors unreadable; there is no automatic key-rotation or factor-reset bypass. Preserve the existing key while designing and approving any later rotation/recovery procedure. A restored database needs its matching key and current managed-session state.

## Deliberate initial bootstrap

Choose an existing active global identity whose email is verified. Bootstrap does not create an identity, verify an email, alter an HR role, create a membership or enable organization creation.

```sh
node scripts/bootstrap-platform-super-admin.js \
  --database-url "$TARGET_DATABASE_URL" --schema "$TARGET_SCHEMA" \
  --email operator@example.com --reason 'Approved initial platform operator'
```

This defaults to a read-only dry-run and returns the selected identity and intended role. Review the exact database/schema and identity before the separately authorized application step. Add `--apply` to apply; it creates an explicit grant and a `platform.bootstrap.super_admin_granted` identity audit event atomically. An already active grant is idempotent. Command output never includes credentials or MFA secrets. Real privilege assignment was not performed during implementation; tests use disposable fixture identities and schemas only.

Sign in with password or verified Google authentication, open the internal administration entry, and enroll an authenticator within ten minutes. A session created by legacy refresh exchange cannot authorize first enrollment; sign in again. Before MFA, `/api/platform/me` exposes only the current operator's identity, roles, permissions and MFA state. The MFA provisioning endpoints disclose no organization/user listings.

## MFA and session behavior

Enrollment returns the secret and `otpauth://` URI once for that pending setup, which expires after ten minutes and is bound to the initiating managed session. Keep pending secrets off logs and error trackers. Confirmation validates a six-digit RFC 6238 TOTP (SHA-1, 30 seconds, at most one adjacent timestep) and returns ten high-entropy recovery codes once. Store those codes securely outside the authenticator device. Only hashes persist; consumed codes cannot be reused.

Successful TOTP or recovery verification grants at most fifteen minutes of assurance to that managed session and credential version. Refresh never extends assurance. Other sessions must verify separately. Expired assurance returns `MFA_EXPIRED`; absent assurance returns `MFA_REQUIRED`; unenrolled operators receive `MFA_SETUP_REQUIRED`. These responses do not end the ordinary HR session.

Replay state and five-attempt/15-minute lockout persist per global identity, so concurrent requests and other devices cannot bypass them. A consumed or older TOTP timestep fails even in a different session. Factor replacement requires fresh assurance plus `replace: true` and an audit reason; the old factor and recovery codes remain valid until confirmation, which rechecks assurance. Successful replacement increments the credential version, replaces recovery codes and invalidates older session assurances. TOTP is not phishing-resistant; this implementation does not claim an assurance-level certification.

## Administrative operations

Every `/api/platform` request requires a live active managed session, verified identity and current explicit grant. Every metadata operation also checks fresh MFA and its catalog permission. JWT role claims are ignored. Lists accept `page` (default 1), `limit` (default 25, maximum 100), and applicable `search`/`status` or `user_id`/`action` filters. Pagination is `{page, limit, total, total_pages}`. DTO allowlists exclude HR records, organization settings, credentials, refresh/session hashes, MFA secrets and recovery hashes.

Organization/global-user status changes and grant creation/revocation require a nonempty reason of at most 1,000 characters. Reasons are audit records: avoid putting credentials or personal case details in them. Organization suspension disconnects only that organization's socket memberships; unrelated organization access and global sessions continue. Global identity suspension invalidates its version and revokes every managed session. Reactivation does not restore old sessions.

Only grant-managing super admins can mutate identities that have platform grants. Self-lockout is rejected. Grant revocation and privileged global-account changes share a database transaction lock and preserve an active verified platform super admin once bootstrapped. Platform audit reads select `platform.*` events and explicitly allowlisted changes. Audit entries contain no submitted verification code, factor secret or raw recovery code.

Implementation checks use actual HTTP, PostgreSQL, Socket.IO and the bootstrap CLI through `PLATFORM_TEST_DATABASE_URL`; versioned migration CLI and tenancy verification are covered by the application-readiness rehearsal. All database checks require disposable schemas and fake external transports only.
