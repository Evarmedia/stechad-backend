const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const moment = require('moment');
const url = process.env.TENANCY_TEST_DATABASE_URL;
if (!url) test('tenant scheduled jobs/PostgreSQL seam (set TENANCY_TEST_DATABASE_URL)', { skip: true }, () => {});
else {
  process.env.TENANCY_ENFORCED = 'true';
  const { Sequelize } = require('sequelize');
  const schema = `tenant_jobs_${randomUUID().replaceAll('-', '')}`;
  const db = new Sequelize(url, { schema, logging: false }); db.schema = schema;
  db.afterDefine((model) => { model.options.schema = schema; });
  const path = require.resolve('../config/database'); require.cache[path] = { id: path, filename: path, loaded: true, exports: db };
  const m = require('../models');
  const { runWithTenant, resolveTenantContext } = require('../services/tenantContext');
  const scheduler = require('../utils/attendanceScheduler');
  let shared, removed, archivedProfileUser, orgA, orgB, archived, entries = {};
  const tick = new Date('2026-11-22T18:00:00Z');
  async function member(org, user, role, options = {}) {
    const membership = await m.OrganizationMembership.create({ organization_id: org.organization_id, user_id: user.user_id, status: options.status || 'active' });
    await m.HRProfile.create({ organization_id: org.organization_id, membership_id: membership.membership_id, user_id: user.user_id, role_id: role.role_id, archived_at: options.archived_at });
  }
  before(async () => {
    await db.createSchema(schema); await db.sync();
    orgA = await m.Organization.create({ slug: 'a', name: 'A' }); orgB = await m.Organization.create({ slug: 'b', name: 'B' });
    archived = await m.Organization.create({ slug: 'archived', name: 'Archived', status: 'archived' });
    const adminA = await m.Role.create({ organization_id: orgA.organization_id, role_key: 'admin', name: 'Admin' });
    const staffB = await m.Role.create({ organization_id: orgB.organization_id, role_key: 'staff', name: 'Staff' });
    const staffC = await m.Role.create({ organization_id: archived.organization_id, role_key: 'staff', name: 'Staff' });
    shared = await m.User.create({ email: 'shared-jobs@example.test', role_id: adminA.role_id });
    removed = await m.User.create({ email: 'removed-jobs@example.test', role_id: staffB.role_id });
    archivedProfileUser = await m.User.create({ email: 'archived-profile@example.test', role_id: staffB.role_id });
    await member(orgA, shared, adminA); await member(orgB, shared, staffB); await member(archived, shared, staffC);
    await member(orgB, removed, staffB, { status: 'removed' });
    await member(orgB, archivedProfileUser, staffB, { archived_at: tick });
    for (const [key, org, user] of [['a', orgA, shared], ['b', orgB, shared], ['archived', archived, shared], ['removed', orgB, removed], ['profile', orgB, archivedProfileUser]]) {
      entries[key] = await m.Attendance.create({ organization_id: org.organization_id, user_id: user.user_id, work_date: '2026-11-22', clock_in: '2026-11-22T08:00:00Z', auto_clock_out_at: '2026-11-22T16:00:00Z' });
    }
  });
  after(async () => { await db.dropSchema(schema, { cascade: true }); await db.close(); });
  test('request reconciliation touches only selected organization, timer uses each active HR role', async () => {
    const ctx = await resolveTenantContext({ userId: shared.user_id, organizationId: orgA.organization_id });
    await runWithTenant(ctx, () => scheduler.reconcileUnclosedAttendance(tick));
    await entries.a.reload(); await entries.b.reload();
    assert.equal(entries.a.status, 'cancelled'); assert.equal(entries.b.status, 'present');
    await scheduler.reconcileUnclosedAttendance(tick);
    await entries.b.reload();
    assert.equal(entries.b.status, 'completed'); assert.equal(entries.b.clock_out_source, 'automatic');
    for (const key of ['archived', 'removed', 'profile']) { await entries[key].reload(); assert.equal(entries[key].status, 'present'); }
    const absent = await m.Attendance.create({ organization_id: orgB.organization_id, user_id: shared.user_id, work_date: '2026-11-21', clock_in: '2026-11-21T08:00:00Z' });
    assert.equal(await scheduler.reconcileUnclosedAttendance(tick), 1);
    await absent.reload(); assert.equal(absent.status, 'absent');
    assert.equal(await scheduler.reconcileUnclosedAttendance(tick), 0);
  });
  test('holiday ticks use organization recipients, HR destinations and organization deduplication', async () => {
    const tomorrow = moment().add(1, 'day').format('YYYY-MM-DD');
    for (const org of [orgA, orgB, archived]) await m.Holiday.create({ organization_id: org.organization_id, name: 'Shared holiday', date: tomorrow });
    const holidays = require('../utils/holidayNotifications');
    const ctx = await resolveTenantContext({ userId: shared.user_id, organizationId: orgA.organization_id });
    assert.equal(await runWithTenant(ctx, () => holidays.sendUpcomingHolidayNotifications()), 1);
    assert.equal(await m.Notification.count({ where: { organization_id: orgB.organization_id } }), 0);
    assert.equal((await Promise.all([holidays.sendUpcomingHolidayNotifications(), holidays.sendUpcomingHolidayNotifications()])).reduce((sum, count) => sum + count, 0), 1);
    assert.equal(await holidays.sendUpcomingHolidayNotifications(), 0);
    const rows = await m.Notification.findAll({ order: [['action_url', 'ASC']] });
    assert.equal(rows.length, 2);
    assert.deepEqual(new Set(rows.map((row) => row.organization_id)), new Set([orgA.organization_id, orgB.organization_id]));
    assert.ok(rows.every((row) => row.user_id === shared.user_id));
    assert.equal(rows.find((row) => row.organization_id === orgA.organization_id).action_url, '/admin/workforce?tab=holidays');
    assert.equal(rows.find((row) => row.organization_id === orgB.organization_id).action_url, '/dashboard/staff/holidays');
    await m.OrganizationMembership.update({ status: 'removed' }, { where: { organization_id: orgB.organization_id, user_id: shared.user_id } });
    await m.Holiday.create({ organization_id: orgB.organization_id, name: 'After removal', date: tomorrow });
    assert.equal(await holidays.sendUpcomingHolidayNotifications(), 0);
    assert.equal(await m.Notification.count(), 2);
  });

}
