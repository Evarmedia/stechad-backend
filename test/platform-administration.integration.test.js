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
  let server, io, origin, user, token, recoveryCodes, enrolledSecret;
  const sockets = new Set();
  const authenticator = require('./support/platformAuthenticator');
  before(async () => {
    await db.createSchema(schema); await db.sync();
    await require('../migrations/20261122100000-managed-auth-sessions').up(db.getQueryInterface(), Sequelize);
    await require('../migrations/20261122110000-explicit-platform-authority').up(db.getQueryInterface(), Sequelize);
    await require('../migrations/20261122110000-explicit-platform-authority').up(db.getQueryInterface(), Sequelize);
    const role = await models.Role.create({ role_key: 'super_admin', name: 'HR super admin' });
    user = await models.User.create({ email: 'hr-admin@example.test', role_id: role.role_id, is_verified: true });
    token = (await require('../services/authSessions').createSession(user)).token;
    const app = require('express')(); app.use(require('express').json());
    app.use('/api/platform', require('../routes/platformRoutes'));
    app.use('/api/organizations', require('../routes/organizationRoutes'));
    app.use('/api/chat', require('../routes/chatRoutes'));
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    io = new (require('socket.io').Server)(server); require('../utils/events').setRealtime(io);
    require('../utils/chatSocket').initializeChatSocket(io);
    process.env.TENANCY_ENFORCED = 'true';
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    for (const socket of sockets) socket.disconnect();
    require('../utils/events').setRealtime(null);
    if (io) await new Promise((resolve) => io.close(resolve));
    else if (server) await new Promise((resolve) => server.close(resolve));
    delete process.env.TENANCY_ENFORCED;
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
    const jwt = require('jsonwebtoken'); const payload = jwt.decode(token); payload.platform_roles = ['platform_super_admin'];
    const forged = jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS256' });
    assert.equal((await request('/me', 'GET', null, forged)).code, 'PLATFORM_ACCESS_DENIED');
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

  test('metadata APIs sanitize fields, enforce catalog permissions, and revoke live grants without conferring HR access', async () => {
    const catalog = await request('/roles'); assert.equal(catalog.status, 200);
    const roleByKey = Object.fromEntries(catalog.data.roles.map((role) => [role.role_key, role.role_id]));
    const hrRole = await models.Role.findOne({ where: { role_key: 'super_admin' } });
    const viewer = await models.User.create({ email: 'viewer@example.test', role_id: hrRole.role_id, is_verified: true, job_title: 'SECRET_HR_JOB', phone_number: 'PRIVATE_PHONE' });
    const viewerSession = await require('../services/authSessions').createSession(viewer);
    assert.equal((await request('/grants', 'POST', { user_id: viewer.user_id, role_id: roleByKey.platform_viewer })).code, 'AUDIT_REASON_REQUIRED');
    const grant = await request('/grants', 'POST', { user_id: viewer.user_id, role_id: roleByKey.platform_viewer, reason: 'Read-only fixture operator' }); assert.equal(grant.status, 201);
    const setup = await request('/mfa/enroll', 'POST', {}, viewerSession.token);
    assert.equal((await request('/mfa/confirm', 'POST', { code: authenticator(setup.data.secret) }, viewerSession.token)).status, 200);
    const list = await request('/users?limit=1&page=2', 'GET', null, viewerSession.token); assert.equal(list.status, 200); assert.equal(list.data.pagination.limit, 1); assert.equal(list.data.pagination.page, 2);
    const all = await request('/users', 'GET', null, viewerSession.token);
    assert.deepEqual(Object.keys(all.data.users.find((entry) => entry.user_id === viewer.user_id)).sort(), ['user_id', 'email', 'first_name', 'last_name', 'is_active', 'is_verified', 'created_at'].sort());
    assert.ok(!JSON.stringify(all).includes('SECRET_HR_JOB')); assert.ok(!JSON.stringify(all).includes('PRIVATE_PHONE'));
    assert.equal((await request('/roles', 'GET', null, viewerSession.token)).code, 'PLATFORM_ACCESS_DENIED');
    assert.equal((await request('/grants', 'GET', null, viewerSession.token)).status, 403);
    assert.equal((await request('/users/' + user.user_id, 'PATCH', { is_active: false, reason: 'Denied fixture mutation' }, viewerSession.token)).status, 403);
    const hr = await fetch(origin + '/api/chat', { headers: { authorization: `Bearer ${token}`, 'x-organization-id': randomUUID() } }); assert.equal(hr.status, 403);
    assert.equal((await request('/users?limit=1000')).status, 400);
    assert.equal((await request('/grants/' + grant.data.grant.grant_id, 'DELETE', { reason: 'Revoke fixture access' })).status, 200);
    assert.equal((await request('/me', 'GET', null, viewerSession.token)).code, 'PLATFORM_ACCESS_DENIED');
    const own = (await request('/grants?user_id=' + user.user_id)).data.grants[0];
    assert.equal((await request('/grants/' + own.grant_id, 'DELETE', { reason: 'Self lockout attempt' })).code, 'SELF_LOCKOUT_PROTECTED');
    assert.equal((await request('/users/' + user.user_id, 'PATCH', { is_active: false, reason: 'Self suspension attempt' })).code, 'SELF_LOCKOUT_PROTECTED');
  });
  test('organization suspension disconnects only its sockets and global suspension revokes every identity session', { timeout: 15000 }, async () => {
    const first = await models.Organization.create({ slug: 'platform-org-a', name: 'Platform A', settings: { external_secret: 'PRIVATE_ORG_SETTING' } });
    const second = await models.Organization.create({ slug: 'platform-org-b', name: 'Platform B' });
    const roles = [];
    for (const organization of [first, second]) roles.push(await models.Role.create({ organization_id: organization.organization_id, role_key: 'staff', name: 'Staff' }));
    const member = await models.User.create({ email: 'shared-member@example.test', role_id: roles[0].role_id, is_verified: true });
    for (const [index, organization] of [first, second].entries()) {
      const membership = await models.OrganizationMembership.create({ organization_id: organization.organization_id, user_id: member.user_id, membership_role: 'owner' });
      await models.HRProfile.create({ organization_id: organization.organization_id, membership_id: membership.membership_id, user_id: member.user_id, role_id: roles[index].role_id, job_title: 'PRIVATE_HR_PROFILE' });
    }
    const memberSession = await require('../services/authSessions').createSession(member);
    const otherDevice = await require('../services/authSessions').createSession(member);
    const socketFor = async (organization) => {
      const socket = require('socket.io-client').io(origin, { auth: { token: memberSession.token, organization_id: organization.organization_id }, transports: ['websocket'], forceNew: true, reconnection: false }); sockets.add(socket); await once(socket, 'connect'); return socket;
    };
    const a = await socketFor(first); const b = await socketFor(second);
    const organizations = await request('/organizations'); assert.equal(organizations.status, 200);
    assert.ok(!JSON.stringify(organizations).includes('PRIVATE_ORG_SETTING')); assert.ok(!JSON.stringify(organizations).includes('PRIVATE_HR_PROFILE'));
    const dto = organizations.data.organizations.find((entry) => entry.organization_id === first.organization_id); assert.equal(dto.active_member_count, 1); assert.equal(dto.owner_count, 1);
    assert.equal((await request('/organizations/' + first.organization_id, 'PATCH', { status: 'suspended' })).code, 'AUDIT_REASON_REQUIRED');
    const disconnectedA = once(a, 'disconnect');
    assert.equal((await request('/organizations/' + first.organization_id, 'PATCH', { status: 'suspended', reason: 'Suspend A fixture' })).status, 200); await disconnectedA;
    assert.equal(b.connected, true);
    const organizationGet = (organization) => fetch(origin + '/api/organizations/' + organization.organization_id, { headers: { authorization: `Bearer ${memberSession.token}` } });
    assert.equal((await organizationGet(first)).status, 403); assert.equal((await organizationGet(second)).status, 200);
    const disconnectedB = once(b, 'disconnect');
    assert.equal((await request('/users/' + member.user_id, 'PATCH', { is_active: false, reason: 'Suspend global fixture identity' })).status, 200); await disconnectedB;
    for (const device of [memberSession, otherDevice]) assert.equal((await request('/me', 'GET', null, device.token)).status, 401);
    assert.equal((await request('/me')).status, 200);
    assert.equal((await request('/users/' + member.user_id, 'PATCH', { is_active: true, reason: 'Reactivate global fixture identity' })).status, 200);
    assert.equal((await request('/organizations/' + first.organization_id, 'PATCH', { status: 'active', reason: 'Reactivate A fixture' })).status, 200);
  });

  test('operators cannot mutate privileged identities and simultaneous TOTP use succeeds only once', async () => {
    const hrRole = await models.Role.findOne({ where: { role_key: 'super_admin' } });
    const target = await models.User.create({ email: 'operator@example.test', role_id: hrRole.role_id, is_verified: true });
    const role = (await request('/roles')).data.roles.find((entry) => entry.role_key === 'platform_operator');
    assert.equal((await request('/grants', 'POST', { user_id: target.user_id, role_id: role.role_id, reason: 'Operator fixture' })).status, 201);
    const session = await require('../services/authSessions').createSession(target);
    const setup = await request('/mfa/enroll', 'POST', {}, session.token);
    assert.equal((await request('/mfa/confirm', 'POST', { code: authenticator(setup.data.secret) }, session.token)).status, 200);
    const code = authenticator(setup.data.secret, Date.now() + 30000);
    const concurrent = await Promise.all([1, 2].map(() => request('/mfa/verify', 'POST', { code }, session.token)));
    assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 400]);
    assert.equal((await request('/users/' + user.user_id, 'PATCH', { is_active: false, reason: 'Forbidden privileged-target mutation' }, session.token)).code, 'PRIVILEGED_TARGET_PROTECTED');
    assert.equal((await request('/grants', 'POST', { user_id: target.user_id, role_id: role.role_id, reason: 'Forbidden grant mutation' }, session.token)).code, 'PLATFORM_ACCESS_DENIED');
    assert.equal((await request('/audit-log', 'GET', null, session.token)).status, 200);
    const withoutFactor = await models.User.create({ email: 'stale-primary@example.test', role_id: hrRole.role_id, is_verified: true });
    assert.equal((await request('/grants', 'POST', { user_id: withoutFactor.user_id, role_id: role.role_id, reason: 'Stale primary auth fixture' })).status, 201);
    const old = await require('../services/authSessions').createSession(withoutFactor, { authenticatedAt: new Date(Date.now() - 11 * 60000) });
    assert.equal((await request('/mfa/enroll', 'POST', {}, old.token)).code, 'RECENT_AUTHENTICATION_REQUIRED');
    await withoutFactor.update({ is_verified: false });
    assert.equal((await request('/me', 'GET', null, old.token)).code, 'EMAIL_VERIFICATION_REQUIRED');
    const state = await models.AuthSecurityState.findByPk('sessions');
    const legacy = require('jsonwebtoken').sign({ user_id: user.user_id, session_version: user.session_version, iat: Math.floor(new Date(state.activated_at).getTime() / 1000) - 10, exp: Math.floor(Date.now() / 1000) + 600 }, process.env.JWT_SECRET);
    assert.equal((await request('/me', 'GET', null, legacy)).code, 'SESSION_UPGRADE_REQUIRED');
  });
  test('factor replacement requires a reason and fresh assurance while keeping the old factor until confirmation', async () => {
    assert.equal((await request('/mfa/enroll', 'POST', { replace: true })).code, 'AUDIT_REASON_REQUIRED');
    const replacement = await request('/mfa/enroll', 'POST', { replace: true, reason: 'Replace fixture authenticator' }); assert.equal(replacement.status, 200);
    assert.equal((await request('/mfa/verify', 'POST', { code: authenticator(enrolledSecret, Date.now() + 30000) })).status, 200, 'old factor remains usable during replacement');
    const before = await models.AuthSession.findOne({ where: { user_id: user.user_id, revoked_at: null }, order: [['created_at', 'ASC']] });
    await models.PlatformSessionAssurance.update({ expires_at: new Date(Date.now() - 1000) }, { where: { session_id: before.session_id } });
    assert.equal((await request('/mfa/confirm', 'POST', { code: authenticator(replacement.data.secret) })).code, 'MFA_EXPIRED');
    assert.equal((await request('/mfa/verify', 'POST', { recovery_code: recoveryCodes[2] })).status, 200);
    const confirmed = await request('/mfa/confirm', 'POST', { code: authenticator(replacement.data.secret) }); assert.equal(confirmed.status, 200);
    assert.equal((await request('/mfa/verify', 'POST', { recovery_code: recoveryCodes[3] })).code, 'MFA_INVALID_CODE');
    assert.equal((await request('/mfa/verify', 'POST', { code: authenticator(enrolledSecret) })).code, 'MFA_INVALID_CODE');
    recoveryCodes = confirmed.data.recovery_codes; enrolledSecret = replacement.data.secret;
    const audit = await request('/audit-log?action=platform.mfa.replaced'); assert.equal(audit.data.entries.length, 1); assert.equal(audit.data.entries[0].changes.reason, 'Replace fixture authenticator');
  });
  test('concurrent privileged-account suspension preserves one active platform super admin', async () => {
    const hrRole = await models.Role.findOne({ where: { role_key: 'super_admin' } });
    const target = await models.User.create({ email: 'second-super@example.test', role_id: hrRole.role_id, is_verified: true });
    const role = (await request('/roles')).data.roles.find((entry) => entry.role_key === 'platform_super_admin');
    assert.equal((await request('/grants', 'POST', { user_id: target.user_id, role_id: role.role_id, reason: 'Concurrent safety fixture' })).status, 201);
    const session = await require('../services/authSessions').createSession(target);
    const setup = await request('/mfa/enroll', 'POST', {}, session.token);
    assert.equal((await request('/mfa/confirm', 'POST', { code: authenticator(setup.data.secret) }, session.token)).status, 200);
    const changes = await Promise.all([
      request('/users/' + target.user_id, 'PATCH', { is_active: false, reason: 'Concurrent suspend second' }),
      request('/users/' + user.user_id, 'PATCH', { is_active: false, reason: 'Concurrent suspend first' }, session.token),
    ]);
    assert.equal(changes.filter((result) => result.status === 200).length, 1);
    assert.ok(changes.some((result) => [401, 403, 409].includes(result.status)));
    const survivingToken = changes[0].status === 200 ? token : session.token;
    const list = await request('/users', 'GET', null, survivingToken);
    assert.equal(list.data.users.filter((entry) => [user.user_id, target.user_id].includes(entry.user_id) && entry.is_active).length, 1);
  });

}
