const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');

const url = process.env.TENANCY_TEST_DATABASE_URL;
if (!url) test('tenant realtime delivery (set TENANCY_TEST_DATABASE_URL)', { skip: true }, () => {});
else {
  const { Sequelize } = require('sequelize');
  const schema = `tenant_delivery_${randomUUID().replaceAll('-', '')}`;
  const db = new Sequelize(url, { schema, logging: false }); db.schema = schema;
  db.afterDefine((model) => { model.options.schema = schema; });
  const databasePath = require.resolve('../config/database');
  require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: db };
  process.env.JWT_SECRET = randomUUID(); process.env.JWT_REFRESH_SECRET = randomUUID();
  const models = require('../models');
  const events = require('../utils/events');
  const { resolveTenantContext, runWithTenant } = require('../services/tenantContext');
  const { generateTokens } = require('../utils/generateTokens');
  const { io: connect } = require('socket.io-client');
  let server, io, origin, shared, orgA, orgB, aContext, bContext;
  const sockets = new Set();
  const wait = (milliseconds = 80) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  before(async () => {
    await db.createSchema(schema); await db.sync();
    orgA = await models.Organization.create({ slug: 'delivery-a', name: 'A' });
    orgB = await models.Organization.create({ slug: 'delivery-b', name: 'B' });
    const role = await models.Role.create({ organization_id: orgA.organization_id, role_key: 'staff', name: 'Staff', is_system: true });
    const secondRole = await models.Role.create({ organization_id: orgB.organization_id, role_key: 'staff_b', name: 'Staff B', is_system: true });
    shared = await models.User.create({ email: 'shared@example.test', first_name: 'Shared', role_id: role.role_id });
    for (const [organization, hrRole] of [[orgA, role], [orgB, secondRole]]) {
      const member = await models.OrganizationMembership.create({ organization_id: organization.organization_id, user_id: shared.user_id });
      await models.HRProfile.create({ organization_id: organization.organization_id, membership_id: member.membership_id, user_id: shared.user_id, role_id: hrRole.role_id });
    }
    aContext = await resolveTenantContext({ userId: shared.user_id, organizationId: orgA.organization_id });
    bContext = await resolveTenantContext({ userId: shared.user_id, organizationId: orgB.organization_id });
    const express = require('express'); const app = express(); app.use(express.json());
    app.use(require('../middleware/auth').authenticate);
    app.use(require('../middleware/organization').requireOrganization);
    app.post('/publish', async (req, res, next) => {
      try { await events.emitUser(shared.user_id, 'notification_created', { marker: req.body.marker }); res.json({ success: true }); }
      catch (error) { next(error); }
    });
    app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
    const http = require('node:http'); const { Server } = require('socket.io');
    server = http.createServer(app); io = new Server(server); events.setRealtime(io);
    process.env.TENANCY_ENFORCED = 'true';
    require('../utils/chatSocket').initializeChatSocket(io);
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    for (const socket of sockets) socket.disconnect();
    if (io) await new Promise((resolve) => io.close(resolve));
    events.setRealtime(null); delete process.env.TENANCY_ENFORCED;
    await db.dropSchema(schema, { cascade: true }); await db.close();
  });
  const token = () => generateTokens({ user_id: shared.user_id, session_version: shared.session_version }).token;
  const socketFor = async (organization) => {
    const socket = connect(origin, { auth: { token: token(), organization_id: organization.organization_id }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.add(socket); await once(socket, 'connect'); return socket;
  };
  const publish = (organization, marker) => fetch(origin + '/publish', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}`, 'x-organization-id': organization.organization_id }, body: JSON.stringify({ marker }) });
  test('the same identity in A and B receives only the selected organizations events and presence', { timeout: 15000 }, async () => {
    const a = await socketFor(orgA); const aEvents = []; const bEvents = []; const aPresence = [];
    a.on('notification_created', (event) => aEvents.push(event)); a.on('user_online', (event) => aPresence.push(event));
    const b = await socketFor(orgB); b.on('notification_created', (event) => bEvents.push(event));
    await wait();
    assert.equal(aPresence.length, 0, 'B connection does not announce presence in A');
    assert.equal((await publish(orgA, 'A private')).status, 200); await wait();
    assert.deepEqual(aEvents.map((event) => event.marker), ['A private']);
    assert.deepEqual(bEvents, []);
    assert.equal(aEvents[0].organization_id, orgA.organization_id);
    assert.equal((await publish(orgB, 'B private')).status, 200); await wait();
    assert.deepEqual(bEvents.map((event) => event.marker), ['B private']);
    assert.equal(aEvents.length, 1);
    const bOnline = once(b, 'online_users'); b.emit('get_online_users');
    assert.deepEqual((await bOnline)[0].users.map((user) => user.user_id), [shared.user_id]);
    await models.OrganizationMembership.update({ status: 'suspended' }, { where: { organization_id: orgA.organization_id, user_id: shared.user_id } });
    await runWithTenant(aContext, () => events.emitUser(shared.user_id, 'notification_created', { marker: 'revoked' }));
    await wait(); assert.equal(aEvents.length, 1, 'idle suspended sockets do not receive delivery');
    const disconnected = once(a, 'disconnect');
    await events.disconnectMembership(shared.user_id, orgA.organization_id); await disconnected;
    assert.equal(b.connected, true);
    await runWithTenant(bContext, () => events.emitUser(shared.user_id, 'notification_created', { marker: 'B survives' }));
    await wait(); assert.deepEqual(bEvents.map((event) => event.marker), ['B private', 'B survives']);
  });
  test('a forged organization cannot open a socket', { timeout: 5000 }, async () => {
    const socket = connect(origin, { auth: { token: token(), organization_id: randomUUID() }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.add(socket); const [error] = await once(socket, 'connect_error'); assert.match(error.message, /Authentication/);
  });
  test('another organization cannot invoke the legacy Zoho credentials', async (t) => {
    for (const name of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN', 'ZOHO_ORGANIZATION_ID', 'ZOHO_DEFAULT_ITEM_ID']) process.env[name] = 'test-legacy-only';
    const post = t.mock.method(require('axios'), 'post', async () => { throw new Error('Unexpected external credential use'); });
    const result = await runWithTenant(bContext, () => require('../utils/zohoService').getOrganizationMetrics());
    assert.deepEqual(result, { configured: false, organization: null });
    assert.equal(post.mock.callCount(), 0);
    await assert.rejects(runWithTenant(bContext, () => require('../utils/zohoService').syncProjectInvoice({ invoice_type: 'project' })), /not configured|organization/i);
    assert.equal(post.mock.callCount(), 0);
  });
}
