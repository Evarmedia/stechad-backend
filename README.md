# STECHAD backend

## Email normalization and authentication

Email addresses are trimmed and lowercased on writes and matched without case sensitivity during authentication, invitations, and password recovery. Dots and plus tags are preserved. Signup, invitation acceptance, and password changes require at least six characters and matching confirmation; password resets also reject the current password.

Deploy both the backend and frontend. Migration `20261117140000-normalize-emails.js` runs during the normal backend startup migration step, or can be applied with `npm run db:migrate` using the target environment's database configuration. It normalizes users, invitations, and interview email snapshots, adds database constraints, and preserves password hashes. If multiple accounts resolve to the same lowercase address, the transaction rolls back and reports their user IDs; resolve those accounts before retrying. Undo removes the constraints and indexes but cannot restore original casing.

Run authentication and migration regression tests against a disposable PostgreSQL database:

```bash
AUTH_TEST_DATABASE_URL='postgres://user:password@localhost/stechad_auth_test' npm test
```

Each run creates and removes isolated schemas. Outbound email is stubbed; no real OTP messages are sent. Without `AUTH_TEST_DATABASE_URL`, these integration tests are skipped.

## Seed the Super Admin

The system permits exactly one `super_admin`. After the database schema has been synchronized, set the four `SUPER_ADMIN_*` values shown in `.env.example`, then run:

```bash
npm run seed:super-admin
```

The command is idempotent for the same email and will refuse to create or promote another account when a Super Admin already exists. The password must be at least 12 characters.

## Browser location addresses

Set `GEOAPIFY_API_KEY` to enable server-side reverse geocoding. When a user grants browser location consent, the backend sends the coordinate to Geoapify and stores the returned city, state, country, and formatted address. The API key is never sent to the browser.

Authenticated users can test the integration with `GET /api/staff/location/reverse-geo?lat=51.21709661403662&lon=6.7782883744862374` or the equivalent `POST` JSON body using `latitude` and `longitude`. The response includes normalized address fields and Geoapify's raw GeoJSON FeatureCollection. Set `GEOAPIFY_TIMEOUT_MS` to override the default 20-second provider timeout.

## Chat

Chat uses authenticated REST endpoints under `/api/chat` and Socket.IO on the same HTTP server. Both transports enforce conversation membership. Messages sent through either transport notify every participant's open tabs, including tabs viewing another conversation. The `participants` array on each chat remains the membership source.

- `GET /api/chat/users?search=...` lists active team members with names, roles, and avatars. It excludes private account fields.
- `GET /api/chat/search?query=...&chat_id=...` searches only conversations the caller belongs to.
- Message history supports `before_timestamp` plus `before_id` for stable pagination.
- Send requests accept an optional UUID `client_message_id`. Reusing it retries the original message without adding another row or unread count.
- Read receipts, edits, deletes, inbox previews, and unread counts are synchronized across participants. Deleted content is also removed from quoted replies.

The session refresh endpoint is `POST /api/auth/refresh-token` with `{ "refresh_token": "..." }`. It verifies the refresh-token signature and active account, then returns `data.token` and `data.refreshToken`. Configure both `JWT_SECRET` and `JWT_REFRESH_SECRET`, as required by login token generation.

Socket.IO authenticates with `auth: { token }`. It emits `new_message`, `chat_created`, `message_updated`, `message_deleted`, `messages_read`, `online_users`, `user_online`, `user_offline`, `user_typing`, and `user_stopped_typing`. Socket actions support acknowledgement callbacks returning `{ success, ... }` or `{ success: false, error, status }`.

The integration suite exercises fresh-database reward seeding, concurrent chat creation and sends, duplicate-safe retries, receipts, pagination, access controls, REST delivery, session refresh, and multiple socket connections per user:

```bash
CHAT_TEST_DATABASE_URL='postgres://user:password@localhost/stechad_chat_test' npm test
```

Use a disposable PostgreSQL database whose test user can create schemas. Each run creates and removes its own randomly named `chat_test_*` schema. Without `CHAT_TEST_DATABASE_URL`, the database tests are explicitly skipped; the application's configured database is never used by the suite.
