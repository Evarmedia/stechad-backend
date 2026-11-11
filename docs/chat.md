# Chat rollout and contracts

Deploy the backend migration and enforcement before deploying the frontend. For an existing installation, run `npm run migrate:chat` using the backend's normal database environment, then start the new backend. Startup also runs the migration automatically, including when `DB_SYNC_ALTER=disabled`. Fresh databases are initialized by the application's normal schema synchronization and then migrated. Set `DB_SYNC_ALTER=false` to create missing tables without automatic alterations. Do not disable synchronization before initializing a fresh application's base schema.

Versioned Sequelize migrations live in `migrations/` and use the environment in `config/config.js`. Run `npm run db:migrate` during deployments and `npm run db:migrate:status` to inspect applied versions. `migrate:chat` remains the idempotent compatibility migration for installations created before Sequelize migration tracking was introduced.

The migration is additive, transactional, and safe to repeat. A schema-specific advisory lock serializes concurrent migration runs. It retains messages, memberships, and creators; adds group settings, per-user chat state, a database message sequence, and notification/message links with recipient uniqueness. No destructive history migration is required. Existing members have no clear boundary or unread baseline; existing groups allow all members to post.

The migration also repairs a message sequence counter left behind by an older default or a database restore. While holding the message write lock, it restarts the counter above existing message sequences and personal clear/unread watermarks, preserving an already higher counter. Existing messages and boundaries are never renumbered. Run `npm run migrate:chat` or restart the backend if sends fail with a duplicate `messages_sequence_unique` value.

## Authorization

New direct contacts: admins/super admins can select all active users; PMs can select engineers, staff and PMs; staff can select staff and PMs; engineers can select active senders of actual incoming direct messages. Existing direct threads remain replyable. Empty chats and shared groups do not qualify engineers; soft deletion and personal clearing preserve eligibility.

Group/support creation requires an admin, super admin or PM. Only the creator, while still in one of those roles, can manage the group. Adding members uses that creator's allowed contacts. Groups are limited to 100 members including the creator, who cannot remove themselves. Ownership transfer is not supported. All current members can view the roster and basic profiles; removed members cannot read, send, type or receive further chat events. Re-added members see history after their own clear boundary, with an unread baseline at re-addition. Posting restrictions apply to REST and Socket.IO.

## REST additions

All endpoints require authentication. Message writes and active group management require current membership. Former members may read, clear, or delete only their sequence-capped group archive.

| Method | Path (under `/api/chat`)                                  | Purpose                                                                                                                                                     |
| ------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/users?context=direct\|group&search=...&page=1&limit=50` | Eligible contacts filtered before pagination. Optional `chat_id` for an existing group requires creator management permission and excludes current members. |
| POST   | `/:chat_id/clear`                                         | Clear caller's history; returns `cleared_through_sequence`.                                                                                                 |
| DELETE | `/:chat_id`                                               | Clear and hide the chat for the caller until a newer message arrives.                                                                                       |
| POST   | `/:chat_id/leave`                                         | Leave a group and retain an archive capped at the departure sequence.                                                                                       |
| PATCH  | `/:chat_id`                                               | Creator updates `chat_name` (1–100), `description` (0–1,000), `posting_policy` (`all_members` or `creator_only`). Other fields are rejected.                |
| POST   | `/:chat_id/members`                                       | Creator adds `participant_ids`.                                                                                                                             |
| DELETE | `/:chat_id/members/:user_id`                              | Creator removes member.                                                                                                                                     |
| POST   | `/:chat_id/image`                                         | Creator uploads multipart `avatar`: JPEG/PNG/WebP, maximum 2 MB. MIME and file signature checked.                                                           |
| DELETE | `/:chat_id/image`                                         | Creator removes stored image.                                                                                                                               |
| GET    | `/:chat_id/members/:user_id/profile`                      | Current member's name, signed avatar, role, job title, department/company, city/country. No email, phone, HR data or precise location.                      |

Conversation responses include `can_manage`, `can_post`, `cleared_through_sequence`, group settings and signed `avatar_url`. Message sequences are decimal strings; clients must compare them as integers, not lexicographically or as floating-point numbers. File storage uses the existing GCS integration; uploading/signing needs the same credentials as existing avatars.

## Realtime and clearing

Existing events remain supported. Personal-room additions are `history_cleared`, `group_updated`, `membership_revoked`, `notification_created`, and `notifications_changed`. A group update tells clients to refetch caller-specific details. Revocation is sent explicitly to the removed user's personal room. Message event payloads are personalized for each recipient's clear boundary, including quoted reply redaction.

Sends, clears and membership changes lock the chat row. A clear records the highest committed sequence in that chat, zeros the caller's unread count, and deletes their related notifications. Message reads/searches/previews and edits enforce this boundary. New sends receive larger sequences. Idempotent retries reuse their message UUID and do not recreate notifications or alert events; retries by a sender who has cleared that message return 409.

Personal deletion uses the same history boundary and records a nullable inbox-hide boundary. It does not change membership or another participant's copy. Empty chats remain hidden, while any newer message makes the chat visible again. Starting an existing direct conversation also restores it for the caller without restoring cleared messages.

When both members of a direct conversation have deleted the same current history, the chat, its messages, notifications, and per-user state are physically deleted in one transaction. A newer message after only one member deleted prevents that older deletion marker from purging the restored conversation.

Leaving a group removes the caller from active membership and records the last visible message sequence. The archived thread can read only messages at or below that boundary and cannot post, receive notifications, typing events, or newer previews. The former member can clear or delete the archive. Re-adding them removes the departure boundary while retaining their personal clear boundary.

Notification writes are in the send transaction, one per active recipient and message. Reading messages marks their notifications read. Notifications link to the recipient's correct messages route with `?chat=<id>`. Reconnecting clients refresh history without replaying sounds. The frontend uses an IndexedDB unique key to deduplicate alerts across tabs, shares focused-conversation activity through localStorage, and stores independent sound and visual-popup preferences per user/browser. Audio unlocks after interaction; playback failure leaves visual alerts available. No OS push API is used.

## Verification

Run `CHAT_TEST_DATABASE_URL='<isolated PostgreSQL URL>' npm test`. The integration suite creates and drops only its randomly named schemas. It covers role/forged-request matrices, engineer eligibility, REST/socket posting, creator restrictions including support chats, profiles, clear/search/quotes/notifications, concurrent sends, retry deduplication, member removal/re-add, upload validation, the 100-member cap, and legacy migration without automatic sync.

Frontend validation: production build; TypeScript diagnostics compared to the existing baseline; desktop and 320 px browser flows with separate role sessions and shared tabs. Browser checks include group settings/images/members, profiles, pickers, delayed history after clearing, revoked open views, notification links, focus suppression, audio unlock, persistent mute, and cross-tab chime deduplication. The production storage service and a production deployment are not exercised by local tests.
