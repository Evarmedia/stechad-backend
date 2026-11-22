# Managed identity sessions

Password signup/login, password changes, Google exchange and talent profile/onboarding token responses issue global managed sessions. Existing `token` and `refreshToken` keys remain. Responses append a safe `session` object. Access JWTs contain `user_id`, `sid`, `session_version` and `token_use: access`; HR/platform authority is resolved from current storage.

Apply the additive versioned migration `20261122100000-managed-auth-sessions.js` through the ordinary migration command before enabling `AUTH_SESSIONS_ENFORCED=true`. Production always enforces storage. `assertSessionStorageReady()` checks the global tables, required columns and immutable activation state without creating anything. No runtime sign-in seeds activation. Historical isolated fixtures can use `AUTH_SESSIONS_ENFORCED=false`, but a token containing `sid` always needs a live matching managed session.

`auth_security_state` has one row with `state_key=sessions`, first migration `activated_at`, and `legacy_until=activated_at+24 hours`. Migration retries preserve both timestamps. Signed pre-activation HR tokens remain usable only until their original expiry and that deadline, with account activity/session-version checks. Tokens minted in or after the activation second are refused by compatibility. A legacy refresh digest exchanges once transactionally; it cannot create multiple sessions. Platform operations always require managed sessions.

Access lifetime defaults to 15 minutes (`JWT_ACCESS_EXPIRATION`). Device sessions default to 24 hours (`AUTH_SESSION_LIFETIME_SECONDS`, bounded to 60 seconds–30 days). Refresh values are opaque random credentials; only SHA-256 hashes persist. Rotation serializes identity/session/credential updates. A consumed refresh returns `409 REFRESH_ALREADY_ROTATED` without credentials within at most five seconds (`AUTH_REFRESH_RACE_MS`, maximum 5000). The browser adopts the winner's shared token. Later reuse commits revocation of that device, including its sockets. Refresh does not renew primary-authentication time or platform MFA assurance.

All security tables are global, are excluded from tenant ownership/backfill and retain no organization identifier. Never put refresh values, hashes, passwords, reset codes or OAuth codes into audit records or request logs. Do not copy credentials between environments.

## HTTP contract

- `GET /api/auth/sessions` returns `data.current_session_id` and up to 100 recent sessions with `session_id`, timestamps, `auth_method`, `user_agent` and `current`.
- `DELETE /api/auth/sessions/:sessionId` revokes an owned device; `data` contains `revoked` and `current_session`.
- `POST /api/auth/logout` revokes the current managed session. A legacy session has no device identity, so logout invalidates its account version.
- `POST /api/auth/logout-all` invalidates all sessions and legacy tokens for that global identity.
- `POST /api/auth/refresh-token` retains `{refresh_token}` input and `data.token`/`data.refreshToken` output, adding session metadata.
- Password recovery locks the account, consumes the existing valid OTP once, changes its password, increments session version and revokes sessions in one transaction. Password changes revoke older sessions and issue one replacement.

Session revocation publishes Socket.IO disconnects after commit to `session_<session_id>`. Each socket action verifies the original access credential and live session again, including expiry. Tenant room membership checks continue independently.

## Google browser exchange

Generate a 43–128 character PKCE verifier per tab and keep it in sessionStorage. Navigate to `/api/auth/google?code_challenge=<SHA256-base64url>&return_to=/google-auth`; the only other allowed return path is `/platform-admin.html`. The backend records a one-use state and binds it to an HttpOnly SameSite=Lax cookie (Secure in production).

The callback validates state/cookie binding before the provider exchange, then checks Google's verified email and active global identity. It redirects to the configured frontend origin and allowed return path with a random one-minute `code`, never access or refresh tokens. Call `POST /api/auth/oauth/exchange` with `{code,code_verifier}` to receive the usual managed login response. Invalid/expired/reused state or code fails closed. A wrong verifier does not consume the valid code. Configure the ordinary Google client ID/secret, backend callback URL and frontend origin; no domain or provider resources are provisioned by this change.

## Disposable verification

Set `SESSIONS_TEST_DATABASE_URL` to a disposable PostgreSQL database and run `node --test test/auth-sessions.integration.test.js`. The suite creates a random schema, mounts the actual HTTP routes and Socket.IO, and fakes only Google's external token/profile transport. It covers device isolation, rotation races/replay, transactional reset consumption, state-bound PKCE exchange, socket revocation and the fixed legacy deadline. Existing email, user-management and chat regressions remain relevant. Never run fixture or bootstrap commands against application data.
