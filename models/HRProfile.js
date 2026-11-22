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
const HRProfile = sequelize.define('HRProfile', {
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

// Role transitions belong to employment, including invitation restores and
// organization-management writes that intentionally bypass the HR facade.
HRProfile.beforeSave(async (profile, options) => {
  if (!profile.isNewRecord && !['role_id', 'auto_clock_out_enabled', 'auto_clock_out_time'].some((field) => profile.changed(field))) return;
  const role = await require('./Role').findOne({ where: { role_id: profile.role_id, organization_id: profile.organization_id }, transaction: options.transaction });
  if (['admin', 'super_admin'].includes(role?.role_key)) { profile.auto_clock_out_enabled = false; profile.auto_clock_out_time = null; }
});
HRProfile.afterUpdate(async (profile, options) => {
  if (!profile.changed('role_id')) return;
  const role = await require('./Role').findOne({ where: { role_id: profile.role_id, organization_id: profile.organization_id }, transaction: options.transaction });
  if (!['admin', 'super_admin'].includes(role?.role_key)) return;
  const Attendance = require('./Attendance');
  const entries = await Attendance.findAll({ where: { organization_id: profile.organization_id, user_id: profile.user_id, clock_out: null }, transaction: options.transaction, ...(options.transaction ? { lock: options.transaction.LOCK.UPDATE } : {}) });
  for (const entry of entries) await entry.update({ auto_clock_out_at: null, ...(!['absent', 'cancelled'].includes(entry.status) ? { status: 'cancelled', clock_out_source: null } : {}) }, { transaction: options.transaction });
});
module.exports = HRProfile;
