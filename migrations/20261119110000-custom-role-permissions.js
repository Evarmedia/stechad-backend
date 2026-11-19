"use strict";
module.exports = {
  async up(q, Sequelize) {
    const schema = q.sequelize.options.schema || process.env.DB_SCHEMA || "public";
    const table = { tableName: "roles", schema };
    await q.sequelize.transaction(async (transaction) => {
      const columns = await q.describeTable(table, { transaction });
      if (!columns.permission_keys) await q.addColumn(table, "permission_keys", { type: Sequelize.JSONB, allowNull: false, defaultValue: [] }, { transaction });
      const quoted = q.queryGenerator.quoteTable(table);
      await q.sequelize.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_permission_keys_array' AND conrelid = '${quoted.replaceAll("'", "''")}'::regclass) THEN ALTER TABLE ${quoted} ADD CONSTRAINT roles_permission_keys_array CHECK (jsonb_typeof(permission_keys) = 'array'); END IF; END $$`, { transaction });
    });
  },
  async down(q) {
    const table = { tableName: "roles", schema: q.sequelize.options.schema || process.env.DB_SCHEMA || "public" };
    await q.sequelize.transaction(async (transaction) => {
      const columns = await q.describeTable(table, { transaction });
      if (columns.permission_keys) await q.removeColumn(table, "permission_keys", { transaction });
    });
  },
};
