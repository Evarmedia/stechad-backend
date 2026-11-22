const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = process.env.WORKFORCE_TEST_DATABASE_URL;
if (!url) test('tenant workforce HTTP/PostgreSQL (set WORKFORCE_TEST_DATABASE_URL)', { skip: true }, () => {});
else {
  const { Sequelize } = require('sequelize');
  const schema = `tenant_workforce_${randomUUID().replaceAll('-', '')}`;
  const db = new Sequelize(url, { schema, logging: false }); db.schema = schema;
  db.afterDefine((model) => { model.options.schema = schema; });
  const path = require.resolve('../config/database'); require.cache[path] = { id: path, filename: path, loaded: true, exports: db };
  const sentInvitations = [];
  const emailPath = require.resolve('../utils/sendEmail'); require.cache[emailPath] = { id: emailPath, filename: emailPath, loaded: true, exports: async (message) => sentInvitations.push(message) };
  const models = require('../models');
  process.env.JWT_SECRET = 'tenant-workforce-test'; process.env.TENANCY_ENFORCED = 'true';
  process.env.GOOGLE_CLIENT_ID = 'test-client'; process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  let server, origin, shared, employee, bAdministrator, a, b, aRole, bRole, aDepartment, bDepartment;
  before(async () => {
    await db.createSchema(schema); await db.sync();
    a = await models.Organization.create({ slug: 'a', name: 'A' }); b = await models.Organization.create({ slug: 'b', name: 'B' });
    aRole = await models.Role.create({ organization_id: a.organization_id, role_key: 'admin', name: 'Admin', is_system: true });
    bRole = await models.Role.create({ organization_id: b.organization_id, role_key: 'staff', name: 'Staff', is_system: true });
    shared = await models.User.create({ email: 'shared@example.test', role_id: aRole.role_id, job_title: 'Global legacy title' });
    employee = await models.User.create({ email: 'employee@example.test', role_id: aRole.role_id });
    bAdministrator = await models.User.create({ email: 'b-admin@example.test', role_id: aRole.role_id });
    const bAdminRole = await models.Role.create({ organization_id: b.organization_id, role_key: 'admin', name: 'Admin', is_system: true });
    const bAdminMembership = await models.OrganizationMembership.create({ organization_id: b.organization_id, user_id: bAdministrator.user_id, membership_role: 'owner' });
    await models.HRProfile.create({ organization_id: b.organization_id, membership_id: bAdminMembership.membership_id, user_id: bAdministrator.user_id, role_id: bAdminRole.role_id });
    for (const [org, person, role, title] of [[a, shared, aRole, 'A boss'], [b, shared, bRole, 'B staff'], [a, employee, aRole, 'A employee'], [b, employee, bRole, 'B employee']]) {
      const membership = await models.OrganizationMembership.create({ organization_id: org.organization_id, user_id: person.user_id, membership_role: person === shared ? 'owner' : 'member' });
      await models.HRProfile.create({ organization_id: org.organization_id, membership_id: membership.membership_id, user_id: person.user_id, role_id: role.role_id, job_title: title, employee_id: person === employee ? 'EMP-1' : 'BOSS-1' });
    }
    aDepartment = await models.Department.create({ organization_id: a.organization_id, name: 'A department', code: 'DEP' });
    bDepartment = await models.Department.create({ organization_id: b.organization_id, name: 'B department', code: 'DEP' });
    const express = require('express'); const app = express(); app.use(express.json());
    app.use('/admin', require('../routes/adminRoutes'));
    app.use('/management', require('../routes/managementRoutes'));
    app.use('/staff', require('../routes/staffRoutes'));
    app.use('/auth', require('../routes/authRoutes'));
    app.use('/organizations', require('../routes/organizationRoutes'));
    app.use((e, req, res, next) => res.status(e.status || 500).json({ error: e.message }));
    server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); await db.dropSchema(schema, { cascade: true }); await db.close(); });
  const request = async (path, org, options = {}, who = shared) => { const token = require('jsonwebtoken').sign({ user_id: who.user_id, session_version: 0 }, process.env.JWT_SECRET); const response = await fetch(origin + path, { ...options, headers: { 'content-type': 'application/json', 'x-organization-id': org.organization_id, authorization: `Bearer ${token}` } }); return { status: response.status, body: await response.json() }; };
  test('HR staff management cannot suspend or remove organization owners while two owners are active', async () => {
    const org = await models.Organization.create({ slug: 'owner-boundary', name: 'Owner boundary' });
    const staffRole = await models.Role.create({ organization_id: org.organization_id, role_key: 'staff', name: 'Staff', is_system: true });
    const adminRole = await models.Role.create({ organization_id: org.organization_id, role_key: 'admin', name: 'HR administrator', is_system: true });
    const people = [];
    for (const [name, membershipRole, role] of [['first-owner', 'owner', staffRole], ['second-owner', 'owner', staffRole], ['hr-manager', 'member', adminRole], ['regular-member', 'member', staffRole]]) {
      const user = await models.User.create({ email: `${name}@owner.test`, role_id: role.role_id });
      const membership = await models.OrganizationMembership.create({ organization_id: org.organization_id, user_id: user.user_id, membership_role: membershipRole });
      await models.HRProfile.create({ organization_id: org.organization_id, user_id: user.user_id, membership_id: membership.membership_id, role_id: role.role_id, workforce_permissions: name === 'hr-manager' ? ['manage_staff'] : [] });
      people.push({ user, membership });
    }
    const [firstOwner, secondOwner, hrManager, regular] = people;
    const invitation = await request('/admin/workforce/invite', org, { method: 'POST', body: JSON.stringify({ email: 'new-colleague@owner.test', role_id: staffRole.role_id, first_name: 'New', last_name: 'Colleague' }) }, hrManager.user);
    assert.equal(invitation.status, 201, JSON.stringify(invitation.body));
    assert.equal(sentInvitations.at(-1).to, 'new-colleague@owner.test', 'HR manage_staff still allows ordinary member invitations');
    assert.equal((await request(`/organizations/${org.organization_id}/members`, org, {}, hrManager.user)).status, 403, 'HR grants do not grant organization management');
    for (const owner of [firstOwner, secondOwner]) {
      const suspended = await request(`/admin/workforce/users/${owner.user.user_id}`, org, { method: 'PUT', body: JSON.stringify({ is_active: false }) }, hrManager.user);
      assert.equal(suspended.status, 403, JSON.stringify(suspended.body));
      for (const suffix of ['', '/permanent']) {
        const removed = await request(`/admin/users/${owner.user.user_id}${suffix}`, org, { method: 'DELETE' }, hrManager.user);
        assert.equal(removed.status, 403, JSON.stringify(removed.body));
      }
    }
    const members = await request(`/organizations/${org.organization_id}/members`, org, {}, firstOwner.user);
    assert.equal(members.status, 200, JSON.stringify(members.body));
    assert.equal(members.body.data.members.filter((row) => row.membership_role === 'owner' && row.status === 'active').length, 2);
    const ordinaryUpdate = await request(`/admin/workforce/users/${regular.user.user_id}`, org, { method: 'PUT', body: JSON.stringify({ is_active: false }) }, hrManager.user);
    assert.equal(ordinaryUpdate.status, 200, JSON.stringify(ordinaryUpdate.body));
    const restored = await request(`/organizations/${org.organization_id}/members/${regular.membership.membership_id}`, org, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) }, firstOwner.user);
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    const removed = await request(`/organizations/${org.organization_id}/members/${regular.membership.membership_id}`, org, { method: 'DELETE' }, firstOwner.user);
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
  });
  test('tenant role and employment criteria drive directory filtering and pagination before serialization', async () => {
    const result = await request('/admin/users?search=EMP-1&role=admin&limit=1', a);
    assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.data.pagination.totalItems, 1);
    assert.equal(result.body.data.users[0].job_title, 'A employee'); assert.equal(result.body.data.users[0].role, 'admin');
    const other = await request('/admin/users?search=EMP-1&role=admin', b, {}, bAdministrator); assert.equal(other.status, 200); assert.equal(other.body.data.pagination.totalItems, 0);
    assert.equal((await request('/admin/users', b)).status, 403);
  });
  test('employment and membership removal in A preserve B and global account credentials', async () => {
    const update = await request(`/management/users/${employee.user_id}`, a, { method: 'PUT', body: JSON.stringify({ job_title: 'Changed in A', department_id: aDepartment.department_id }) });
    assert.equal(update.status, 200, JSON.stringify(update.body)); assert.equal(update.body.data.job_title, 'Changed in A');
    const foreignDepartment = await request(`/management/users/${employee.user_id}`, a, { method: 'PUT', body: JSON.stringify({ department_id: bDepartment.department_id }) }); assert.equal(foreignDepartment.status, 404);
    const foreignManager = await request(`/management/users/${employee.user_id}`, a, { method: 'PUT', body: JSON.stringify({ reports_to_user_id: bAdministrator.user_id }) }); assert.equal(foreignManager.status, 404);
    const other = await request('/admin/users?search=EMP-1', b, {}, bAdministrator); assert.equal(other.body.data.users[0].job_title, 'B employee');
    assert.equal((await request(`/admin/users/${employee.user_id}/permanent`, a, { method: 'DELETE' })).status, 200);
    const removed = await request('/admin/users?status=deleted&search=EMP-1', a); assert.equal(removed.body.data.users.length, 1);
    assert.equal((await request('/admin/users?search=EMP-1', b, {}, bAdministrator)).body.data.users.length, 1);
    const global = await models.User.unscoped().findByPk(employee.user_id); assert.ok(global); assert.equal(global.is_active, true); assert.equal(global.deleted_at, null); assert.equal(global.session_version, 0);
    assert.equal((await request(`/admin/users/${employee.user_id}/restore`, a, { method: 'POST', body: '{}' })).status, 200);
    const restored = await request('/admin/users?search=EMP-1', a); assert.equal(restored.body.data.users.length, 1); assert.equal(restored.body.data.users[0].job_title, 'Changed in A');
  });
  test('department bulk cleanup and settings upserts are organization scoped', async () => {
    const bProfile = await models.HRProfile.findOne({ where: { organization_id: b.organization_id, user_id: employee.user_id } }); await bProfile.update({ department_id: bDepartment.department_id });
    const workforce = await request('/admin/workforce', a); assert.equal(workforce.status, 200, JSON.stringify(workforce.body));
    assert.ok(!JSON.stringify(workforce.body).includes('B department'));
    assert.equal((await request(`/admin/departments/${aDepartment.department_id}`, a, { method: 'DELETE' })).status, 200);
    const aUser = await request('/admin/users?search=EMP-1', a); assert.equal(aUser.body.data.users[0].department_id, null);
    const bUser = await request('/admin/users?search=EMP-1', b, {}, bAdministrator); assert.equal(bUser.body.data.users[0].department_id, bDepartment.department_id);
    for (const [org, actor, prefix] of [[a, shared, 'AAA'], [b, bAdministrator, 'BBB'], [a, shared, 'AAC']]) {
      const result = await request('/admin/settings', org, { method: 'PUT', body: JSON.stringify({ settings: { EMPLOYEE_ID_PREFIX: prefix } }) }, actor); assert.equal(result.status, 200, JSON.stringify(result.body));
    }
    const settingsA = await request('/admin/settings', a); const settingsB = await request('/admin/settings', b, {}, bAdministrator);
    assert.equal(settingsA.body.data.EMPLOYEE_ID_PREFIX, 'AAC'); assert.equal(settingsB.body.data.EMPLOYEE_ID_PREFIX, 'BBB');
  });
  test('leave, expenses, invoices, KPIs, appraisals and holidays enforce organization boundaries', async () => {
    const rows = {};
    for (const [org, label] of [[a, 'A'], [b, 'B']]) {
      const common = { organization_id: org.organization_id };
      rows[label] = {
        leave: await models.LeaveRequest.create({ ...common, user_id: shared.user_id, leave_type: `${label} leave`, start_date: '2026-11-01', end_date: '2026-11-02' }),
        expense: await models.ExpenseClaim.create({ ...common, user_id: shared.user_id, category: `${label} expense`, amount: 11, expense_date: '2026-11-01' }),
        invoice: await models.Invoice.create({ ...common, submitted_by: shared.user_id, invoice_type: 'staff', invoice_number: 'SHARED-NUMBER', period: `${label} period`, amount: 12 }),
        kpi: await models.Kpi.create({ ...common, assigned_to_user_id: shared.user_id, title: `${label} KPI`, target: 'Quality', created_by: shared.user_id }),
      };
      await models.Holiday.create({ ...common, name: `${label} holiday`, date: '2027-01-01' });
    }
    for (const [path, aText, bText] of [['leave', 'A leave', 'B leave'], ['expenses', 'A expense', 'B expense'], ['invoices', 'A period', 'B period'], ['kpis', 'A KPI', 'B KPI'], ['holidays?all=true', 'A holiday', 'B holiday']]) {
      const result = await request(`/staff/${path}`, b); assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.ok(JSON.stringify(result.body).includes(bText)); assert.ok(!JSON.stringify(result.body).includes(aText));
    }
    assert.equal((await request('/staff/expenses', a)).status, 403);
    for (const [type, row] of [['leave', rows.B.leave], ['expense', rows.B.expense], ['invoice', rows.B.invoice]]) {
      const key = { leave: 'leave_request_id', expense: 'expense_claim_id', invoice: 'invoice_id' }[type];
      const result = await request(`/admin/workforce/approvals/${type}/${row[key]}`, a, { method: 'PUT', body: JSON.stringify({ action: 'approved' }) }); assert.equal(result.status, 404);
    }
    assert.equal((await request(`/admin/kpis/${rows.B.kpi.kpi_id}`, a, { method: 'PUT', body: JSON.stringify({ title: 'Forged' }) })).status, 404);
    assert.equal((await request(`/admin/kpis/${rows.B.kpi.kpi_id}/appraisals`, a, { method: 'POST', body: JSON.stringify({ score: 80, notes: 'Forged' }) })).status, 404);
    const foreignAssignee = await request('/admin/kpis', a, { method: 'POST', body: JSON.stringify({ assigned_to_user_id: bAdministrator.user_id, title: 'Forged', criteria: [{ id: 'quality', title: 'Quality' }] }) }); assert.equal(foreignAssignee.status, 404);
    const missingActor = await models.Invoice.create({ organization_id: a.organization_id, invoice_type: 'staff', invoice_number: 'HISTORY-NO-ACTOR', period: 'History retained', amount: 7, submitted_by: null });
    const approvals = await request('/admin/workforce', a); assert.equal(approvals.status, 200, JSON.stringify(approvals.body)); assert.ok(JSON.stringify(approvals.body).includes(missingActor.invoice_id));
  });
  test('profile role changes cancel attendance only in that organization and preferences remain independent', async () => {
    const staffRole = await models.Role.create({ organization_id: a.organization_id, role_key: 'staff', name: 'Staff', is_system: true });
    assert.equal((await request(`/admin/workforce/users/${employee.user_id}`, a, { method: 'PUT', body: JSON.stringify({ role_id: staffRole.role_id }) })).status, 200);
    const entries = [];
    for (const org of [a, b]) entries.push(await models.Attendance.create({ organization_id: org.organization_id, user_id: employee.user_id, work_date: '2026-11-21', clock_in: '2026-11-21T09:00:00Z', status: 'present' }));
    const promoted = await request(`/admin/workforce/users/${employee.user_id}`, a, { method: 'PUT', body: JSON.stringify({ role_id: aRole.role_id }) }); assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
    await entries[0].reload(); await entries[1].reload(); assert.equal(entries[0].status, 'cancelled'); assert.equal(entries[1].status, 'present');
    const settingA = await request('/auth/preferences', a, { method: 'PUT', body: JSON.stringify({ notification_sound_enabled: false }) }); assert.equal(settingA.status, 200, JSON.stringify(settingA.body));
    const settingB = await request('/auth/preferences', b, { method: 'PUT', body: JSON.stringify({ notification_sound_enabled: true }) }); assert.equal(settingB.status, 200, JSON.stringify(settingB.body));
    assert.equal((await request('/auth/preferences', a)).body.data.user.notification_sound_enabled, false);
    assert.equal((await request('/auth/preferences', b)).body.data.user.notification_sound_enabled, true);
  });
}
