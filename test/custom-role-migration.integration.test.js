const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const url = process.env.WORKFORCE_TEST_DATABASE_URL;
if (!url) test("PostgreSQL custom role migration (set WORKFORCE_TEST_DATABASE_URL)", { skip: true }, () => {});
else {
  const { Sequelize, QueryTypes } = require("sequelize");
  const schema = `role_upgrade_${randomUUID().replaceAll("-", "")}`;
  const db = new Sequelize(url, { schema, logging: false });
  const q = db.getQueryInterface();
  const table = `"${schema}"."roles"`;
  const migration = require("../migrations/20261119110000-custom-role-permissions");
  before(async () => {
    await db.createSchema(schema);
    await db.query(`CREATE TABLE ${table} (role_id UUID PRIMARY KEY, role_key TEXT, name TEXT, is_system BOOLEAN); INSERT INTO ${table} VALUES (:id, 'finance', 'Finance reviewer', false)`, { replacements: { id: randomUUID() } });
  });
  after(async () => { await db.dropSchema(schema, { cascade: true }); await db.close(); });
  test("role permission upgrade is repeatable, preserves saved grants, and enforces array storage", async () => {
    await migration.up(q, Sequelize); await migration.up(q, Sequelize);
    const [row] = await db.query(`SELECT * FROM ${table}`, { type: QueryTypes.SELECT });
    assert.deepEqual(row.permission_keys, []); assert.equal(row.name, "Finance reviewer");
    await db.query(`UPDATE ${table} SET permission_keys = '["create_projects"]'::jsonb`);
    await migration.up(q, Sequelize);
    assert.deepEqual((await db.query(`SELECT permission_keys FROM ${table}`, { type: QueryTypes.SELECT }))[0].permission_keys, ["create_projects"]);
    await assert.rejects(db.query(`UPDATE ${table} SET permission_keys = '{}'::jsonb`), /check constraint/);
    await assert.rejects(db.query(`UPDATE ${table} SET permission_keys = NULL`), /not-null constraint/);
  });
  test("rollback and re-upgrade preserve role identities while clearing only the added configuration", async () => {
    await migration.down(q); await migration.down(q);
    assert.equal((await q.describeTable({ tableName: "roles", schema })).permission_keys, undefined);
    assert.equal((await db.query(`SELECT name FROM ${table}`, { type: QueryTypes.SELECT }))[0].name, "Finance reviewer");
    await migration.up(q, Sequelize);
    assert.deepEqual((await db.query(`SELECT permission_keys FROM ${table}`, { type: QueryTypes.SELECT }))[0].permission_keys, []);
  });
}
