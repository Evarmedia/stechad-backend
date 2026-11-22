# Phase 1 implementation

Both repositories use `phase1-tenancy-integration`. The existing HR product remains in place; this phase adds organization ownership and separates global identity from HR access. Nothing has been deployed and the application database has not been migrated.

```mermaid
flowchart LR
  U[Global identity] --> M[Organization membership]
  O[Organization] --> M
  M --> H[HR profile]
  H --> R[Organization HR role and grants]
  O --> D[Owned HR records, files, events and jobs]
```

Existing users, roles, grants, history and file references migrate into stechad. The migration freezes its legacy identity population so reruns cannot enroll future users from other organizations. Organization-specific HR profiles hold employment, reporting, preferences and reward balances. Removing HR access preserves the global account and its other memberships.

Organization APIs provide creation, listing, settings, invitations, membership changes and leaving, with transactional last-owner protection. Existing invitees authenticate with the matching verified identity; new invitees create credentials using a single-use emailed token. Frontend selection is per tab, resets tenant providers/caches, rejects old responses and reconnects sockets with explicit organization ownership. Unavailable HR membership returns to selection without signing out the global identity.

Workforce, recruitment, projects, referrals, rewards, chat, notifications, files, reports and background work use validated ownership. Shared-account tests exercise different HR roles in two organizations. Socket delivery revalidates recipients; deferred events wait for the outer transaction and do not publish rolled-back writes. Legacy Zoho credentials are restricted to stechad.

Registered avatars are organization-owned files, including uploads stored under the legacy `profile-images` folder. Members of that organization may read them; a different organization cannot sign a registered avatar even when the same global User references its path. Existing object names are preserved, and unregistered legacy avatar references remain readable only through validated same-organization membership. CV and receipt reads retain their separate owner/HR-permission checks. File permissions use the canonical HR grant resolver, with existing admin, HR super-admin and project-manager recruiting CV eligibility retained independently of workforce-management grants.

## Validation

- Full backend regression after review fixes: 124 tests passed, zero skipped, using disposable schemas in an isolated local PostgreSQL cluster. The final recruiting-role CV compatibility adjustment additionally passed all six tenant-file HTTP/PostgreSQL tests, including admin CV access with workforce-management grants disabled.
- Frontend: 19 suites / 87 tests passed; production build passed. Headless Chrome exercised switching, keyboard/mobile behavior, independent tabs, delayed responses, membership revocation, no-HR membership and existing-account invitation acceptance against controlled HTTP fixtures.
- Migration rehearsal: dry-run, apply twice, verify, stable identifiers/hashes/grants, deleted/orphan history, pending invitations and file references; future organization identities remain outside the stechad backfill. Runtime readiness rejects a missing checkpoint.
- Existing frontend debt remains: typecheck has 20 baseline errors; lint has 41 baseline errors and 15 warnings. Comparison against the original baseline found no new failures. These checks are not reported as passing.

## Review

Independent Standards review found one missing API-documentation update and two duplicated authorization paths; all three are resolved and rechecked. Independent Spec review found owner-membership authority and uploaded-avatar visibility defects; both are fixed, covered by HTTP/PostgreSQL regressions and rechecked by the original reviewer. No findings remain from either review.

## Cutover boundary

Follow [the migration runbook](tenancy-foundation.md) and [organization API contract](organization-memberships.md). Back up and rehearse against a production-like copy, drain old writers, run existing versioned migrations, apply the explicit tenancy migration and verify before starting the new server. Runtime HR access fails closed until verification succeeds. Retained orphan history is reported and preserved; cross-organization references fail verification.

Organization creation remains disabled by default (`ENABLE_ORGANIZATION_CREATION`). New owners receive a basic staff HR profile; existing stechad HR super-admin access remains intact. Automatic approval review rejected automatic HR super-admin provisioning as persistent privilege escalation, so trusted HR-role provisioning and production enablement remain an explicit operator decision. No platform-wide privileges are inferred.

Live Google OAuth, email, GCS and Zoho production integrations were not exercised. External transports were controlled in tests. Existing signed file URLs remain valid until their configured expiry. Production cutover and all later roadmap phases require separate review; this implementation does not enable subscriptions or new suite products.

The next roadmap phase is Phase 2 authentication and platform authorization. It has not started and requires separate approval.
