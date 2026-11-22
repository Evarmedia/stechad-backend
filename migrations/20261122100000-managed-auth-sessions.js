'use strict';
module.exports = {
  async up(q, S) {
    const schema = q.sequelize.options.schema || 'public';
    const table = tableName => ({ tableName, schema });
    await q.sequelize.transaction(async transaction => {
      const names = new Set((await q.showAllTables({ schema, transaction })).map(t => typeof t === 'string' ? t : t.tableName));
      for (const [name, attributes] of Object.entries(require('../services/authSessionSchema')(S, table))) {
        if (!names.has(name)) await q.createTable(table(name), attributes, { transaction });
        for (const [key, attribute] of Object.entries(attributes)) if (attribute.references) {
          const indexName = `${name}_${key}_idx`;
          if (!(await q.showIndex(table(name), { transaction })).some(i => i.name === indexName)) await q.addIndex(table(name), [key], { name: indexName, transaction });
        }
      }
      // ON CONFLICT retains the first activation: re-running never extends compatibility.
      await q.sequelize.query(`INSERT INTO "${schema}".auth_security_state (state_key, activated_at, legacy_until) VALUES ('sessions', NOW(), NOW() + INTERVAL '24 hours') ON CONFLICT (state_key) DO NOTHING`, { transaction });
    });
  },
  async down() { throw new Error('Session revocation and legacy activation must be retained; use an additive migration'); },
};
