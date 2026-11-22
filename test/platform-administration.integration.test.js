const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const url = process.env.PLATFORM_TEST_DATABASE_URL;
if (!url) test('platform administration (set PLATFORM_TEST_DATABASE_URL)', { skip: true }, () => {});
else {
  const { Sequelize } = require('sequelize');
  const schema = `platform_${randomUUID().replaceAll('-', '')}`;
  const db = new Sequelize(url, { schema, logging: false }); db.schema = schema;
  db.afterDefine((model) => { model.options.schema = schema; });
  const databasePath = require.resolve('../config/database');
  require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: db };
  process.env.JWT_SECRET = randomUUID(); process.env.JWT_REFRESH_SECRET = randomUUID();
  process.env.PLATFORM_MFA_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString('base64');
  const models = require('../models');
  let server, origin, user, token, recoveryCodes, enrolledSecret;
  const authenticator = require('./support/platformAuthenticator');
  before(async () => {
    await db.createSchema(schema); await db.sync();
    await require('../migrations/20261122100000-managed-auth-sessions').up(db.getQueryInterface(), Sequelize);
    await require('../migrations/20261122110000-explicit-platform-authority').up(db.getQueryInterface(), Sequelize);
    const role = await models.Role.create({ role_key: 'super_admin', name: 'HR super admin' });
    user = await models.User.create({ email: 'hr-admin@example.test', role_id: role.role_id, is_verified: true });
    token = (await require('../services/authSessions').createSession(user)).token;
    const app = require('express')(); app.use(require('express').json());
    app.use('/api/platform', require('../routes/platformRoutes'));
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.dropSchema(schema, { cascade: true }); await db.close();
  });
  const request = async (path, method = 'GET', body, access = token) => {
    const response = await fetch(origin + '/api/platform' + path, { method, headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, ...await response.json() };
  };
  const cli = async (...extra) => {
    const { stdout } = await require('node:util').promisify(require('node:child_process').execFile)(process.execPath, ['scripts/bootstrap-platform-super-admin.js', '--database-url', url, '--schema', schema, '--email', user.email, '--reason', 'Disposable fixture bootstrap', ...extra], { cwd: require('node:path').resolve(__dirname, '..'), env: { ...process.env } });
    return JSON.parse(stdout);
  };
  test('an HR super admin has no implicit platform authority', async () => {
    const response = await fetch(origin + '/api/platform/me', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'PLATFORM_ACCESS_DENIED');
  });
  test('bootstrap defaults to dry-run and applies an audited grant only for the selected verified identity', async () => {
    const preview = await cli(); assert.equal(preview.applied, false);
    assert.equal((await request('/me')).code, 'PLATFORM_ACCESS_DENIED');
    const applied = await cli('--apply'); assert.equal(applied.applied, true);
    const me = await request('/me'); assert.equal(me.status, 200, JSON.stringify(me));
    assert.equal(me.data.roles[0].role_key, 'platform_super_admin');
    assert.equal(me.data.requires_mfa_enrollment, true);
    assert.equal((await request('/organizations')).code, 'MFA_SETUP_REQUIRED');
  });

  test('MFA confirmation expires pending setup, encrypts the active factor and gates metadata by session assurance', async () => {
    const setup = await request('/mfa/enroll', 'POST', {}); assert.equal(setup.status, 200);
    assert.match(setup.data.otpauth_url, /^otpauth:\/\/totp\//);
    await models.PlatformMfaCredential.update({ pending_expires_at: new Date(Date.now() - 1000) }, { where: { user_id: user.user_id } });
    assert.equal((await request('/mfa/confirm', 'POST', { code: authenticator(setup.data.secret) })).code, 'MFA_ENROLLMENT_EXPIRED');
    const fresh = await request('/mfa/enroll', 'POST', {}); enrolledSecret = fresh.data.secret;
    const confirmed = await request('/mfa/confirm', 'POST', { code: authenticator(enrolledSecret) });
    assert.equal(confirmed.status, 200, confirmed.code); recoveryCodes = confirmed.data.recovery_codes;
    assert.equal(recoveryCodes.length, 10); assert.equal(new Set(recoveryCodes).size, 10);
    assert.ok(Date.parse(confirmed.data.assurance_expires_at) <= Date.now() + 15 * 60000);
    const persisted = await models.PlatformMfaCredential.findOne({ where: { user_id: user.user_id } });
    assert.equal(persisted.pending_encrypted_secret, null);
    assert.ok(!persisted.encrypted_secret.includes(enrolledSecret));
    const recovery = await models.PlatformRecoveryCode.findAll({ where: { user_id: user.user_id } });
    assert.ok(recovery.every((entry) => !recoveryCodes.includes(entry.code_hash)));
    assert.equal((await request('/users')).status, 200);
    assert.equal((await request('/mfa/verify', 'POST', { code: authenticator(enrolledSecret) })).code, 'MFA_INVALID_CODE', 'confirmation timestep cannot be replayed');
    const second = await require('../services/authSessions').createSession(user);
    assert.equal((await request('/users', 'GET', null, second.token)).code, 'MFA_REQUIRED');
    const verified = await request('/mfa/verify', 'POST', { recovery_code: recoveryCodes[0] }, second.token); assert.equal(verified.status, 200);
    assert.equal((await request('/mfa/verify', 'POST', { recovery_code: recoveryCodes[0] }, second.token)).code, 'MFA_INVALID_CODE');
    assert.equal((await request('/users', 'GET', null, second.token)).status, 200);
    const beforeRefresh = (await request('/me')).data.mfa.assurance_expires_at;
    const rotated = await require('../services/authSessions').rotateRefreshToken(second.refreshToken);
    assert.equal((await request('/me', 'GET', null, rotated.token)).data.mfa.assurance_expires_at, verified.data.assurance_expires_at);
    await models.PlatformSessionAssurance.update({ expires_at: new Date(Date.now() - 1000) }, { where: { session_id: second.session.session_id } });
    assert.equal((await request('/users', 'GET', null, rotated.token)).code, 'MFA_EXPIRED');
    assert.equal((await request('/me')).data.mfa.assurance_expires_at, beforeRefresh);
    const audit = await request('/audit-log'); assert.equal(audit.status, 200);
    assert.ok(audit.data.entries.some((entry) => entry.action === 'platform.bootstrap.super_admin_granted'));
    assert.ok(!JSON.stringify(audit).includes(enrolledSecret));
    assert.ok(recoveryCodes.every((code) => !JSON.stringify(audit).includes(code)));
  });
  test('missing encryption configuration fails closed and per-identity throttling spans managed sessions', async () => {
    const configured = process.env.PLATFORM_MFA_ENCRYPTION_KEY; delete process.env.PLATFORM_MFA_ENCRYPTION_KEY;
    try { assert.equal((await request('/users')).code, 'MFA_UNAVAILABLE'); assert.equal((await request('/me')).status, 503); }
    finally { process.env.PLATFORM_MFA_ENCRYPTION_KEY = configured; }
    const other = await require('../services/authSessions').createSession(user);
    for (let i = 0; i < 5; i++) await request('/mfa/verify', 'POST', { code: 'invalid' }, i % 2 ? token : other.token);
    assert.equal((await request('/mfa/verify', 'POST', { recovery_code: recoveryCodes[1] })).code, 'MFA_THROTTLED');
    await models.PlatformMfaCredential.update({ locked_until: new Date(Date.now() - 1000) }, { where: { user_id: user.user_id } });
    assert.equal((await request('/mfa/verify', 'POST', { recovery_code: recoveryCodes[1] })).status, 200);
  });

  test('a newly exchanged legacy refresh cannot stand in for recent primary authentication', async () => {
    const role = await models.Role.findOne({ where: { role_key: 'super_admin' } });
    const target = await models.User.create({ email: 'legacy-platform@example.test', role_id: role.role_id, is_verified: true });
    const platformRole = await models.PlatformRole.findOne({ where: { role_key: 'platform_viewer' } });
    await models.PlatformRoleGrant.create({ user_id: target.user_id, role_id: platformRole.role_id });
    const session = await require('../services/authSessions').createSession(target, { authMethod: 'legacy_exchange' });
    assert.equal((await request('/mfa/enroll', 'POST', {}, session.token)).code, 'RECENT_AUTHENTICATION_REQUIRED');
  });

}
