const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const url = process.env.WORKFORCE_TEST_DATABASE_URL;
if (!url) test("PostgreSQL user management migration (set WORKFORCE_TEST_DATABASE_URL)", { skip: true }, () => {});
else {
  const { Sequelize, QueryTypes } = require("sequelize");
  const schema = `workforce_migration_${randomUUID().replaceAll("-", "")}`;
  const db = new Sequelize(url, { schema, logging: false }); const qi = db.getQueryInterface();
  const table = (name) => `"${schema}"."${name}"`;
  const migration = require("../migrations/20261119090000-user-management");
  const manager = randomUUID(), inherited = randomUUID(), override = randomUUID(), overriddenManager = randomUUID(), department = randomUUID();
  const rows = (name) => db.query(`SELECT * FROM ${table(name)}`, { type: QueryTypes.SELECT });
  before(async () => {
    await db.createSchema(schema);
    await db.query(`
      CREATE TABLE ${table("users")} (user_id UUID PRIMARY KEY, department_id UUID, reports_to_user_id UUID, is_active BOOLEAN DEFAULT true, workforce_permissions TEXT[] DEFAULT '{}', location_sharing_enabled BOOLEAN DEFAULT false, browser_latitude NUMERIC, browser_longitude NUMERIC, browser_location_country TEXT, city TEXT);
      CREATE TABLE ${table("departments")} (department_id UUID PRIMARY KEY, manager_user_id UUID);
      CREATE TABLE ${table("attendance_entries")} (attendance_id UUID PRIMARY KEY, user_id UUID, clock_out TIMESTAMPTZ, latitude NUMERIC, longitude NUMERIC, location_accuracy NUMERIC);
      CREATE TABLE ${table("projects")} (projects_id UUID PRIMARY KEY);
      CREATE TABLE ${table("notifications")} (notifications_id UUID PRIMARY KEY, user_id UUID);
      CREATE TABLE ${table("role_permissions")} (role_permission_id UUID PRIMARY KEY, permission_key VARCHAR(255) UNIQUE, name TEXT, super_admin BOOLEAN DEFAULT true, admin BOOLEAN, project_manager BOOLEAN, staff BOOLEAN, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);
    `);
    await db.query(`INSERT INTO ${table("users")} (user_id, department_id, reports_to_user_id, workforce_permissions, browser_latitude, browser_longitude, browser_location_country, city) VALUES
      (:manager, NULL, NULL, '{}', NULL, NULL, NULL, NULL), (:other, NULL, NULL, '{}', NULL, NULL, NULL, NULL),
      (:inherited, :department, NULL, '{create_project}', 1, 2, 'Collected', 'Manual'), (:override, :department, :other, '{}', NULL, NULL, NULL, NULL)`, { replacements: { manager, other: overriddenManager, inherited, override, department } });
    await db.query(`INSERT INTO ${table("departments")} VALUES (:department, :manager); INSERT INTO ${table("attendance_entries")} VALUES (:entry, :inherited, NOW(), 1, 2, 5); INSERT INTO ${table("role_permissions")} (role_permission_id, permission_key, name, admin, project_manager, staff) VALUES (:permission, 'create_project', 'Legacy projects', false, true, false)`, { replacements: { department, manager, inherited, entry: randomUUID(), permission: randomUUID() } });
  });
  after(async () => { await db.dropSchema(schema, { cascade: true }); await db.close(); });
  test("upgrade and repeated execution preserve grants, reporting provenance and configured switches while purging opted-out locations", async () => {
    await migration.up(qi, Sequelize); await migration.up(qi, Sequelize);
    const users = await rows("users"); const child = users.find((u) => u.user_id === inherited), custom = users.find((u) => u.user_id === override);
    assert.equal(child.reports_to_user_id, manager); assert.equal(child.reporting_manager_mode, "department"); assert.equal(custom.reporting_manager_mode, "override"); assert.equal(custom.reports_to_user_id, overriddenManager);
    assert.deepEqual(child.workforce_permissions, ["create_projects"]); assert.equal(child.auto_clock_out_enabled, false); assert.equal(child.auto_clock_out_time, null);
    assert.equal(child.browser_latitude, null); assert.equal(child.browser_location_country, null); assert.equal(child.city, "Manual");
    assert.equal((await rows("attendance_entries"))[0].latitude, null); assert.equal((await rows("attendance_entries"))[0].clock_out_source, "manual");
    assert.equal((await rows("role_permissions")).find((p) => p.permission_key === "create_projects").admin, false);
    await assert.rejects(db.query(`UPDATE ${table("users")} SET auto_clock_out_time = '17:00' WHERE user_id = :id`, { replacements: { id: inherited } }), /check constraint/);
    await assert.rejects(db.query(`UPDATE ${table("users")} SET auto_clock_out_enabled = true, auto_clock_out_time = NULL WHERE user_id = :id`, { replacements: { id: inherited } }), /check constraint/);
    await assert.rejects(db.query(`UPDATE ${table("users")} SET auto_clock_out_enabled = true, auto_clock_out_time = '16:59' WHERE user_id = :id`, { replacements: { id: inherited } }), /check constraint/);
  });
  test("rollback removes the additive schema while leaving the privacy purge irreversible", async () => {
    await migration.down(qi); const columns = await qi.describeTable({ tableName: "users", schema }); assert.equal(columns.deleted_at, undefined); assert.equal(columns.auto_clock_out_time, undefined);
    assert.equal((await rows("users")).find((u) => u.user_id === inherited).browser_latitude, null);
  });
}
