const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const sequelize = require('../config/database');
const { User, AuthSession, AuthRefreshToken, AuthLegacyExchange, AuthSecurityState } = require('../models');
const { runWithoutTenant } = require('./tenantContext');
const fail = (message = 'Session is no longer valid', status = 401, code = 'SESSION_INVALID') => Object.assign(new Error(message), { status, code });
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const enforced = () => process.env.AUTH_SESSIONS_ENFORCED === 'true' || process.env.NODE_ENV === 'production';
const view = session => ({ session_id: session.session_id, created_at: session.created_at, last_seen_at: session.last_seen_at, expires_at: session.expires_at, revoked_at: session.revoked_at, auth_method: session.auth_method, user_agent: session.user_agent });
async function activation(transaction) {
  const state = await AuthSecurityState.findByPk('sessions', { transaction });
  if (!state && enforced()) throw fail('Managed session storage is not activated', 503, 'AUTH_SESSIONS_UNAVAILABLE');
  return state;
}
function validIdentity(user, decoded) {
  if (!user?.is_active || user.deleted_at || (decoded.session_version || 0) !== user.session_version) throw fail();
}
async function credentials(user, session, transaction) {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  await AuthRefreshToken.create({ token_hash: digest(refreshToken), session_id: session.session_id, expires_at: session.expires_at }, { transaction });
  const token = jwt.sign({ user_id: user.user_id, sid: session.session_id, session_version: user.session_version, token_use: 'access' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: process.env.JWT_ACCESS_EXPIRATION || '15m' });
  return { token, refreshToken, session: view(session) };
}
async function createSession(user, { transaction, request, authMethod = 'password', authenticatedAt = new Date() } = {}) {
  return runWithoutTenant(async () => {
    if (!transaction) return sequelize.transaction(t => createSession(user, { transaction: t, request, authMethod, authenticatedAt }));
    await activation(transaction);
    // Serialize issuance with password/global-status mutations.
    const current = await User.unscoped().findByPk(user.user_id, { transaction, lock: transaction.LOCK.UPDATE });
    validIdentity(current, { session_version: user.session_version });
    const lifetime = Math.min(Math.max(Number(process.env.AUTH_SESSION_LIFETIME_SECONDS) || 86400, 60), 2592000);
    const session = await AuthSession.create({ user_id: current.user_id, session_version: current.session_version, auth_method: authMethod, authenticated_at: authenticatedAt, expires_at: new Date(Date.now() + lifetime * 1000), user_agent: String(request?.get?.('User-Agent') || '').slice(0, 512) || null }, { transaction });
    return credentials(current, session, transaction);
  });
}
async function checkLegacy(decoded, transaction) {
  const state = await activation(transaction);
  if (state && (!decoded.iat || decoded.iat >= Math.floor(new Date(state.activated_at).getTime() / 1000) || Date.now() >= new Date(state.legacy_until).getTime())) throw fail('Legacy session must sign in again');
  return state;
}
async function authenticateAccessToken(token, { transaction } = {}) {
  return runWithoutTenant(async () => {
    let decoded; try { decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }); } catch { throw fail(); }
    const identity = await User.unscoped().findByPk(decoded.user_id, { transaction }); validIdentity(identity, decoded);
    if (!decoded.sid) { await checkLegacy(decoded, transaction); return { identity, session: null, legacy: true }; }
    await activation(transaction);
    const session = await AuthSession.findByPk(decoded.sid, { transaction });
    if (decoded.token_use !== 'access' || !session || session.user_id !== identity.user_id || session.session_version !== identity.session_version || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) throw fail();
    return { identity, session, legacy: false };
  });
}
async function revokeSession(userId, sessionId, { reason = 'logout', transaction } = {}) {
  return runWithoutTenant(async () => {
    if (!transaction) return sequelize.transaction(t => revokeSession(userId, sessionId, { reason, transaction: t }));
    const session = await AuthSession.findOne({ where: { session_id: sessionId, user_id: userId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!session) throw fail('Session not found', 404);
    if (!session.revoked_at) await session.update({ revoked_at: new Date(), revoked_reason: reason }, { transaction });
    require('../utils/events').afterCommit(transaction, () => require('../utils/events').disconnectSession(sessionId));
    return session;
  });
}
async function revokeAllSessions(userId, { reason = 'logout_all', transaction } = {}) {
  return runWithoutTenant(async () => {
    if (!transaction) return sequelize.transaction(t => revokeAllSessions(userId, { reason, transaction: t }));
    await AuthSession.update({ revoked_at: new Date(), revoked_reason: reason }, { where: { user_id: userId, revoked_at: null }, transaction });
    require('../utils/events').afterCommit(transaction, () => require('../utils/events').disconnectUser(userId));
  });
}
async function rotateRefreshToken(token, { request } = {}) {
  return runWithoutTenant(async () => {
    const result = await sequelize.transaction(async transaction => {
      // Consistently lock identity before session before refresh credential.
      const candidate = await AuthRefreshToken.findByPk(digest(token), { transaction });
      if (!candidate) {
        let decoded; try { decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] }); } catch { throw fail(); }
        if (decoded.sid || decoded.token_use) throw fail();
        await checkLegacy(decoded, transaction);
        const user = await User.unscoped().findByPk(decoded.user_id, { transaction, lock: transaction.LOCK.UPDATE }); validIdentity(user, decoded);
        if (await AuthLegacyExchange.findByPk(digest(token), { transaction })) throw fail('Legacy refresh was already exchanged');
        await AuthLegacyExchange.create({ token_hash: digest(token), user_id: user.user_id }, { transaction });
        return createSession(user, { transaction, request, authMethod: 'legacy_exchange' });
      }
      const initial = await AuthSession.findByPk(candidate.session_id, { transaction });
      const user = initial && await User.unscoped().findByPk(initial.user_id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user) throw fail();
      const session = await AuthSession.findByPk(candidate.session_id, { transaction, lock: transaction.LOCK.UPDATE });
      validIdentity(user, session);
      const credential = await AuthRefreshToken.findByPk(digest(token), { transaction, lock: transaction.LOCK.UPDATE });
      if (session.revoked_at || new Date(session.expires_at) <= new Date() || new Date(credential.expires_at) <= new Date()) throw fail();
      await activation(transaction);
      if (credential.consumed_at) {
        const raceMs = Math.min(Math.max(Number(process.env.AUTH_REFRESH_RACE_MS) || 5000, 0), 5000);
        if (Date.now() - new Date(credential.consumed_at).getTime() <= raceMs) return { error: fail('Refresh already rotated; adopt the newer token', 409, 'REFRESH_ALREADY_ROTATED') };
        await revokeSession(user.user_id, session.session_id, { transaction, reason: 'refresh_reuse' });
        return { error: fail('Refresh credential reuse revoked this session') };
      }
      await credential.update({ consumed_at: new Date() }, { transaction });
      await session.update({ last_seen_at: new Date() }, { transaction });
      return credentials(user, session, transaction);
    });
    if (result.error) throw result.error;
    return result;
  });
}
async function assertSessionStorageReady() {
  const q = sequelize.getQueryInterface();
  for (const tableName of Object.keys(require('./authSessionSchema')(require('sequelize').DataTypes))) await q.describeTable({ tableName, schema: sequelize.options.schema || 'public' });
  const state = await AuthSecurityState.findByPk('sessions');
  const activated = new Date(state?.activated_at).getTime();
  const until = new Date(state?.legacy_until).getTime();
  if (!state || !Number.isFinite(activated) || !Number.isFinite(until) || activated > Date.now() || until <= activated || until - activated > 86400000) throw fail('Managed session activation is invalid', 503, 'AUTH_SESSIONS_UNAVAILABLE');
  return { activated_at: state.activated_at, legacy_until: state.legacy_until };
}
module.exports = { assertSessionStorageReady, createSession, authenticateAccessToken, rotateRefreshToken, revokeSession, revokeAllSessions, sessionView: view };
