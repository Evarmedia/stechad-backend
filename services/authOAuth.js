const crypto = require('node:crypto');
const sequelize = require('../config/database');
const { AuthOAuthAttempt, User } = require('../models');
const { runWithoutTenant } = require('./tenantContext');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const bad = () => Object.assign(new Error('Invalid or expired OAuth exchange'), { status: 400 });
const cookieName = 'stechad_oauth_state';
const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/auth/google/callback', maxAge: 600000 });
const cookieFrom = req => (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
async function start(req, res) {
  const challenge = req.query.code_challenge;
  const returnTo = req.query.return_to || '/google-auth';
  if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || !['/google-auth', '/platform-admin.html'].includes(returnTo)) throw bad();
  const state = crypto.randomBytes(32).toString('base64url'); const browser = crypto.randomBytes(32).toString('base64url');
  await runWithoutTenant(() => AuthOAuthAttempt.create({ state_hash: hash(state), browser_hash: hash(browser), code_challenge: challenge, return_to: returnTo, expires_at: new Date(Date.now() + 600000) }));
  res.cookie(cookieName, browser, cookieOptions());
  return state;
}
async function bindCallback(req) {
  const browser = cookieFrom(req); const state = req.query.state;
  if (!browser || typeof state !== 'string') throw bad();
  return runWithoutTenant(() => sequelize.transaction(async transaction => {
    const attempt = await AuthOAuthAttempt.findOne({ where: { state_hash: hash(state) }, transaction, lock: transaction.LOCK.UPDATE });
    if (!attempt || attempt.browser_hash !== hash(browser) || attempt.callback_at || new Date(attempt.expires_at) <= new Date()) throw bad();
    await attempt.update({ callback_at: new Date() }, { transaction });
    return attempt.attempt_id;
  }));
}
async function complete(attemptId, user) {
  if (!user.is_active || !user.is_verified || user.deleted_at) throw bad();
  const code = crypto.randomBytes(32).toString('base64url');
  const attempt = await runWithoutTenant(() => AuthOAuthAttempt.findByPk(attemptId));
  if (!attempt?.callback_at || attempt.code_hash || attempt.consumed_at || new Date(attempt.expires_at) <= new Date()) throw bad();
  await attempt.update({ user_id: user.user_id, code_hash: hash(code), expires_at: new Date(Date.now() + 60000) });
  return { code, returnTo: attempt.return_to };
}
async function exchange(code, verifier, request) {
  if (typeof code !== 'string' || typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw bad();
  return runWithoutTenant(() => sequelize.transaction(async transaction => {
    const attempt = await AuthOAuthAttempt.findOne({ where: { code_hash: hash(code) }, transaction, lock: transaction.LOCK.UPDATE });
    if (!attempt || !attempt.callback_at || attempt.consumed_at || new Date(attempt.expires_at) <= new Date() || crypto.createHash('sha256').update(verifier).digest('base64url') !== attempt.code_challenge) throw bad();
    const user = await User.unscoped().findByPk(attempt.user_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!user?.is_active || !user.is_verified || user.deleted_at) throw bad();
    await attempt.update({ consumed_at: new Date() }, { transaction });
    const credentials = await require('./authSessions').createSession(user, { transaction, request, authMethod: 'google' });
    return { ...await require('./organizationMembership').sessionView(user), ...credentials };
  }));
}
module.exports = { start, bindCallback, complete, exchange, cookieName, cookieOptions };
