'use strict';
const table = (queryInterface) => ({ tableName: 'invites', schema: queryInterface.sequelize.options.schema || process.env.DB_SCHEMA || 'public' });
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const target = table(queryInterface);
      const columns = await queryInterface.describeTable(target, { transaction });
      if (!columns.token_hash) await queryInterface.addColumn(target, 'token_hash', { type: Sequelize.TEXT, allowNull: true }, { transaction });
      if (!columns.membership_role) await queryInterface.addColumn(target, 'membership_role', { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'member' }, { transaction });
      const quoted = queryInterface.queryGenerator.quoteTable(target);
      await queryInterface.sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS invites_token_hash_unique ON ${quoted} (token_hash) WHERE token_hash IS NOT NULL`, { transaction });
    });
  },
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const target = table(queryInterface);
      await queryInterface.removeColumn(target, 'token_hash', { transaction });
      await queryInterface.removeColumn(target, 'membership_role', { transaction });
    });
  },
};
