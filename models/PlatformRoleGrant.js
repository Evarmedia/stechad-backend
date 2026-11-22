const { DataTypes: D } = require('sequelize');
const sequelize = require('../config/database');
module.exports = sequelize.define('PlatformRoleGrant', {
  grant_id: { type: D.UUID, primaryKey: true, defaultValue: D.UUIDV4 },
  user_id: { type: D.UUID, allowNull: false, references: { model: 'users', key: 'user_id' }, onDelete: 'CASCADE' },
  role_id: { type: D.UUID, allowNull: false, references: { model: 'platform_roles', key: 'role_id' }, onDelete: 'RESTRICT' },
  status: { type: D.STRING(20), allowNull: false, defaultValue: 'active', validate: { isIn: [['active', 'revoked']] } },
  granted_by: { type: D.UUID, allowNull: true },
  revoked_by: { type: D.UUID, allowNull: true },
  revoked_at: { type: D.DATE, allowNull: true },
}, { tableName: 'platform_role_grants', createdAt: 'created_at', updatedAt: 'updated_at', indexes: [{ fields: ['user_id', 'status'] }, { fields: ['role_id', 'status'] }, { unique: true, fields: ['user_id', 'role_id'], where: { status: 'active' } } ] });
