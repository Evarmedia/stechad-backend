// Explicit identity/bootstrap path. Normal HR writes use tenantRepository.
const { STECHAD_ORGANIZATION_ID, PROFILE_FIELDS } = require('./tenancyInventory');
async function ensureStechadMembership(user, { transaction } = {}) {
  const { Organization, OrganizationMembership, HRProfile, Role } = require('../models');
  const sequelize = Organization.sequelize;
  const schema = sequelize.schema || sequelize.options.schema || 'public';
  if (!await sequelize.getQueryInterface().tableExists({ schema, tableName: 'tenancy_migration_state' }, { transaction })) return null;
  const organization = await Organization.findByPk(STECHAD_ORGANIZATION_ID, { transaction });
  if (!organization || organization.status !== 'active') throw new Error('Stechad organization is unavailable');
  const role = await Role.findOne({ where: { role_id: user.role_id, organization_id: organization.organization_id }, transaction });
  if (!role) throw new Error('Bootstrap role must belong to stechad');
  const [membership] = await OrganizationMembership.findOrCreate({
    where: { organization_id: organization.organization_id, user_id: user.user_id },
    defaults: { membership_role: role.role_key === 'super_admin' ? 'owner' : role.role_key === 'admin' ? 'admin' : 'member', status: user.deleted_at ? 'removed' : user.is_active === false ? 'suspended' : 'active' }, transaction,
  });
  const fields = Object.fromEntries(PROFILE_FIELDS.map((field) => [field, user.get(field)]));
  await HRProfile.findOrCreate({ where: { organization_id: organization.organization_id, user_id: user.user_id }, defaults: { ...fields, membership_id: membership.membership_id }, transaction });
  return membership;
}
module.exports = { ensureStechadMembership };
