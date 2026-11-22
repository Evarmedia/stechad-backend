const { Op, fn, col, literal } = require('sequelize');
const sequelize = require('../config/database');
const { User, Organization, OrganizationMembership, PlatformRole, PlatformRoleGrant, IdentityAuditLog } = require('../models');
const { PERMISSIONS, ROLES } = require('./platformCatalog');
const { fail, reason, serialize, requireAccess, authority, audit, assertSuperAdminSurvives } = require('./platformAuthorization');
const { requireAssurance } = require('./platformMfa');
const userFields = ['user_id', 'email', 'first_name', 'last_name', 'is_active', 'is_verified', 'created_at'];
const orgFields = ['organization_id', 'slug', 'name', 'status', 'created_at'];
const pick = (object, fields) => Object.fromEntries(fields.map((field) => [field, object[field]]));
function pagination(query) {
  const page = query.page === undefined ? 1 : Number(query.page); const limit = query.limit === undefined ? 25 : Number(query.limit);
  if (!Number.isInteger(page) || page < 1 || page > 1000000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw fail(400, 'INVALID_PAGINATION');
  return { page, limit, offset: (page - 1) * limit };
}
const pageResult = (count, paging) => ({ page: paging.page, limit: paging.limit, total: count, total_pages: Math.ceil(count / paging.limit) });
function search(query, fields) {
  if (!query.search) return {};
  if (typeof query.search !== 'string' || query.search.length > 200) throw fail(400, 'INVALID_SEARCH');
  return { [Op.or]: fields.map((field) => ({ [field]: { [Op.iLike]: `%${query.search}%` } })) };
}
function uuid(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw fail(400, 'INVALID_IDENTIFIER');
  return value;
}
async function organizationDtos(rows, transaction) {
  const counts = rows.length ? await OrganizationMembership.findAll({ where: { organization_id: { [Op.in]: rows.map((org) => org.organization_id) }, status: 'active' }, attributes: ['organization_id', [fn('COUNT', col('membership_id')), 'active_member_count'], [fn('SUM', literal("CASE WHEN membership_role = 'owner' THEN 1 ELSE 0 END")), 'owner_count']], group: ['organization_id'], raw: true, transaction }) : [];
  return rows.map((org) => { const count = counts.find((entry) => entry.organization_id === org.organization_id); return { ...pick(org, orgFields), active_member_count: Number(count?.active_member_count || 0), owner_count: Number(count?.owner_count || 0) }; });
}
async function organizations(query) {
  const paging = pagination(query); const where = search(query, ['name', 'slug']);
  if (query.status) { if (!['active', 'suspended', 'archived'].includes(query.status)) throw fail(400, 'INVALID_STATUS'); where.status = query.status; }
  const { count, rows } = await Organization.findAndCountAll({ where, attributes: orgFields, limit: paging.limit, offset: paging.offset, order: [['created_at', 'DESC'], ['organization_id', 'ASC']] });
  return { organizations: await organizationDtos(rows), pagination: pageResult(count, paging) };
}
async function users(query) {
  const paging = pagination(query); const where = search(query, ['email', 'first_name', 'last_name']);
  if (query.status) { if (!['active', 'suspended'].includes(query.status)) throw fail(400, 'INVALID_STATUS'); where.is_active = query.status === 'active'; }
  const { count, rows } = await User.unscoped().findAndCountAll({ where, attributes: userFields, limit: paging.limit, offset: paging.offset, order: [['created_at', 'DESC'], ['user_id', 'ASC']] });
  return { users: rows.map((user) => pick(user, userFields)), pagination: pageResult(count, paging) };
}
async function mutate(req, permission, operation) {
  return sequelize.transaction(async (transaction) => {
    await serialize(transaction); await requireAccess(req, permission, transaction); await requireAssurance(req, transaction);
    return operation(transaction);
  });
}
async function updateOrganization(req) {
  const id = uuid(req.params.organizationId); const why = reason(req.body.reason);
  if (!['active', 'suspended'].includes(req.body.status)) throw fail(400, 'INVALID_STATUS');
  return mutate(req, 'platform.organizations.manage', async (transaction) => {
    const organization = await Organization.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!organization) throw fail(404, 'ORGANIZATION_NOT_FOUND');
    const before = organization.status; await organization.update({ status: req.body.status }, { transaction });
    await audit(req.identity, 'platform.organization.status_changed', 'Organization', id, { previous_status: before, status: organization.status, reason: why }, transaction);
    if (organization.status === 'suspended') require('../utils/events').afterCommit(transaction, async () => {
      const memberships = await OrganizationMembership.findAll({ where: { organization_id: id }, attributes: ['user_id'] });
      for (const member of memberships) await require('../utils/events').disconnectMembership(member.user_id, id);
    });
    return { organization: (await organizationDtos([organization], transaction))[0] };
  });
}
async function updateUser(req) {
  const id = uuid(req.params.userId); const why = reason(req.body.reason);
  if (typeof req.body.is_active !== 'boolean') throw fail(400, 'INVALID_STATUS');
  return mutate(req, 'platform.users.manage', async (transaction) => {
    const user = await User.unscoped().findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!user) throw fail(404, 'USER_NOT_FOUND');
    const target = await authority(id, { transaction });
    if (target.roles.length && !req.platform.permissions.includes('platform.grants.manage')) throw fail(403, 'PRIVILEGED_TARGET_PROTECTED');
    if (!req.body.is_active) {
      if (id === req.identity.user_id) throw fail(409, 'SELF_LOCKOUT_PROTECTED');
      if (target.roles.some((role) => role.role_key === 'platform_super_admin')) await assertSuperAdminSurvives({ excludingUserId: id, transaction });
    }
    const previous = user.is_active; await user.update({ is_active: req.body.is_active }, { transaction });
    if (!user.is_active) await require('./authSessions').revokeAllSessions(id, { actor: req.identity, reason: 'platform_suspension', transaction });
    await audit(req.identity, 'platform.user.status_changed', 'GlobalUser', id, { previous_is_active: previous, is_active: user.is_active, reason: why }, transaction);
    return { user: pick(user, userFields) };
  });
}
async function roleCatalog() {
  const roles = await PlatformRole.findAll({ where: { role_key: { [Op.in]: ROLES.map((r) => r.role_key) } }, order: [['role_key', 'ASC']] });
  return { roles: roles.map((role) => ({ role_id: role.role_id, role_key: role.role_key, name: ROLES.find((r) => r.role_key === role.role_key).name, permission_keys: [...ROLES.find((r) => r.role_key === role.role_key).permission_keys] })), permissions: [...PERMISSIONS] };
}
async function grantDtos(rows, transaction) {
  const roles = rows.length ? await PlatformRole.findAll({ where: { role_id: { [Op.in]: rows.map((g) => g.role_id) } }, transaction }) : [];
  const users = rows.length ? await User.unscoped().findAll({ where: { user_id: { [Op.in]: rows.map((g) => g.user_id) } }, attributes: ['user_id', 'email'], transaction, paranoid: false }) : [];
  return rows.map((grant) => ({ ...pick(grant, ['grant_id', 'user_id', 'role_id', 'status', 'created_at', 'granted_by']), role_key: roles.find((r) => r.role_id === grant.role_id)?.role_key || null, email: users.find((u) => u.user_id === grant.user_id)?.email || null }));
}
async function grants(query) {
  const paging = pagination(query); const where = query.user_id ? { user_id: uuid(query.user_id) } : {};
  const { count, rows } = await PlatformRoleGrant.findAndCountAll({ where, limit: paging.limit, offset: paging.offset, order: [['created_at', 'DESC'], ['grant_id', 'ASC']] });
  return { grants: await grantDtos(rows), pagination: pageResult(count, paging) };
}
async function grantRole(req) {
  const userId = uuid(req.body.user_id); const roleId = uuid(req.body.role_id); const why = reason(req.body.reason);
  return mutate(req, 'platform.grants.manage', async (transaction) => {
    const user = await User.unscoped().findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!user?.is_active || !user.is_verified) throw fail(400, 'GRANT_TARGET_UNAVAILABLE');
    const role = await PlatformRole.findByPk(roleId, { transaction });
    if (!role || !ROLES.some((entry) => entry.role_key === role.role_key)) throw fail(400, 'INVALID_PLATFORM_ROLE');
    if (await PlatformRoleGrant.findOne({ where: { user_id: userId, role_id: roleId, status: 'active' }, transaction })) throw fail(409, 'PLATFORM_GRANT_EXISTS');
    const grant = await PlatformRoleGrant.create({ user_id: userId, role_id: roleId, granted_by: req.identity.user_id }, { transaction });
    await audit(req.identity, 'platform.grant.created', 'PlatformGrant', grant.grant_id, { user_id: userId, role_key: role.role_key, reason: why }, transaction);
    return { grant: (await grantDtos([grant], transaction))[0] };
  });
}
async function revokeGrant(req) {
  const id = uuid(req.params.grantId); const why = reason(req.body.reason);
  return mutate(req, 'platform.grants.manage', async (transaction) => {
    const grant = await PlatformRoleGrant.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!grant) throw fail(404, 'PLATFORM_GRANT_NOT_FOUND');
    if (grant.user_id === req.identity.user_id) throw fail(409, 'SELF_LOCKOUT_PROTECTED');
    const role = await PlatformRole.findByPk(grant.role_id, { transaction });
    if (grant.status === 'active' && role?.role_key === 'platform_super_admin') await assertSuperAdminSurvives({ excludingGrantId: id, transaction });
    await grant.update({ status: 'revoked', revoked_by: req.identity.user_id, revoked_at: new Date() }, { transaction });
    await audit(req.identity, 'platform.grant.revoked', 'PlatformGrant', id, { user_id: grant.user_id, role_key: role.role_key, reason: why }, transaction);
    return { grant: (await grantDtos([grant], transaction))[0] };
  });
}
async function audits(query) {
  const paging = pagination(query); const where = { action: { [Op.like]: 'platform.%' } };
  if (query.action) { if (typeof query.action !== 'string' || !/^platform\.[a-z_.]{1,100}$/.test(query.action)) throw fail(400, 'INVALID_AUDIT_ACTION'); where.action = query.action; }
  const fields = ['audit_log_id', 'actor_user_id', 'actor_name', 'action', 'target_type', 'target_id', 'outcome', 'occurred_at'];
  const safeChanges = ['reason', 'user_id', 'role_key', 'status', 'previous_status', 'is_active', 'previous_is_active', 'replacement', 'method', 'code'];
  const { count, rows } = await IdentityAuditLog.findAndCountAll({ where, limit: paging.limit, offset: paging.offset, order: [['occurred_at', 'DESC'], ['audit_log_id', 'ASC']] });
  return { entries: rows.map((row) => ({ ...pick(row, fields), changes: Object.fromEntries(safeChanges.filter((field) => Object.hasOwn(row.changes || {}, field)).map((field) => [field, row.changes[field]])) })), pagination: pageResult(count, paging) };
}
module.exports = { organizations, users, updateOrganization, updateUser, roleCatalog, grants, grantRole, revokeGrant, audits };
