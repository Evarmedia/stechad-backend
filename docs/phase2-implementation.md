# Phase 2 authentication and platform administration

Phase 2 implements revocable global identity sessions and explicitly granted, MFA-protected platform administration while preserving organization-bound HR access. Implementation and public-boundary checks are complete; independent Standards and Spec reviews remain pending. This document does not authorize deployment, application-database migrations or real-account privilege assignment.

The scope is tracked by [managed sessions #9](https://github.com/Evarmedia/stechad-backend/issues/9), [platform authority #10](https://github.com/Evarmedia/stechad-backend/issues/10), [the internal frontend #4](https://github.com/Evarmedia/stechad-talent-hub/issues/4) and [final verification #11](https://github.com/Evarmedia/stechad-backend/issues/11).

## Delivered behavior

- Password and verified Google authentication issue managed sessions with short-lived access tokens and rotating opaque refresh credentials. Logout, logout-all, device revocation and password recovery invalidate the appropriate sessions and sockets. Concurrent rotation returns one winner and a bounded credential-free conflict; later replay revokes that device. Existing signed credentials have a migration-anchored, finite HR-only transition.
- Platform authority comes from live explicit grants, never HR roles, organization ownership or JWT role claims. Sanitized metadata, status changes, grants and platform audits enforce permissions, audit reasons and fresh session-bound MFA. Grant and privileged-account mutations preserve an active platform super admin and reject self-lockout.
- TOTP enrollment uses encrypted factors, transactional replay prevention, account-wide throttling and hashed one-use recovery codes. Refresh does not extend the fifteen-minute assurance. TOTP is not phishing-resistant; no assurance-level certification is claimed.
- The separate `/platform-admin.html` frontend shares global identity transport, supports MFA and permitted administration, and does not require organization membership or mount customer HR providers. Customer account settings expose device-session controls. Shared refresh coordination and stale-response guards protect concurrent tabs and organization switching.

## Verification evidence

All database tests use disposable PostgreSQL 17 schemas on an isolated loopback instance. No application `.env`, application database or real operator account was used.

| Boundary | Result |
| --- | --- |
| Full backend suite at `f82f61c` | 143 passed, zero failed or skipped; actual HTTP, PostgreSQL and Socket.IO coverage |
| Production composition and migration CLI | Included in that suite: fail-closed readiness, public login/platform separation, repeated security migrations, unchanged fixture password/HR role, zero automatic platform grants and tenancy verification |
| Frontend rendered and transport suite at `bd9c9f9` | 101 passed across 22 files |
| Customer and platform production build | Passed for both entry points. Existing large-bundle warning remains |
| Frontend typecheck and lint | Existing 20 type errors and 41 lint errors remain; lint warnings are 14 versus the baseline 15. These checks are not green |
| Controlled headless-Chrome journeys | Passed: password errors/success; MFA setup/confirmation/recovery/replacement/expiry; role-limited metadata, reason-required status/grant actions, catalog/audit; search/empty/clear; narrow layout, reduced motion and focus; exactly one refresh across two tabs, logout and Google PKCE/code exchange |
| Actual backend + frontend Chrome smoke | Passed against the actual application server: password sign-in, real TOTP enrollment/confirmation, operator with zero memberships, sanitized organization/user/audit metadata, HR-only super-admin denial and cross-tab logout |
| Independent Standards and Spec reviews | Pending; Phase 2 must not be reported complete until findings are resolved |

The migration rehearsal runs the additive session and platform migrations twice against fixture data, preserves activation timestamps and existing credentials/HR roles, and verifies that global security tables remain outside tenant ownership. Bootstrap dry-run and explicit apply are tested only with disposable verified identities. Test doubles are confined to external-provider transport where relevant; platform authorization is exercised through its real HTTP/database boundary.

The cross-repository Chrome smoke also stores an unrelated organization selection before platform reads: requests still omit `X-Organization-Id`, and the internal entry issues no HR-provider requests. The controlled browser checks exposed an in-flight response restoring the admin UI after another tab signed out; identity-revision guards and token-removal handling now prevent that restoration. Both tabs clear their admin UI in the actual-backend smoke.

## Rollout and operational limits

Use the [managed-session runbook](managed-sessions.md) and [platform administration runbook](platform-administration.md) for environment keys, API contracts, bootstrap and recovery constraints. The [accepted architecture decision](adr/0002-managed-sessions-and-explicit-platform-authority.md) records the separation from HR authority.

Coordinate frontend and backend rollout for opaque refresh credentials and the Google PKCE exchange. Drain old authentication writers before the first session migration activates: tokens minted at or after that activation cannot enter the legacy compatibility path. Preserve the original JWT secrets during the finite legacy window. Apply session storage before platform storage and verify tenancy/readiness before admitting traffic. Production composition fails closed when managed-session activation is absent or invalid.

Supply the same dedicated MFA encryption key to every API instance and back it up separately from the database; replacing it alone makes existing factors unreadable. Keep explicit bootstrap dry-run as the default and review the selected database, schema and verified identity before any separately authorized real grant. No identity or HR promotion happens automatically.

The security migrations are intentionally forward-only. A rollback must preserve managed-session storage, revocation and authority enforcement; reverting to stateless authentication would discard these guarantees. Deployment domains remain configuration choices, and production readiness also requires the operator's deployment and secret-management checks.

Phase 3 product activation, assignments, subscriptions, billing, payment integration, tenant HR impersonation and broader application restructuring remain outside this work. No deployment or real-account platform grant was performed.
