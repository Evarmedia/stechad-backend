const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;

if (!databaseUrl) {
  test("PostgreSQL email migration (set AUTH_TEST_DATABASE_URL to run)", { skip: true }, () => {});
} else {
  const { Sequelize, QueryTypes } = require("sequelize");
  const schema = `email_migration_${randomUUID().replaceAll("-", "")}`;
  const database = new Sequelize(databaseUrl, { schema, logging: false });
  const qi = database.getQueryInterface();
  const migration = require("../migrations/20261117140000-normalize-emails");
  const table = (name) => `"${schema}"."${name}"`;
  const rows = (name) => database.query(`SELECT * FROM ${table(name)}`, { type: QueryTypes.SELECT });

  before(async () => {
    await database.createSchema(schema);
    await database.query(`
      CREATE TABLE ${table("users")} (user_id INTEGER PRIMARY KEY, email TEXT UNIQUE, password TEXT);
      CREATE TABLE ${table("invites")} (email TEXT);
      CREATE TABLE ${table("interviews")} (candidate_email TEXT, interviewer_email TEXT);
      INSERT INTO ${table("users")} VALUES (1, 'Compassion@stechad.com', 'unchanged-hash'), (2, 'compassion@stechad.com', 'other-hash');
      INSERT INTO ${table("invites")} VALUES (' Invited@Stechad.com ');
      INSERT INTO ${table("interviews")} VALUES (' Candidate@Example.com ', 'Interviewer@Example.com');
    `);
  });
  after(async () => {
    try { await database.dropSchema(schema, { cascade: true }); }
    finally { await database.close(); }
  });

  test("migration rolls back on collisions, normalizes all fields, guards writes and can be undone", async () => {
    await assert.rejects(migration.up(qi), /duplicate account group/);
    assert.equal((await rows("users"))[0].email, "Compassion@stechad.com");
    assert.equal((await rows("invites"))[0].email, " Invited@Stechad.com ");
    await database.query(`DELETE FROM ${table("users")} WHERE user_id = 2`);
    await migration.up(qi);
    assert.deepEqual(await rows("users"), [{ user_id: 1, email: "compassion@stechad.com", password: "unchanged-hash" }]);
    assert.deepEqual(await rows("invites"), [{ email: "invited@stechad.com" }]);
    assert.deepEqual(await rows("interviews"), [{ candidate_email: "candidate@example.com", interviewer_email: "interviewer@example.com" }]);
    await assert.rejects(database.query(`INSERT INTO ${table("users")} VALUES (3, 'COMPASSION@stechad.com', 'hash')`));
    await assert.rejects(database.query(`INSERT INTO ${table("users")} VALUES (3, 'compassion@stechad.com', 'hash')`));
    await assert.rejects(database.query(`INSERT INTO ${table("invites")} VALUES ('Mixed@Example.com')`));
    await assert.rejects(database.query(`INSERT INTO ${table("interviews")} VALUES (' lower@example.com ', 'lower@example.com')`));
    await migration.down(qi);
    await database.query(`INSERT INTO ${table("users")} VALUES (3, 'Mixed@Example.com', 'hash')`);
    await migration.up(qi);
    assert.equal((await rows("users")).find((row) => row.user_id === 3).email, "mixed@example.com");
  });
}
