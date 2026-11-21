const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = process.env.MEMBERSHIP_TEST_DATABASE_URL;
if (!url) test('organization membership HTTP/PostgreSQL (set MEMBERSHIP_TEST_DATABASE_URL)', { skip: true }, () => {});
else {
  const { Sequelize } = require('sequelize');
  const schema = `membership_http_${randomUUID().replaceAll('-', '')}`;
  const db = new Sequelize(url, { schema, logging: false }); db.schema = schema;
  db.afterDefine((model) => { model.options.schema = schema; });
  const path = require.resolve('../config/database'); require.cache[path] = { id: path, filename: path, loaded: true, exports: db };
  const models = require('../models');
  const messages = [];
  const emailModule = require.resolve('../utils/sendEmail'); require.cache[emailModule] = { id: emailModule, filename: emailModule, loaded: true, exports: async (message) => messages.push(message) };
  let server, origin, owner, member, outsider, orgA, orgB, roleA, roleB, ownerA, memberA;
  const password = 'Existing-pass123!';
  const bearer = (user) => require('jsonwebtoken').sign({ user_id: user.user_id, session_version: user.session_version }, process.env.JWT_SECRET);
  const request = async (path, user = owner, body, method = body ? 'POST' : 'GET', org) => {
    const response = await fetch(origin + path, { method, headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer ${bearer(user)}` } : {}), ...(org ? { 'x-organization-id': org.organization_id } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  before(async () => {
    process.env.TENANCY_ENFORCED = 'true';
    process.env.GOOGLE_CLIENT_ID = 'test-client'; process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    await db.createSchema(schema); await db.sync();
    orgA = await models.Organization.create({ slug: 'a', name: 'A' }); orgB = await models.Organization.create({ slug: 'b', name: 'B' });
    roleA = await models.Role.create({ organization_id: orgA.organization_id, role_key: 'staff', name: 'Staff A', is_system: true });
    roleB = await models.Role.create({ organization_id: orgB.organization_id, role_key: 'staff', name: 'Staff B', is_system: true });
    owner = await models.User.create({ email: 'owner@example.test', password, role_id: roleA.role_id, is_verified: true });
    member = await models.User.create({ email: 'member@example.test', password, role_id: roleA.role_id, is_verified: true });
    outsider = await models.User.create({ email: 'outsider@example.test', password, role_id: roleA.role_id, is_verified: true });
    for (const [user, org, role, membershipRole] of [[owner, orgA, roleA, 'owner'], [owner, orgB, roleB, 'owner'], [member, orgA, roleA, 'member']]) {
      const membership = await models.OrganizationMembership.create({ user_id: user.user_id, organization_id: org.organization_id, membership_role: membershipRole });
      await models.HRProfile.create({ user_id: user.user_id, organization_id: org.organization_id, membership_id: membership.membership_id, role_id: role.role_id });
      if (user === owner && org === orgA) ownerA = membership;
      if (user === member) memberA = membership;
    }
    const express = require('express'); const app = express(); app.use(express.json());
    app.use('/api/auth', require('../routes/authRoutes'));
    app.use('/api/organizations', require('../routes/organizationRoutes'));
    const { authenticate, authorize } = require('../middleware/auth');
    app.get('/api/hr/admin', authenticate, authorize('admin'), (req, res) => res.json({ success: true }));
    app.get('/api/hr/identity', authenticate, (req, res) => res.json({ role: req.user.role.role_key, organization_id: req.tenant.organizationId }));
    app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message, code: error.code }));
    server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); await db.dropSchema(schema, { cascade: true }); await db.close(); });
  test('global session lists organizations while HR requires explicit selection and owner carries no HR wildcard', async () => {
    const me = await request('/api/auth/me'); assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.equal(me.body.data.active_organization_id, null); assert.equal(me.body.data.organizations.length, 2);
    const organizations = await request('/api/organizations'); assert.equal(organizations.status, 200); assert.equal(organizations.body.data.organizations.length, 2);
    const ambiguous = await request('/api/hr/identity'); assert.equal(ambiguous.status, 409); assert.equal(ambiguous.body.code, 'ORGANIZATION_REQUIRED');
    assert.equal((await request('/api/hr/admin', owner, undefined, 'GET', orgA)).status, 403);
    const selected = await request('/api/auth/me', owner, undefined, 'GET', orgB); assert.equal(selected.body.data.active_organization_id, orgB.organization_id); assert.equal(selected.body.data.user.role, 'staff');
  });
  test('organization lifecycle protects the last owner, confines revocation, and keeps global session valid', async () => {
    assert.equal((await request(`/api/organizations/${orgA.organization_id}/leave`, owner, {})).status, 409);
    const updated = await request(`/api/organizations/${orgA.organization_id}`, owner, { name: 'A changed', settings: { timezone: 'Africa/Lagos' } }, 'PATCH');
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.data.organization.name, 'A changed');
    assert.equal((await request(`/api/organizations/${orgA.organization_id}`, member, { name: 'Forbidden' }, 'PATCH')).status, 403);
    const suspended = await request(`/api/organizations/${orgA.organization_id}/members/${memberA.membership_id}`, owner, { status: 'suspended' }, 'PATCH');
    assert.equal(suspended.status, 200, JSON.stringify(suspended.body));
    assert.equal((await request('/api/hr/identity', member, undefined, 'GET', orgA)).body.code, 'MEMBERSHIP_UNAVAILABLE');
    assert.equal((await request('/api/auth/me', member)).status, 200);
    assert.equal((await request('/api/hr/identity', owner, undefined, 'GET', orgB)).status, 200);
    assert.equal((await request(`/api/organizations/${orgA.organization_id}/members/${memberA.membership_id}`, owner, { status: 'active' }, 'PATCH')).status, 200);
    const members = await request(`/api/organizations/${orgA.organization_id}/members`); assert.equal(members.status, 200); assert.equal(members.body.data.members.length, 2);
    await models.HRProfile.destroy({ where: { user_id: outsider.user_id } });
    await models.OrganizationMembership.create({ user_id: outsider.user_id, organization_id: orgB.organization_id, membership_role: 'admin' });
    assert.equal((await request(`/api/organizations/${orgB.organization_id}`, outsider, { name: 'No HR admin' }, 'PATCH')).status, 200);
    assert.equal((await request('/api/hr/identity', outsider, undefined, 'GET', orgB)).status, 403);
  });

  test('existing verified invitee joins a second organization once without password replacement', async () => {
    const invited = await request(`/api/organizations/${orgB.organization_id}/invitations`, owner, { email: ' MEMBER@EXAMPLE.TEST ', role_id: roleB.role_id });
    assert.equal(invited.status, 201, JSON.stringify(invited.body));
    assert.equal(invited.body.data.invitation.token, undefined); assert.equal(invited.body.data.invitation.token_hash, undefined);
    const token = new URL(messages.at(-1).replacements.url).searchParams.get('token');
    assert.equal((await request(`/api/auth/accept-invite/${token}`, outsider, {})).status, 403);
    assert.equal((await request(`/api/auth/accept-invite/${token}`, null, { new_password: 'Replace-pass123!', confirm_password: 'Replace-pass123!' })).status, 401);
    const accepted = await Promise.all([request(`/api/auth/accept-invite/${token}`, member, {}), request(`/api/auth/accept-invite/${token}`, member, {})]);
    assert.deepEqual(accepted.map((r) => r.status).sort(), [201, 400]);
    const login = await request('/api/auth/login', null, { email: member.email, password }); assert.equal(login.status, 200, JSON.stringify(login.body));
    const me = await request('/api/auth/me', member, undefined, 'GET', orgB); assert.equal(me.body.data.organizations.length, 2); assert.equal(me.body.data.user.role_id, roleB.role_id);
  });

  test('new invitees use emailed single-use tokens, expiry is enforced and stored digests are not credentials', async () => {
    const create = async (email) => {
      const result = await request(`/api/organizations/${orgA.organization_id}/invitations`, owner, { email, role_id: roleA.role_id });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      return { invitation: result.body.data.invitation, token: new URL(messages.at(-1).replacements.url).searchParams.get('token') };
    };
    const fresh = await create('new@example.test');
    const credentials = { new_password: 'New-valid123!', confirm_password: 'New-valid123!' };
    const accepted = await request(`/api/auth/accept-invite/${fresh.token}`, null, credentials); assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
    assert.equal((await request(`/api/auth/accept-invite/${fresh.token}`, null, credentials)).status, 400);
    const login = await request('/api/auth/login', null, { email: 'new@example.test', password: credentials.new_password });
    assert.equal(login.status, 200); assert.equal(login.body.data.user.organization_id, orgA.organization_id); assert.equal(login.body.data.user.is_verified, true);
    const expired = await create('expired@example.test');
    await models.Invite.unscoped().update({ expires_at: new Date(0) }, { where: { invite_id: expired.invitation.invite_id } });
    assert.equal((await request(`/api/auth/accept-invite/${expired.token}`, null, credentials)).status, 400);
    const digestOnly = await create('digest@example.test');
    const digest = require('node:crypto').createHash('sha256').update(digestOnly.token).digest('hex');
    assert.equal((await request(`/api/auth/accept-invite/${digest}`, null, credentials)).status, 400);
    await member.update({ is_verified: false });
    const invitation = await request(`/api/organizations/${orgB.organization_id}/invitations`, owner, { email: 'unverified@example.test', role_id: roleB.role_id });
    assert.equal(invitation.status, 201);
    const unverified = await models.User.create({ email: 'unverified@example.test', role_id: roleA.role_id, is_verified: false });
    const token = new URL(messages.at(-1).replacements.url).searchParams.get('token');
    assert.equal((await request(`/api/auth/accept-invite/${token}`, unverified, {})).status, 403);
  });
  test('organization creation stays gated and provisions a separate basic HR role when enabled', async () => {
    delete process.env.ENABLE_ORGANIZATION_CREATION;
    assert.equal((await request('/api/organizations', member, { name: 'New Company', slug: 'new-company' })).body.code, 'ORGANIZATION_CREATION_DISABLED');
    process.env.ENABLE_ORGANIZATION_CREATION = 'true';
    const created = await request('/api/organizations', member, { name: 'New Company', slug: 'new-company' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const org = created.body.data.organization;
    const me = await request('/api/auth/me', member, undefined, 'GET', org);
    assert.equal(me.body.data.user.role, 'staff'); assert.equal(created.body.data.membership.membership_role, 'owner');
    assert.equal(me.body.data.user.effective_permissions.includes('*'), false);
    delete process.env.ENABLE_ORGANIZATION_CREATION;
  });

  test('concurrent owner departures leave an active owner', async () => {
    const organization = await models.Organization.create({ name: 'Concurrent owners', slug: 'concurrent-owners' });
    for (const user of [owner, member]) await models.OrganizationMembership.create({ organization_id: organization.organization_id, user_id: user.user_id, membership_role: 'owner' });
    const results = await Promise.all([request(`/api/organizations/${organization.organization_id}/leave`, owner, {}), request(`/api/organizations/${organization.organization_id}/leave`, member, {})]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const survivor = results[0].status === 409 ? owner : member;
    const members = await request(`/api/organizations/${organization.organization_id}/members`, survivor);
    assert.equal(members.body.data.members.filter((row) => row.membership_role === 'owner' && row.status === 'active').length, 1);
  });
  test('public talent signup joins stechad with its scoped HR profile and a global identity', async () => {
    const organizationId = require('../services/tenancyInventory').STECHAD_ORGANIZATION_ID;
    await models.Organization.create({ organization_id: organizationId, name: 'Stechad', slug: 'stechad' });
    await models.Role.create({ organization_id: organizationId, role_key: 'talent', name: 'Talent', is_system: true });
    await db.query(`CREATE TABLE "${schema}".tenancy_migration_state (id integer)`);
    const registered = await request('/api/auth/signup', null, { email: 'signup@example.test', password: 'Signup-pass123!', confirm_password: 'Signup-pass123!', first_name: 'Signup', role: 'talent' });
    assert.equal(registered.status, 201, JSON.stringify(registered.body));
    assert.equal(registered.body.data.active_organization_id, organizationId);
    assert.equal(registered.body.data.user.role, 'talent');
    assert.equal(registered.body.data.user.talent.organization_id, organizationId);
    assert.equal(registered.body.data.organizations.length, 1);
    const login = await request('/api/auth/login', null, { email: 'signup@example.test', password: 'Signup-pass123!' });
    assert.equal(login.status, 200); assert.equal(login.body.data.user.is_verified, false, 'password knowledge does not verify email ownership');
    const organizationList = await fetch(origin + '/api/organizations', { headers: { authorization: `Bearer ${registered.body.data.token}` } });
    assert.equal((await organizationList.json()).data.organizations[0].organization_id, organizationId);
  });

}
