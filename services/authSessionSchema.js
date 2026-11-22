// Shared additive DDL and model definitions; these are global identity security tables.
module.exports = (S, table = name => name) => {
  const uuid = () => ({ type: S.UUID, allowNull: false, primaryKey: true });
  const date = () => ({ type: S.DATE, allowNull: false, defaultValue: S.NOW || S.fn('NOW') });
  const user = () => ({ type: S.UUID, allowNull: false, references: { model: table('users'), key: 'user_id' }, onDelete: 'CASCADE' });
  return {
    auth_sessions: { session_id: uuid(), user_id: user(), session_version: { type: S.INTEGER, allowNull: false }, auth_method: { type: S.TEXT, allowNull: false }, authenticated_at: date(), created_at: date(), last_seen_at: date(), expires_at: { type: S.DATE, allowNull: false }, revoked_at: S.DATE, revoked_reason: S.TEXT, user_agent: S.TEXT },
    auth_refresh_tokens: { token_hash: { type: S.STRING(64), primaryKey: true }, session_id: { type: S.UUID, allowNull: false, references: { model: table('auth_sessions'), key: 'session_id' }, onDelete: 'CASCADE' }, created_at: date(), expires_at: { type: S.DATE, allowNull: false }, consumed_at: S.DATE },
    auth_legacy_exchanges: { token_hash: { type: S.STRING(64), primaryKey: true }, user_id: user(), created_at: date() },
    auth_security_state: { state_key: { type: S.TEXT, primaryKey: true }, activated_at: date(), legacy_until: { type: S.DATE, allowNull: false } },
    auth_oauth_attempts: { attempt_id: uuid(), state_hash: { type: S.STRING(64), allowNull: false, unique: true }, browser_hash: { type: S.STRING(64), allowNull: false }, code_challenge: { type: S.STRING(43), allowNull: false }, return_to: { type: S.TEXT, allowNull: false }, user_id: { ...user(), allowNull: true }, code_hash: { type: S.STRING(64), unique: true }, created_at: date(), expires_at: { type: S.DATE, allowNull: false }, callback_at: S.DATE, consumed_at: S.DATE },
  };
};
