const sessions = require('../services/authSessions');
const { User, AuthSession } = require('../models');
const sequelize = require('../config/database');
const respondError = (res, error) => res.status(error.status || 401).json({ success: false, message: error.message, code: error.code });
const refreshAccessToken = async (req, res) => {
  const token = req.body.refresh_token;
  if (typeof token !== 'string' || !token) return res.status(400).json({ success: false, message: 'A refresh token is required' });
  try { const data = await sessions.rotateRefreshToken(token, { request: req }); res.set('Cache-Control', 'no-store'); return res.json({ success: true, data }); }
  catch (error) { return respondError(res, error); }
};
const listSessions = async (req, res) => {
  try {
    const currentId = req.authSession?.session_id || null;
    const rows = await AuthSession.findAll({ where: { user_id: req.identity.user_id }, order: [['created_at', 'DESC']], limit: 100 });
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, data: { current_session_id: currentId, sessions: rows.map(row => ({ ...sessions.sessionView(row), current: row.session_id === currentId })) } });
  } catch (error) { return respondError(res, error); }
};
const deleteSession = async (req, res) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.sessionId)) return res.status(404).json({ success: false, message: 'Session not found' });
    await sessions.revokeSession(req.identity.user_id, req.params.sessionId, { reason: 'user_revoked' });
    return res.json({ success: true, data: { revoked: true, current_session: req.authSession?.session_id === req.params.sessionId } });
  } catch (error) { return respondError(res, error); }
};
async function invalidateAll(userId, reason) {
  return sequelize.transaction(async transaction => {
    const user = await User.unscoped().findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
    await user.update({ session_version: user.session_version + 1 }, { transaction });
    await sessions.revokeAllSessions(userId, { reason, transaction });
  });
}
const logoutAll = async (req, res) => {
  try { await invalidateAll(req.identity.user_id, 'logout_all'); return res.json({ success: true, data: { revoked: true } }); }
  catch (error) { return respondError(res, error); }
};
module.exports = { refreshAccessToken, listSessions, deleteSession, logoutAll, invalidateAll };
