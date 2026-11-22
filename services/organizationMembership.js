const { Organization, OrganizationMembership, HRProfile, Role } = require('../models');
const sequelize = require('../config/database');
const { isUUID, resolveTenantContext, runWithTenant, runWithoutTenant, getHRIdentity } = require('./tenantContext');
const fail = (message, status = 403, code) => Object.assign(new Error(message), { status, code });
const uuid = (id) => { if (!isUUID(id)) throw fail('Invalid organization identifier', 400); };
async function listOrganizations(userId, transaction) {
  const rows = await OrganizationMembership.findAll({ where: { user_id: userId, status: 'active' }, include: [{ model: Organization, as: 'organization', where: { status: 'active' } }], order: [['created_at', 'ASC']], transaction });
  return rows.map((m) => ({ organization_id: m.organization_id, name: m.organization.name, slug: m.organization.slug, status: m.organization.status, membership_id: m.membership_id, membership_role: m.membership_role, membership_status: m.status }));
}
async function requireMembership(userId, organizationId, { transaction, manage = false } = {}) {
  uuid(organizationId);
  const membership = await OrganizationMembership.findOne({ where: { user_id: userId, organization_id: organizationId, status: 'active' }, include: [{ model: Organization, as: 'organization', where: { status: 'active' } }], transaction });
  if (!membership) throw fail('Organization membership is unavailable', 403, 'MEMBERSHIP_UNAVAILABLE');
  if (manage && !['owner', 'admin'].includes(membership.membership_role)) throw fail('Organization administrator access is required');
  return membership;
}
async function sessionView(user, organizationId) {
  return runWithoutTenant(async () => {
    const organizations = await listOrganizations(user.user_id);
    // Preserve pre-cutover fixtures only. The server composition always enables
    // enforcement; any recorded membership also disables this legacy path.
    if (process.env.TENANCY_ENFORCED !== 'true' && organizationId === undefined && !await OrganizationMembership.count({ where: { user_id: user.user_id } })) {
      const legacy = await require('../models').User.findByPk(user.user_id);
      return { user: await require('../controllers/authController').formatUserResponse(legacy), organizations: [], active_organization_id: null };
    }
    if (organizationId !== undefined) uuid(organizationId);
    const selected = organizationId || (organizations.length === 1 ? organizations[0].organization_id : null);
    const data = user.get ? user.get({ plain: true }) : { ...user };
    const { PROFILE_FIELDS } = require('./tenancyInventory');
    for (const field of PROFILE_FIELDS) delete data[field];
    delete data.password; delete data.reset_password_token; delete data.reset_password_expires;
    data.role = null; data.role_details = null; data.effective_permissions = []; data.has_password = Boolean(user.password);
    let active = null;
    if (selected && organizations.some((org) => org.organization_id === selected)) {
      active = selected;
      try {
        const context = await resolveTenantContext({ userId: user.user_id, organizationId: selected });
        const hr = getHRIdentity(user, context);
        const { Talent, ProjectManager, Admin } = require('../models');
        for (const [Model, key] of [[Talent, 'talent'], [ProjectManager, 'project_manager'], [Admin, 'admin']]) {
          const row = await Model.findOne({ where: { organization_id: selected, user_id: user.user_id } });
          if (row) hr[key] = row;
        }
        Object.assign(data, await runWithTenant(context, () => require('../controllers/authController').formatUserResponse(hr)));
      } catch (error) { if (error.status !== 403) throw error; }
    }
    return { user: data, organizations, active_organization_id: active };
  });
}
async function createOrganization(actor, input) {
  if (process.env.ENABLE_ORGANIZATION_CREATION !== 'true') throw fail('Organization creation is disabled', 403, 'ORGANIZATION_CREATION_DISABLED');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const slug = typeof input.slug === 'string' ? input.slug.trim().toLowerCase() : '';
  if (!name || name.length > 200 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100) throw fail('A valid organization name and slug are required', 400);
  return sequelize.transaction(async (transaction) => {
    const organization = await Organization.create({ name, slug }, { transaction });
    const membership = await OrganizationMembership.create({ organization_id: organization.organization_id, user_id: actor.user_id, membership_role: 'owner' }, { transaction });
    const role = await Role.create({ organization_id: organization.organization_id, role_key: 'staff', name: 'Staff', is_system: true, permission_keys: [] }, { transaction });
    await HRProfile.create({ organization_id: organization.organization_id, membership_id: membership.membership_id, user_id: actor.user_id, role_id: role.role_id }, { transaction });
    await audit(actor, organization.organization_id, 'organization.created', organization.organization_id, { hr_role_id: role.role_id }, transaction);
    return { organization, membership };
  });
}
async function audit(actor, organizationId, action, targetId, changes, transaction) {
  await require('../models/AuditLog').create({ organization_id: organizationId, actor_user_id: actor.user_id, actor_name: actor.email, action, target_type: 'OrganizationMembership', target_id: targetId, changes }, { transaction });
}
async function changeMembership({ actor, organizationId, membershipId, updates, transaction, leave = false, authority }) {
  uuid(organizationId); if (!isUUID(membershipId)) throw fail('Invalid membership identifier', 400);
  const work = async (tx) => {
    const org = await Organization.findByPk(organizationId, { transaction: tx, lock: tx.LOCK.UPDATE });
    if (!org || org.status !== 'active') throw fail('Organization is unavailable', 403, 'MEMBERSHIP_UNAVAILABLE');
    const acting = await requireMembership(actor.user_id, organizationId, { transaction: tx, manage: !leave && authority !== 'hr' });
    if (authority === 'hr') {
      const context = await resolveTenantContext({ userId: actor.user_id, organizationId, transaction: tx });
      if (!await runWithTenant(context, () => require('../utils/permissions').hasPermission(getHRIdentity(actor, context), 'manage_staff'))) throw fail('HR staff management permission is required');
    }
    const target = await OrganizationMembership.findOne({ where: { organization_id: organizationId, membership_id: membershipId }, transaction: tx, lock: tx.LOCK.UPDATE });
    if (!target) throw fail('Membership not found', 404);
    if (leave && target.user_id !== actor.user_id) throw fail('Only your own membership can be left');
    if (!leave && authority !== 'hr' && acting.membership_role !== 'owner' && (target.membership_role === 'owner' || updates.membership_role === 'owner')) throw fail('Only owners can change organization owners');
    if (authority === "hr" && updates.membership_role !== undefined) throw fail("HR permissions cannot change organization management roles");
    const values = {};
    if (updates.status !== undefined) { if (!['active', 'suspended', 'removed'].includes(updates.status)) throw fail('Invalid membership status', 400); values.status = updates.status; }
    if (updates.membership_role !== undefined) { if (!['owner', 'admin', 'member'].includes(updates.membership_role)) throw fail('Invalid membership role', 400); values.membership_role = updates.membership_role; }
    if (!Object.keys(values).length) throw fail('A membership change is required', 400);
    if (target.membership_role === 'owner' && target.status === 'active' && ((values.status && values.status !== 'active') || (values.membership_role && values.membership_role !== 'owner'))) {
      const owners = await OrganizationMembership.count({ where: { organization_id: organizationId, status: 'active', membership_role: 'owner' }, transaction: tx });
      if (owners <= 1) throw fail('The last active owner cannot be removed or demoted', 409, 'LAST_OWNER_REQUIRED');
    }
    await target.update(values, { transaction: tx });
    await audit(actor, organizationId, leave ? 'membership.left' : 'membership.updated', target.membership_id, values, tx);
    if (values.status && values.status !== 'active') tx.afterCommit(() => require('../utils/events').disconnectMembership?.(target.user_id, organizationId));
    return target;
  };
  return transaction ? work(transaction) : sequelize.transaction(work);
}
module.exports = { fail, uuid, listOrganizations, requireMembership, sessionView, createOrganization, changeMembership, audit };
