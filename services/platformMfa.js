const crypto = require('node:crypto');
const { User, PlatformMfaCredential: Credential, PlatformRecoveryCode: Recovery, PlatformSessionAssurance: Assurance } = require('../models');
const sequelize = require('../config/database');
const { fail, reason, audit, requireAccess } = require('./platformAuthorization');
const ASSURANCE_MS = 15 * 60 * 1000;
const PENDING_MS = 10 * 60 * 1000;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function key() {
  const text = process.env.PLATFORM_MFA_ENCRYPTION_KEY || '';
  const decoded = Buffer.from(text, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64') !== text) throw fail(503, 'MFA_UNAVAILABLE', 'Platform MFA encryption is unavailable');
  return decoded;
}
function encode(buffer) {
  let bits = 0, value = 0, output = '';
  for (const byte of buffer) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
function decode(secret) {
  let bits = 0, value = 0; const bytes = [];
  for (const char of secret) { value = (value << 5) | alphabet.indexOf(char); bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(bytes);
}
function encrypt(secret, userId) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv); cipher.setAAD(Buffer.from(userId));
  return [iv, cipher.update(secret, 'utf8'), cipher.final(), cipher.getAuthTag()].map((part) => part.toString('base64')).join('.');
}
function decrypt(payload, userId) {
  try {
    const [iv, data, final, tag] = payload.split('.').map((part) => Buffer.from(part, 'base64'));
    const cipher = crypto.createDecipheriv('aes-256-gcm', key(), iv); cipher.setAAD(Buffer.from(userId)); cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(Buffer.concat([data, final])), cipher.final()]).toString('utf8');
  } catch { throw fail(503, 'MFA_UNAVAILABLE', 'Platform MFA encryption is unavailable'); }
}
function matchingStep(secret, code, now) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30000);
  for (const step of [current, current - 1, current + 1]) {
    const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
    const digest = crypto.createHmac('sha1', decode(secret)).update(counter).digest(); const offset = digest[19] & 15;
    const expected = String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return step;
  }
  return null;
}
const hash = (code) => crypto.createHash('sha256').update(code).digest('hex');
async function status(req, transaction) {
  key();
  const credential = await Credential.findOne({ where: { user_id: req.identity.user_id }, transaction });
  const assurance = credential?.encrypted_secret ? await Assurance.findOne({ where: { session_id: req.authSession.session_id, user_id: req.identity.user_id, credential_version: credential.credential_version }, transaction }) : null;
  return { enrolled: Boolean(credential?.encrypted_secret), verified: Boolean(assurance && new Date(assurance.expires_at).getTime() > Date.now()), assurance_expires_at: assurance?.expires_at || null };
}
async function requireAssurance(req, transaction) {
  const current = await status(req, transaction);
  if (!current.enrolled) throw fail(403, 'MFA_SETUP_REQUIRED');
  if (!current.verified) throw fail(403, current.assurance_expires_at ? 'MFA_EXPIRED' : 'MFA_REQUIRED');
  return current;
}
async function lockCredential(req, transaction) {
  // Identity row also serializes first enrollment when no credential row exists yet.
  await User.unscoped().findByPk(req.identity.user_id, { transaction, lock: transaction.LOCK.UPDATE });
  await requireAccess(req, null, transaction);
  let credential = await Credential.findOne({ where: { user_id: req.identity.user_id }, transaction, lock: transaction.LOCK.UPDATE });
  if (!credential) credential = await Credential.create({ user_id: req.identity.user_id }, { transaction });
  return credential;
}
function enforceThrottle(credential, now) {
  if (credential.locked_until && new Date(credential.locked_until).getTime() > now) throw fail(429, 'MFA_THROTTLED', 'Too many verification attempts; try again later');
}
async function enroll(req) {
  key();
  return sequelize.transaction(async (transaction) => {
    const credential = await lockCredential(req, transaction); const now = Date.now(); enforceThrottle(credential, now);
    let replacementReason = null;
    if (credential.encrypted_secret) {
      if (req.body.replace !== true) throw fail(409, 'MFA_ALREADY_ENROLLED');
      replacementReason = reason(req.body.reason); await requireAssurance(req, transaction);
    } else {
      const primary = new Date(req.authSession.authenticated_at).getTime();
      if (!Number.isFinite(primary) || primary < now - PENDING_MS || primary > now + 30000) throw fail(403, 'RECENT_AUTHENTICATION_REQUIRED');
    }
    const secret = encode(crypto.randomBytes(20)); const expires = new Date(now + PENDING_MS);
    await credential.update({ pending_encrypted_secret: encrypt(secret, req.identity.user_id), pending_expires_at: expires, pending_session_id: req.authSession.session_id, pending_reason: replacementReason }, { transaction });
    await audit(req.identity, 'platform.mfa.enrollment_started', 'GlobalUser', req.identity.user_id, { replacement: Boolean(credential.encrypted_secret), ...(replacementReason ? { reason: replacementReason } : {}) }, transaction);
    return { secret, otpauth_url: `otpauth://totp/${encodeURIComponent(`Stechad:${req.identity.email}`)}?secret=${secret}&issuer=Stechad&algorithm=SHA1&digits=6&period=30`, expires_at: expires };
  });
}
async function establish(req, credential, now, transaction) {
  const expires = new Date(Math.min(now + ASSURANCE_MS, new Date(req.authSession.expires_at).getTime()));
  await Assurance.upsert({ session_id: req.authSession.session_id, user_id: req.identity.user_id, credential_version: credential.credential_version, verified_at: new Date(now), expires_at: expires }, { transaction });
  await credential.update({ failed_attempts: 0, locked_until: null }, { transaction });
  return expires;
}
async function verification(req, confirming) {
  key();
  const result = await sequelize.transaction(async (transaction) => {
    const credential = await lockCredential(req, transaction); const now = Date.now(); enforceThrottle(credential, now);
    if (confirming && (!credential.pending_encrypted_secret || credential.pending_session_id !== req.authSession.session_id || new Date(credential.pending_expires_at).getTime() <= now)) throw fail(400, 'MFA_ENROLLMENT_EXPIRED');
    if (!confirming && !credential.encrypted_secret) throw fail(403, 'MFA_SETUP_REQUIRED');
    const hasCode = typeof req.body.code === 'string'; const hasRecovery = typeof req.body.recovery_code === 'string';
    let acceptedStep = null, acceptedRecovery = null;
    if (hasCode && !hasRecovery) {
      acceptedStep = matchingStep(decrypt(confirming ? credential.pending_encrypted_secret : credential.encrypted_secret, req.identity.user_id), req.body.code, now);
      if (!confirming && acceptedStep !== null && credential.last_timestep !== null && acceptedStep <= Number(credential.last_timestep)) acceptedStep = null;
    } else if (!confirming && hasRecovery && !hasCode && req.body.recovery_code.length <= 100) {
      acceptedRecovery = await Recovery.findOne({ where: { user_id: req.identity.user_id, credential_version: credential.credential_version, code_hash: hash(req.body.recovery_code), consumed_at: null }, transaction, lock: transaction.LOCK.UPDATE });
    }
    if (acceptedStep === null && !acceptedRecovery) {
      const failures = credential.locked_until ? 1 : credential.failed_attempts + 1;
      await credential.update({ failed_attempts: failures, locked_until: failures >= 5 ? new Date(now + ASSURANCE_MS) : null }, { transaction });
      await audit(req.identity, 'platform.mfa.verification_failed', 'GlobalUser', req.identity.user_id, {}, transaction, 'denied');
      return { error: fail(failures >= 5 ? 429 : 400, failures >= 5 ? 'MFA_THROTTLED' : 'MFA_INVALID_CODE') };
    }
    let recoveryCodes;
    if (confirming) {
      const replacement = Boolean(credential.encrypted_secret);
      const replacementReason = credential.pending_reason;
      // Replacement requires assurance at confirmation as well as provisioning.
      if (replacement) await requireAssurance(req, transaction);
      await credential.update({ encrypted_secret: credential.pending_encrypted_secret, pending_encrypted_secret: null, pending_expires_at: null, pending_session_id: null, pending_reason: null, credential_version: credential.credential_version + 1, last_timestep: acceptedStep }, { transaction });
      await Assurance.destroy({ where: { user_id: req.identity.user_id }, transaction });
      await Recovery.destroy({ where: { user_id: req.identity.user_id }, transaction });
      recoveryCodes = Array.from({ length: 10 }, () => crypto.randomBytes(16).toString('hex'));
      await Recovery.bulkCreate(recoveryCodes.map((code) => ({ user_id: req.identity.user_id, credential_version: credential.credential_version, code_hash: hash(code) })), { transaction });
      await audit(req.identity, replacement ? 'platform.mfa.replaced' : 'platform.mfa.enrolled', 'GlobalUser', req.identity.user_id, { ...(replacementReason ? { reason: replacementReason } : {}) }, transaction);
    } else {
      if (acceptedRecovery) await acceptedRecovery.update({ consumed_at: new Date(now) }, { transaction });
      else await credential.update({ last_timestep: acceptedStep }, { transaction });
      await audit(req.identity, 'platform.mfa.verified', 'GlobalUser', req.identity.user_id, { method: acceptedRecovery ? 'recovery_code' : 'totp' }, transaction);
    }
    const expires = await establish(req, credential, now, transaction);
    return { ...(recoveryCodes ? { recovery_codes: recoveryCodes } : {}), assurance_expires_at: expires };
  });
  if (result.error) throw result.error;
  return result;
}
module.exports = { status, requireAssurance, enroll, confirm: (req) => verification(req, true), verify: (req) => verification(req, false) };
