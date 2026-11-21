const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = process.env.TENANCY_TEST_DATABASE_URL;
if (!url) test('tenant HTTP/PostgreSQL seam (set TENANCY_TEST_DATABASE_URL)', { skip: true }, () => {});
else {
  const { Sequelize } = require('sequelize');
  const schema = `tenant_http_${randomUUID().replaceAll('-', '')}`;
  const db = new Sequelize(url, { schema, logging: false }); db.schema = schema;
  db.afterDefine((model) => { model.options.schema = schema; });
  const path = require.resolve('../config/database'); require.cache[path] = { id: path, filename: path, loaded: true, exports: db };
  const models = require('../models');
  let server, origin, shared, other, orgA, orgB, aDepartment;
  before(async () => {
    await db.createSchema(schema); await db.sync();
    const role = await models.Role.create({ role_key: 'staff', name: 'Staff', is_system: true });
    shared = await models.User.create({ email: 'shared@example.test', role_id: role.role_id });
    other = await models.User.create({ email: 'other@example.test', role_id: role.role_id });
    orgA = await models.Organization.create({ slug: 'a', name: 'A' }); orgB = await models.Organization.create({ slug: 'b', name: 'B' });
    await role.update({ organization_id: orgA.organization_id });
    const otherRole = await models.Role.create({ role_key: 'other_staff', name: 'Other Staff', is_system: true, organization_id: orgB.organization_id });
    for (const [organization, user] of [[orgA, shared], [orgB, shared], [orgA, other]]) {
      const membership = await models.OrganizationMembership.create({ organization_id: organization.organization_id, user_id: user.user_id });
      await models.HRProfile.create({ organization_id: organization.organization_id, membership_id: membership.membership_id, user_id: user.user_id, role_id: organization === orgA ? role.role_id : otherRole.role_id });
    }
    aDepartment = await models.Department.create({ organization_id: orgA.organization_id, name: 'A private', code: 'A' });
    await models.Department.create({ organization_id: orgB.organization_id, name: 'B private', code: 'B' });
    const express = require('express'); const app = express(); app.use(express.json());
    app.use(async (req, res, next) => { req.user = await models.User.findByPk(req.header('x-test-user') || shared.user_id); next(); });
    app.use(require('../middleware/organization').requireOrganization);
    app.get('/departments', async (req, res, next) => { try {
      await new Promise((resolve) => setTimeout(resolve, req.query.delay ? 20 : 0));
      res.json(await require('../services/tenantRepository').tenantRepository(models.Department).findAll());
    } catch (e) { next(e); } });
    app.get('/departments/:id', async (req, res, next) => { try { const row = await require('../services/tenantRepository').tenantRepository(models.Department).findByPk(req.params.id); res.status(row ? 200 : 404).json(row); } catch(e) { next(e); } });
    app.post('/departments', async (req, res, next) => { try { res.status(201).json(await require('../services/tenantRepository').tenantRepository(models.Department).create(req.body)); } catch(e) { next(e); } });
    app.use((e, req, res, next) => res.status(e.status || 500).json({ error: e.message }));
    server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); await db.dropSchema(schema, { cascade: true }); await db.close(); });
  const request = (path, org, options = {}) => fetch(origin + path, { ...options, headers: { 'content-type': 'application/json', ...(org ? { 'x-organization-id': org.organization_id } : {}), ...options.headers } });
  test('explicit membership selection isolates concurrent reads and by-id writes fail closed', async () => {
    assert.equal((await request('/departments')).status, 409);
    const [a, b] = await Promise.all([request('/departments?delay=1', orgA).then((r) => r.json()), request('/departments', orgB).then((r) => r.json())]);
    assert.deepEqual(a.map((r) => r.name), ['A private']); assert.deepEqual(b.map((r) => r.name), ['B private']);
    assert.equal((await request(`/departments/${aDepartment.department_id}`, orgB)).status, 404);
    assert.equal((await request('/departments', { organization_id: randomUUID() })).status, 403);
    assert.equal((await request('/departments', { organization_id: 'invalid' })).status, 400);
    const created = await request('/departments', orgA, { method: 'POST', body: JSON.stringify({ name: 'Created', code: 'C' }) }); assert.equal(created.status, 201); assert.equal((await created.json()).organization_id, orgA.organization_id);
    assert.equal((await request('/departments', orgA, { method: 'POST', body: JSON.stringify({ organization_id: orgB.organization_id, name: 'Forged', code: 'F' }) })).status, 400);
    await models.OrganizationMembership.update({ status: 'suspended' }, { where: { user_id: shared.user_id, organization_id: orgA.organization_id } });
    assert.equal((await request('/departments', orgA)).status, 403);
    const inferred = await request('/departments', undefined, { headers: { 'x-test-user': other.user_id } }); assert.equal(inferred.status, 200);
    await assert.rejects(require('../services/tenantRepository').tenantRepository(models.Department).findAll(), /Organization context/);
  });
}
