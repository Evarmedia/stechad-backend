'use strict';
module.exports = {
  async up(q, S) {
    const schema = q.sequelize.options.schema || 'public';
    const table = (tableName) => ({ tableName, schema });
    await q.sequelize.transaction(async (transaction) => {
      const names = new Set((await q.showAllTables({ schema, transaction })).map((item) => typeof item === 'string' ? item : item.tableName));
      if (!names.has('identity_audit_logs')) await q.createTable(table('identity_audit_logs'), {
        audit_log_id: { type: S.UUID, primaryKey: true, allowNull: false }, actor_user_id: { type: S.UUID, allowNull: true }, actor_name: { type: S.TEXT, allowNull: true },
        action: { type: S.TEXT, allowNull: false }, target_type: { type: S.TEXT, allowNull: false }, target_id: { type: S.TEXT, allowNull: true },
        outcome: { type: S.TEXT, allowNull: false, defaultValue: 'success' }, changes: { type: S.JSONB, allowNull: false, defaultValue: {} }, occurred_at: { type: S.DATE, allowNull: false, defaultValue: S.fn('NOW') },
      }, { transaction });
      if (!names.has('stored_files')) await q.createTable(table('stored_files'), {
        file_id: { type: S.UUID, primaryKey: true, allowNull: false }, organization_id: { type: S.UUID, allowNull: false }, owner_user_id: { type: S.UUID, allowNull: false },
        object_name: { type: S.TEXT, allowNull: false, unique: true }, purpose: { type: S.STRING(50), allowNull: false }, created_at: { type: S.DATE, allowNull: false, defaultValue: S.fn('NOW') },
      }, { transaction });
      const ensure = async (name, fields, indexName) => { if (!(await q.showIndex(table(name), { transaction })).some((index) => index.name === indexName)) await q.addIndex(table(name), fields, { name: indexName, transaction }); };
      await ensure('identity_audit_logs', ['actor_user_id', 'occurred_at'], 'identity_audit_actor_time');
      await ensure('stored_files', ['organization_id', 'owner_user_id'], 'stored_files_org_owner');
    });
  },
  async down() { throw new Error('File ownership and identity audit history must be retained; use an additive forward migration'); },
};
