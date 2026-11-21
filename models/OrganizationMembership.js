const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
module.exports = sequelize.define('OrganizationMembership', {
  membership_id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  organization_id: { type: DataTypes.UUID, allowNull: false },
  user_id: { type: DataTypes.UUID, allowNull: false },
  membership_role: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'member', validate: { isIn: [['owner', 'admin', 'member']] } },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active', validate: { isIn: [['active', 'suspended', 'removed']] } },
}, { tableName: 'organization_memberships', createdAt: 'created_at', updatedAt: 'updated_at', indexes: [
  { unique: true, fields: ['organization_id', 'user_id'] },
  { unique: true, fields: ['organization_id', 'membership_id', 'user_id'] },
  { fields: ['user_id', 'status'] },
] });
