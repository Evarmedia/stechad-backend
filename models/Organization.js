const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
module.exports = sequelize.define('Organization', {
  organization_id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  slug: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  name: { type: DataTypes.STRING(200), allowNull: false },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active', validate: { isIn: [['active', 'suspended', 'archived']] } },
  settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, { tableName: 'organizations', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });
