const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');
const { PROFILE_FIELDS } = require('../services/tenancyInventory');
const { birthdayAttribute } = require('../utils/birthday');
const employment = {};
for (const field of PROFILE_FIELDS) {
  const attribute = User.rawAttributes[field];
  employment[field] = { type: attribute.type, allowNull: attribute.allowNull !== false };
  if (attribute.defaultValue !== undefined) employment[field].defaultValue = attribute.defaultValue;
}
module.exports = sequelize.define('HRProfile', {
  hr_profile_id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  organization_id: { type: DataTypes.UUID, allowNull: false },
  membership_id: { type: DataTypes.UUID, allowNull: false, unique: true },
  user_id: { type: DataTypes.UUID, allowNull: false },
  ...employment,
  date_of_birth: birthdayAttribute(DataTypes),
  archived_at: { type: DataTypes.DATE, allowNull: true },
}, { tableName: 'hr_profiles', createdAt: 'created_at', updatedAt: 'updated_at', indexes: [
  { unique: true, fields: ['organization_id', 'user_id'] },
  { unique: true, fields: ['organization_id', 'employee_id'] },
  { fields: ['organization_id', 'role_id'] },
  { fields: ['organization_id', 'department_id'] },
  { fields: ['organization_id', 'reports_to_user_id'] },
] });
