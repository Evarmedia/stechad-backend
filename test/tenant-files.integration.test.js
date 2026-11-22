const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Writable } = require('node:stream');
const url = process.env.TENANCY_TEST_DATABASE_URL;
if (!url) test('tenant files HTTP/PostgreSQL (set TENANCY_TEST_DATABASE_URL)', { skip: true }, () => {});
else {
  const { Sequelize } = require('sequelize');
  const schema = `tenant_files_${randomUUID().replaceAll('-', '')}`;
  const db = new Sequelize(url, { schema, logging: false }); db.schema = schema;
  db.afterDefine((model) => { model.options.schema = schema; });
  const databasePath = require.resolve('../config/database'); require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: db };
  // Only the external storage transport is fake. Authorization, signing helper,
  // upload middleware, routes, JWT authentication, and PostgreSQL are real.
  const calls = [];
  const transport = require.resolve('@google-cloud/storage');
  require.cache[transport] = { id: transport, filename: transport, loaded: true, exports: { Storage: class {
    bucket() { return { file: (name) => ({
      getSignedUrl: async () => { calls.push(['sign', name]); return [`https://storage.test/${name}`]; },
      createWriteStream: () => new Writable({ write(chunk, encoding, done) { calls.push(['upload', name]); done(); } }),
      delete: async () => { calls.push(['delete', name]); },
    }) }; }
  } } };
  process.env.JWT_SECRET = 'file-test-access'; process.env.JWT_REFRESH_SECRET = 'file-test-refresh';
  const models = require('../models'); const { generateTokens } = require('../utils/generateTokens');
  let server, origin, shared, orgA, orgB;
  before(async () => {
    await db.createSchema(schema); await db.sync();
    orgA = await models.Organization.create({ slug: 'files-a', name: 'A' }); orgB = await models.Organization.create({ slug: 'files-b', name: 'B' });
    const roleA = await models.Role.create({ organization_id: orgA.organization_id, role_key: 'staff', name: 'Staff', is_system: true });
    const roleB = await models.Role.create({ organization_id: orgB.organization_id, role_key: 'admin', name: 'Admin B', is_system: true });
    shared = await models.User.create({ email: 'files@example.test', first_name: 'Shared', role_id: roleA.role_id });
    for (const [organization, role] of [[orgA, roleA], [orgB, roleB]]) {
      const membership = await models.OrganizationMembership.create({ organization_id: organization.organization_id, user_id: shared.user_id });
      await models.HRProfile.create({ organization_id: organization.organization_id, membership_id: membership.membership_id, user_id: shared.user_id, role_id: role.role_id });
    }
    await models.Talent.create({ organization_id: orgA.organization_id, user_id: shared.user_id, cv_object_name: 'resumes/legacy-private.pdf' });
    const express = require('express'); const app = express(); app.use(express.json());
    app.use('/api/analytics', require('../routes/analyticsRoutes'));
    app.use('/api/export', require('../routes/exportRoutes'));
    app.use('/api/notifications', require('../routes/notificationRoutes'));
    app.use('/api/upload', require('../routes/uploadRoutes'));
    app.use('/api/staff', require('../routes/staffRoutes'));
    app.get('/api/sign', require('../middleware/auth').authenticate, async (req, res, next) => {
      try { res.json({ url: await require('../config/gcpStorage').getV4ReadSignedUrl(req.query.objectName) }); } catch (error) { next(error); }
    });
    app.post('/api/audit', require('../middleware/auth').authenticateIdentity, async (req, res, next) => {
      try { await require('../utils/audit').recordAudit({ action: 'identity.test', target_type: 'User', target_id: req.user.user_id, actor: req.user }); res.sendStatus(204); } catch (error) { next(error); }
    });
    app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
    process.env.TENANCY_ENFORCED = 'true';
    server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { delete process.env.TENANCY_ENFORCED; if (server) await new Promise((resolve) => server.close(resolve)); await db.dropSchema(schema, { cascade: true }); await db.close(); });
  const request = (path, organization, options = {}, user = shared) => fetch(origin + path, { ...options, headers: { authorization: `Bearer ${generateTokens(user).token}`, ...(organization ? { 'x-organization-id': organization.organization_id } : {}), ...options.headers } });
  test('saved uploaded avatars remain visible to colleagues while private CVs and foreign organizations stay denied', async () => {
    const role = await models.Role.findOne({ where: { organization_id: orgA.organization_id, role_key: 'staff' } });
    const colleague = await models.User.create({ email: 'colleague@example.test', role_id: role.role_id });
    const membership = await models.OrganizationMembership.create({ organization_id: orgA.organization_id, user_id: colleague.user_id });
    await models.HRProfile.create({ organization_id: orgA.organization_id, membership_id: membership.membership_id, user_id: colleague.user_id, role_id: role.role_id });
    const body = new FormData(); body.append('avatar', new Blob(['image-test'], { type: 'image/png' }), 'avatar.png');
    const saved = await request('/api/staff/profile', orgA, { method: 'PUT', body });
    assert.equal(saved.status, 200, await saved.clone().text());
    const objectName = (await saved.json()).data.avatar_object_name;
    assert.match(objectName, /\/profile-images\//, 'existing storage names remain compatible');
    const signed = await request(`/api/sign?objectName=${encodeURIComponent(objectName)}`, orgA, {}, colleague);
    assert.equal(signed.status, 200, await signed.clone().text());
    assert.match((await signed.json()).url, /storage\.test/);
    // Entries uploaded before purpose normalization retain the old value.
    await models.StoredFile.update({ purpose: 'profile-images' }, { where: { object_name: objectName } });
    assert.equal((await request(`/api/sign?objectName=${encodeURIComponent(objectName)}`, orgA, {}, colleague)).status, 200);
    const count = calls.length;
    assert.equal((await request('/api/sign?objectName=resumes/legacy-private.pdf', orgA, {}, colleague)).status, 403);
    assert.equal((await request(`/api/sign?objectName=${encodeURIComponent(objectName)}`, orgB)).status, 403);
    assert.equal(calls.length, count, 'denied reads never reach storage');
  });
  test('private file reads honor current HR grants and preserve recruiting-role CV access', async () => {
    const people = {};
    for (const [key, permissionKeys] of [['project_manager', []], ['reviewer', ['manage_staff']], ['admin', []]]) {
      const role = await models.Role.create({ organization_id: orgA.organization_id, role_key: key, name: key, is_system: key !== 'reviewer', permission_keys: permissionKeys });
      const user = await models.User.create({ email: `${key}@files.test`, role_id: role.role_id });
      const membership = await models.OrganizationMembership.create({ organization_id: orgA.organization_id, user_id: user.user_id });
      await models.HRProfile.create({ organization_id: orgA.organization_id, membership_id: membership.membership_id, user_id: user.user_id, role_id: role.role_id });
      people[key] = user;
    }
    for (const user of [people.project_manager, people.reviewer]) assert.equal((await request('/api/sign?objectName=resumes/legacy-private.pdf', orgA, {}, user)).status, 200);
    await models.StoredFile.create({ organization_id: orgA.organization_id, owner_user_id: shared.user_id, object_name: 'receipts/private.pdf', purpose: 'receipts' });
    assert.equal((await request('/api/sign?objectName=receipts/private.pdf', orgA, {}, people.admin)).status, 200, 'default expense approval permits receipt reads');
    for (const permission_key of ['approve_expenses', 'verify_receipts']) await models.RolePermission.create({ organization_id: orgA.organization_id, permission_key, name: permission_key, admin: false });
    assert.equal((await request('/api/sign?objectName=receipts/private.pdf', orgA, {}, people.admin)).status, 403, 'configured grants govern file access too');
    await models.RolePermission.create({ organization_id: orgA.organization_id, permission_key: 'manage_staff', name: 'Manage staff', admin: false });
    assert.equal((await request('/api/sign?objectName=resumes/legacy-private.pdf', orgA, {}, people.admin)).status, 200, 'recruiting CV access is independent of workforce management');
  });
  test('legacy CV ownership and signing use selected organization even for a shared identity', async () => {
    assert.equal((await request('/api/sign?objectName=resumes/legacy-private.pdf', orgA)).status, 200);
    const count = calls.length;
    assert.equal((await request('/api/sign?objectName=resumes/legacy-private.pdf', orgB)).status, 403);
    assert.equal((await request('/api/sign?objectName=unknown/guessed.pdf', orgA)).status, 403);
    assert.equal(calls.length, count, 'forbidden requests never reach external signing');
  });
  test('uploads bind ownership, forged actors and conflicting organizations fail, deletes enforce ownership', async () => {
    const body = new FormData(); body.append('resume', new Blob(['%PDF-test'], { type: 'application/pdf' }), 'cv.pdf');
    const response = await request('/api/upload/resume', orgB, { method: 'POST', body }); assert.equal(response.status, 200, await response.clone().text());
    const { data } = await response.json(); assert.match(data.objectName, new RegExp(`^organizations/${orgB.organization_id}/resumes/${shared.user_id}`));
    const stored = await models.StoredFile.findOne({ where: { object_name: data.objectName } }); assert.equal(stored.organization_id, orgB.organization_id); assert.equal(stored.owner_user_id, shared.user_id);
    assert.equal((await request(`/api/sign?objectName=${encodeURIComponent(data.objectName)}`, orgA)).status, 403);
    const forged = new FormData(); forged.append('user_id', randomUUID()); forged.append('resume', new Blob(['pdf'], { type: 'application/pdf' }), 'cv.pdf');
    const count = calls.length;
    assert.equal((await request('/api/upload/resume', orgB, { method: 'POST', body: forged })).status, 403); assert.equal(calls.length, count);
    const del = (organization, payload) => request('/api/upload/delete-file', organization, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    assert.equal((await del(orgA, { objectName: data.objectName })).status, 403);
    assert.equal((await del(orgB, { objectName: data.objectName, organization_id: orgA.organization_id })).status, 400);
    assert.equal((await del(orgB, { objectName: data.objectName })).status, 200);
    assert.equal(calls.filter(([type]) => type === 'delete').length, 1);
  });
  test('notifications, nested exports and report aggregates stay in the selected organization', async () => {
    for (const [organization, marker] of [[orgA, 'A confidential'], [orgB, 'B only']]) {
      await models.Notification.create({ organization_id: organization.organization_id, user_id: shared.user_id, title: marker, message: marker });
      await models.Job.create({ organization_id: organization.organization_id, posted_by: shared.user_id, title: marker, company: marker, location: 'Remote', description: marker });
    }
    const ownNotifications = await request('/api/notifications', orgB); assert.equal(ownNotifications.status, 200, await ownNotifications.clone().text());
    const notifications = await ownNotifications.json(); assert.match(JSON.stringify(notifications), /B only/); assert.doesNotMatch(JSON.stringify(notifications), /A confidential/);
    const foreign = await models.Notification.findOne({ where: { organization_id: orgA.organization_id } });
    assert.equal((await request(`/api/notifications/${foreign.notifications_id}/read`, orgB, { method: 'PUT' })).status, 404);
    const exported = await request('/api/export/jobs', orgB); assert.equal(exported.status, 200, await exported.clone().text());
    const exportBody = await exported.json(); assert.equal(exportBody.count, 1); assert.match(JSON.stringify(exportBody), /B only/); assert.doesNotMatch(JSON.stringify(exportBody), /A confidential/);
    const analytics = await request('/api/analytics/users', orgB); assert.equal(analytics.status, 200, await analytics.clone().text());
    const stats = await analytics.json(); assert.equal(stats.data.total_users, 1); assert.equal(stats.data.role_distribution.admins, 1);
    assert.equal((await request('/api/analytics/users', orgA)).status, 403, 'shared identity has separate HR privileges');
  });
  test('identity events audit globally without needing or assigning an HR tenant', async () => {
    assert.equal((await request('/api/audit', null, { method: 'POST' })).status, 204);
    assert.equal(await models.IdentityAuditLog.count({ where: { action: 'identity.test' } }), 1);
    assert.equal(await models.AuditLog.count({ where: { action: 'identity.test' } }), 0);
  });
}
