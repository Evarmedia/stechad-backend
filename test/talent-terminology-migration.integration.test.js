const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

if (!databaseUrl) {
  test(
    "PostgreSQL Talent terminology migration (set CHAT_TEST_DATABASE_URL to run)",
    { skip: true },
    () => {},
  );
} else {
  const { Sequelize, QueryTypes } = require("sequelize");
  const schema = `talent_migration_${randomUUID().replaceAll("-", "")}`;
  const database = new Sequelize(databaseUrl, { logging: false, schema });
  database.schema = schema;
  const queryInterface = database.getQueryInterface();
  const migration = require("../migrations/20261111120000-talent-terminology");
  const ids = {
    role: randomUUID(),
    duplicateRole: randomUUID(),
    user: randomUUID(),
    profile: randomUUID(),
    project: randomUUID(),
    application: randomUUID(),
    interview: randomUUID(),
    invoice: randomUUID(),
    notification: randomUUID(),
  };
  const quotedSchema = queryInterface.queryGenerator.quoteIdentifier(schema);

  before(async () => {
    await database.createSchema(schema);
    await database.query(`
      CREATE TABLE ${quotedSchema}.roles (
        role_id UUID PRIMARY KEY,
        role_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL UNIQUE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE ${quotedSchema}.users (
        user_id UUID PRIMARY KEY,
        role_id UUID NOT NULL REFERENCES ${quotedSchema}.roles(role_id)
      );
      CREATE TABLE ${quotedSchema}.engineers (
        engineer_id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES ${quotedSchema}.users(user_id)
      );
      CREATE INDEX idx_engineers_user_id ON ${quotedSchema}.engineers(user_id);
      CREATE TABLE ${quotedSchema}.projects (
        projects_id UUID PRIMARY KEY
      );
      CREATE TABLE ${quotedSchema}.applications (
        applications_id UUID PRIMARY KEY,
        engineer_id UUID NOT NULL REFERENCES ${quotedSchema}.engineers(engineer_id),
        engineer_name TEXT
      );
      CREATE TABLE ${quotedSchema}.engineer_project (
        engineer_id UUID NOT NULL REFERENCES ${quotedSchema}.engineers(engineer_id),
        projects_id UUID NOT NULL REFERENCES ${quotedSchema}.projects(projects_id),
        CONSTRAINT engineer_project_pkey PRIMARY KEY (engineer_id, projects_id)
      );
      CREATE TABLE ${quotedSchema}.interviews (
        interviews_id UUID PRIMARY KEY,
        candidate_id UUID NOT NULL REFERENCES ${quotedSchema}.engineers(engineer_id)
      );
      CREATE TABLE ${quotedSchema}.invoices (
        invoice_id UUID PRIMARY KEY,
        invoice_type TEXT NOT NULL
      );
      CREATE TABLE ${quotedSchema}.notifications (
        notifications_id UUID PRIMARY KEY,
        title TEXT,
        message TEXT,
        action_url TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `);
    await database.query(
      `INSERT INTO ${quotedSchema}.roles (role_id, role_key, name) VALUES
         (:role, 'engineer', 'Engineer'),
         (:duplicateRole, 'talent', 'Talent');
       INSERT INTO ${quotedSchema}.users (user_id, role_id) VALUES (:user, :role);
       INSERT INTO ${quotedSchema}.engineers (engineer_id, user_id) VALUES (:profile, :user);
       INSERT INTO ${quotedSchema}.projects (projects_id) VALUES (:project);
       INSERT INTO ${quotedSchema}.applications (applications_id, engineer_id, engineer_name)
         VALUES (:application, :profile, 'Ada Talent');
       INSERT INTO ${quotedSchema}.engineer_project (engineer_id, projects_id)
         VALUES (:profile, :project);
       INSERT INTO ${quotedSchema}.interviews (interviews_id, candidate_id)
         VALUES (:interview, :profile);
       INSERT INTO ${quotedSchema}.invoices (invoice_id, invoice_type)
         VALUES (:invoice, 'engineer');
       INSERT INTO ${quotedSchema}.notifications
         (notifications_id, title, message, action_url, metadata)
         VALUES
         (:notification, 'Engineer application', 'An engineer applied',
          '/dashboard/engineer/applications',
          jsonb_build_object('engineer_id', :profile, 'engineer_name', 'Ada Talent'));`,
      { replacements: ids },
    );
  });

  after(async () => {
    try {
      await database.dropSchema(schema, { cascade: true });
    } finally {
      await database.close();
    }
  });

  test("renames the legacy schema without changing identities or relationships", async () => {
    await migration.up(queryInterface);
    await migration.up(queryInterface);

    const role = await database.query(
      `SELECT role_id, role_key, name FROM ${quotedSchema}.roles`,
      { type: QueryTypes.SELECT, plain: true },
    );
    assert.deepEqual(role, { role_id: ids.role, role_key: "talent", name: "Talent" });

    const application = await database.query(
      `SELECT talent_id, talent_name FROM ${quotedSchema}.applications`,
      { type: QueryTypes.SELECT, plain: true },
    );
    assert.deepEqual(application, {
      talent_id: ids.profile,
      talent_name: "Ada Talent",
    });
    assert.equal(
      await database.query(
        `SELECT COUNT(*)::integer AS count FROM ${quotedSchema}.talent_project`,
        { type: QueryTypes.SELECT, plain: true },
      ).then((row) => row.count),
      1,
    );
    assert.equal(
      await database.query(
        `SELECT candidate_id FROM ${quotedSchema}.interviews`,
        { type: QueryTypes.SELECT, plain: true },
      ).then((row) => row.candidate_id),
      ids.profile,
    );
    assert.equal(
      await database.query(
        `SELECT invoice_type FROM ${quotedSchema}.invoices`,
        { type: QueryTypes.SELECT, plain: true },
      ).then((row) => row.invoice_type),
      "talent",
    );
    const notification = await database.query(
      `SELECT title, message, action_url, metadata FROM ${quotedSchema}.notifications`,
      { type: QueryTypes.SELECT, plain: true },
    );
    assert.equal(notification.title, "Talent application");
    assert.equal(notification.message, "A talent applied");
    assert.equal(notification.action_url, "/dashboard/talent/applications");
    assert.equal(notification.metadata.talent_id, ids.profile);
    assert.equal(notification.metadata.engineer_id, undefined);

    const oldCatalogNames = await database.query(
      `SELECT COUNT(*)::integer AS count
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = :schema AND c.relname LIKE '%engineer%'`,
      { replacements: { schema }, type: QueryTypes.SELECT, plain: true },
    );
    assert.equal(oldCatalogNames.count, 0);
  });

  test("reverses the terminology migration", async () => {
    await migration.down(queryInterface);
    const role = await database.query(
      `SELECT role_id, role_key, name FROM ${quotedSchema}.roles`,
      { type: QueryTypes.SELECT, plain: true },
    );
    assert.deepEqual(role, {
      role_id: ids.role,
      role_key: "engineer",
      name: "Engineer",
    });
    const application = await database.query(
      `SELECT engineer_id, engineer_name FROM ${quotedSchema}.applications`,
      { type: QueryTypes.SELECT, plain: true },
    );
    assert.deepEqual(application, {
      engineer_id: ids.profile,
      engineer_name: "Ada Talent",
    });
    assert.equal(
      await database.query(
        `SELECT COUNT(*)::integer AS count FROM ${quotedSchema}.engineer_project`,
        { type: QueryTypes.SELECT, plain: true },
      ).then((row) => row.count),
      1,
    );
  });
}
