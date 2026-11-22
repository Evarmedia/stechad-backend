const { Op } = require('sequelize');
const { User, PlatformRole, PlatformRoleGrant, IdentityAuditLog } = require('../models');
const sequelize = require('../config/database');
const { ROLES } = require('./platformCatalog');
function fail(status, code, message = code) { return Object.assign(new Error(message), { status, code }); }
async function serialize(transaction) {
  await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:scope))', { replacements: { scope: `${sequelize.options.schema || 'public'}:platform-authority` }, transaction });
}
async function authority(userId, { transaction } = {}) {
  const grants = await PlatformRoleGrant.findAll({ where: { user_id: userId, status: 'active' }, transaction });
  const roles = grants.length ? await PlatformRole.findAll({ where: { role_id: { [Op.in]: grants.map((g) => g.role_id) } }, transaction }) : [];
  const supported = roles.map((role) => { const catalog = ROLES.find((entry) => entry.role_key === role.role_key); return catalog ? { role_id: role.role_id, role_key: role.role_key, name: catalog.name, permission_keys: [...catalog.permission_keys] } : null; }).filter(Boolean);
  return { roles: supported, permissions: [...new Set(supported.flatMap((role) => role.permission_keys))] };
}
async function audit(actor, action, targetType, targetId, changes = {}, transaction, outcome = 'success') {
  return IdentityAuditLog.create({ actor_user_id: actor?.user_id || null, actor_name: actor?.email || null, action, target_type: targetType, target_id: targetId || null, changes, outcome }, { transaction });
}
function reason(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 1000) throw fail(400, 'AUDIT_REASON_REQUIRED', 'A reason of 1–1000 characters is required');
  return value.trim();
}
async function requireAccess(req, permission, transaction) {
  if (!req.authSession || req.legacySession) throw fail(403, 'SESSION_UPGRADE_REQUIRED');
  const identity = transaction ? await User.unscoped().findByPk(req.identity.user_id, { transaction }) : req.identity;
  if (!identity?.is_active || identity.deleted_at) throw fail(401, 'IDENTITY_INACTIVE');
  if (!identity.is_verified) throw fail(403, 'EMAIL_VERIFICATION_REQUIRED');
  const access = await authority(identity.user_id, { transaction });
  if (!access.roles.length || (permission && !access.permissions.includes(permission))) throw fail(403, 'PLATFORM_ACCESS_DENIED');
  req.platform = access;
  return access;
}
async function assertSuperAdminSurvives({ excludingUserId, excludingGrantId, transaction }) {
  const role = await PlatformRole.findOne({ where: { role_key: 'platform_super_admin' }, transaction });
  const grants = role ? await PlatformRoleGrant.findAll({ where: { role_id: role.role_id, status: 'active', ...(excludingGrantId ? { grant_id: { [Op.ne]: excludingGrantId } } : {}), ...(excludingUserId ? { user_id: { [Op.ne]: excludingUserId } } : {}) }, transaction }) : [];
  const users = grants.length ? await User.unscoped().count({ where: { user_id: { [Op.in]: grants.map((g) => g.user_id) }, is_active: true, is_verified: true }, transaction }) : 0;
  if (!users) throw fail(409, 'LAST_PLATFORM_SUPER_ADMIN');
}
module.exports = { fail, serialize, authority, audit, reason, requireAccess, assertSuperAdminSurvives };
