const { AsyncLocalStorage } = require('node:async_hooks');
const { PROFILE_FIELDS } = require('./tenancyInventory');
const storage = new AsyncLocalStorage();
const error = (message, status = 403) => Object.assign(new Error(message), { status });
const isUUID = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function peekTenantContext() { return storage.getStore(); }
function runWithoutTenant(callback) { return storage.run(undefined, callback); }
function getTenantContext() {
  const context = storage.getStore();
  if (!context?.organizationId) throw error('Organization context is required');
  return context;
}
function runWithTenant(context, callback) {
  if (!isUUID(context?.organizationId) || !isUUID(context?.userId) || !isUUID(context?.membershipId)) throw error('Validated organization membership context is required');
  return storage.run(Object.freeze({ ...context }), callback);
}
async function resolveTenantContext({ userId, organizationId, transaction } = {}) {
  if (!isUUID(userId)) throw error('Authenticated identity is required', 401);
  if (organizationId !== undefined && !isUUID(organizationId)) throw error('Invalid organization identifier', 400);
  const { User, Organization, OrganizationMembership, HRProfile, Role } = require('../models');
  const identity = await User.unscoped().findByPk(userId, { attributes: ['user_id', 'is_active', 'deleted_at'], paranoid: false, transaction });
  if (!identity || !identity.is_active || identity.deleted_at) throw error('Account is unavailable', 401);
  const memberships = await OrganizationMembership.findAll({
    where: { user_id: userId, status: 'active', ...(organizationId ? { organization_id: organizationId } : {}) },
    include: [{ model: Organization, as: 'organization', where: { status: 'active' }, required: true }], transaction,
  });
  if (!memberships.length) throw error('No active membership for this organization');
  if (!organizationId && memberships.length !== 1) throw Object.assign(error('Select an organization explicitly', 409), { code: 'ORGANIZATION_REQUIRED' });
  const membership = memberships[0];
  const profile = await HRProfile.findOne({ where: { membership_id: membership.membership_id, organization_id: membership.organization_id, user_id: userId }, transaction });
  if (!profile || profile.deleted_at || profile.archived_at) throw error('HR access is unavailable');
  const role = await Role.findOne({ where: { role_id: profile.role_id, organization_id: membership.organization_id }, transaction });
  if (!role) throw error('HR role does not belong to this organization');
  return Object.freeze({ organizationId: membership.organization_id, membershipId: membership.membership_id, userId, membershipRole: membership.membership_role, roleId: profile.role_id, hrProfile: profile, role, organization: membership.organization });
}
async function revalidateTenantContext(context = getTenantContext(), options = {}) {
  const latest = await resolveTenantContext({ userId: context.userId, organizationId: context.organizationId, transaction: options.transaction });
  if (latest.membershipId !== context.membershipId) throw error('Organization membership changed');
  return latest;
}
// A plain identity view for compatibility serializers. Credentials remain on User;
// callers must route employment writes to HRProfile, never save this projection.
function getHRIdentity(user, context = getTenantContext()) {
  const identity = typeof user.get === 'function' ? user.get({ plain: true }) : { ...user };
  const profile = typeof context.hrProfile.get === 'function' ? context.hrProfile.get({ plain: true }) : context.hrProfile;
  for (const field of PROFILE_FIELDS) identity[field] = profile[field];
  identity.organization_id = context.organizationId;
  identity.membership_id = context.membershipId;
  identity.role = typeof context.role.get === 'function' ? context.role.get({ plain: true }) : context.role;
  delete identity.password; delete identity.reset_password_token; delete identity.reset_password_expires;
  return identity;
}
module.exports = { peekTenantContext, runWithoutTenant, getTenantContext, runWithTenant, resolveTenantContext, revalidateTenantContext, getHRIdentity, isUUID };
