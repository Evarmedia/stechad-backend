'use strict';
const { ROLES } = require('../services/platformCatalog');
module.exports = {
  async up(q, S) {
    const schema = q.sequelize.options.schema || 'public';
    const table = (tableName) => ({ tableName, schema });
    const fk = (name, key) => ({ references: { model: table(name), key }, onDelete: 'CASCADE' });
    await q.sequelize.transaction(async (transaction) => {
      const names = new Set((await q.showAllTables({ schema, transaction })).map((item) => typeof item === 'string' ? item : item.tableName));
      const timestamps = { created_at: { type: S.DATE, allowNull: false, defaultValue: S.fn('NOW') }, updated_at: { type: S.DATE, allowNull: false, defaultValue: S.fn('NOW') } };
      const create = async (name, attrs) => { if (!names.has(name)) await q.createTable(table(name), { ...attrs, ...timestamps }, { transaction }); };
      await create('platform_roles', {
        role_id: { type: S.UUID, primaryKey: true, allowNull: false }, role_key: { type: S.STRING(60), allowNull: false, unique: true }, name: { type: S.STRING(100), allowNull: false },
      });
      await create('platform_role_grants', {
        grant_id: { type: S.UUID, primaryKey: true, allowNull: false },
        user_id: { type: S.UUID, allowNull: false, ...fk('users', 'user_id') },
        role_id: { type: S.UUID, allowNull: false, references: { model: table('platform_roles'), key: 'role_id' }, onDelete: 'RESTRICT' },
        status: { type: S.STRING(20), allowNull: false, defaultValue: 'active' },
        granted_by: { type: S.UUID, allowNull: true }, revoked_by: { type: S.UUID, allowNull: true }, revoked_at: { type: S.DATE, allowNull: true },
      });
      await create('platform_mfa_credentials', {
        credential_id: { type: S.UUID, primaryKey: true, allowNull: false }, user_id: { type: S.UUID, allowNull: false, unique: true, ...fk('users', 'user_id') },
        encrypted_secret: { type: S.TEXT, allowNull: true }, pending_encrypted_secret: { type: S.TEXT, allowNull: true },
        pending_expires_at: { type: S.DATE, allowNull: true }, pending_session_id: { type: S.UUID, allowNull: true }, pending_reason: { type: S.TEXT, allowNull: true },
        credential_version: { type: S.INTEGER, allowNull: false, defaultValue: 0 }, last_timestep: { type: S.BIGINT, allowNull: true },
        failed_attempts: { type: S.INTEGER, allowNull: false, defaultValue: 0 }, locked_until: { type: S.DATE, allowNull: true },
      });
      await create('platform_recovery_codes', {
        recovery_code_id: { type: S.UUID, primaryKey: true, allowNull: false }, user_id: { type: S.UUID, allowNull: false, ...fk('users', 'user_id') },
        credential_version: { type: S.INTEGER, allowNull: false }, code_hash: { type: S.STRING(64), allowNull: false, unique: true }, consumed_at: { type: S.DATE, allowNull: true },
      });
      await create('platform_session_assurances', {
        session_id: { type: S.UUID, primaryKey: true, allowNull: false, ...fk('auth_sessions', 'session_id') },
        user_id: { type: S.UUID, allowNull: false, ...fk('users', 'user_id') }, credential_version: { type: S.INTEGER, allowNull: false },
        verified_at: { type: S.DATE, allowNull: false }, expires_at: { type: S.DATE, allowNull: false },
      });
      const index = async (name, fields, indexName, options = {}) => {
        if (!(await q.showIndex(table(name), { transaction })).some((i) => i.name === indexName)) await q.addIndex(table(name), fields, { name: indexName, ...options, transaction });
      };
      await index('platform_role_grants', ['user_id', 'status'], 'platform_grants_user_status');
      await index('platform_role_grants', ['role_id', 'status'], 'platform_grants_role_status');
      await index('platform_role_grants', ['user_id', 'role_id'], 'platform_grants_active_unique', { unique: true, where: { status: 'active' } });
      await index('platform_recovery_codes', ['user_id', 'credential_version'], 'platform_recovery_user_version');
      await index('platform_session_assurances', ['user_id'], 'platform_assurance_user');
      await index('platform_session_assurances', ['expires_at'], 'platform_assurance_expiry');
      const quoted = q.queryGenerator.quoteTable(table('platform_roles'));
      for (const role of ROLES) await q.sequelize.query(`INSERT INTO ${quoted} (role_id, role_key, name, created_at, updated_at) VALUES (:id, :key, :name, NOW(), NOW()) ON CONFLICT (role_key) DO NOTHING`, { replacements: { id: role.role_id, key: role.role_key, name: role.name }, transaction });
    });
  },
  async down() { throw new Error('Platform grants and security history must be retained; use an additive forward migration'); },
};
