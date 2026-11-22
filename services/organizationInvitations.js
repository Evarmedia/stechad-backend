const { randomBytes, createHash } = require('node:crypto');
const { Op } = require('sequelize');
const { Invite, User, Role, Organization, OrganizationMembership, HRProfile, Department, Talent, ProjectManager, Admin } = require('../models');
const sequelize = require('../config/database');
const { normalizeEmail, emailWhere } = require('../utils/email');
const { fail, uuid, requireMembership, audit } = require('./organizationMembership');
const { runWithoutTenant, resolveTenantContext, runWithTenant, getHRIdentity, isUUID } = require('./tenantContext');
const hash = (token) => createHash('sha256').update(token).digest('hex');
async function createInvitation({ actor, organizationId, input, transaction, authority }) {
  uuid(organizationId);
  const email = normalizeEmail(input.email);
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('A valid email is required', 400);
  const work = async (tx) => runWithoutTenant(async () => {
    await Organization.findByPk(organizationId, { transaction: tx, lock: tx.LOCK.UPDATE });
    const acting = await requireMembership(actor.user_id, organizationId, { transaction: tx, manage: authority !== 'hr' });
    if (authority === 'hr') {
      const context = await resolveTenantContext({ userId: actor.user_id, organizationId, transaction: tx });
      if (!await runWithTenant(context, () => require('../utils/permissions').hasPermission(getHRIdentity(actor, context), 'manage_staff'))) throw fail('HR staff management permission is required');
    }
    const membershipRole = input.membership_role || 'member';
    if (!['owner', 'admin', 'member'].includes(membershipRole)) throw fail('Invalid membership role', 400);
    if (membershipRole !== 'member' && (authority === 'hr' || acting.membership_role !== 'owner')) throw fail('Only organization owners can invite administrators or owners');
    const identifier = input.role_id || input.role || 'staff';
    const role = await Role.findOne({ where: { organization_id: organizationId, ...(isUUID(identifier) ? { role_id: identifier } : { role_key: identifier }) }, transaction: tx });
    if (!role || role.role_key === 'super_admin') throw fail('A valid non-super-admin HR role in this organization is required', 400);
    if (input.department_id && !isUUID(input.department_id)) throw fail('Invalid department identifier', 400);
    if (input.department_id && !await Department.findOne({ where: { organization_id: organizationId, department_id: input.department_id }, transaction: tx })) throw fail('Department not found', 404);
    const existing = await User.unscoped().findOne({ where: emailWhere(email), paranoid: false, transaction: tx });
    if (existing && (!existing.is_active || existing.deleted_at)) throw fail('Account is unavailable', 403);
    if (existing && await OrganizationMembership.findOne({ where: { organization_id: organizationId, user_id: existing.user_id, status: 'active' }, transaction: tx })) throw fail('This user is already an active member', 409);
    const pending = await Invite.unscoped().findAll({ where: emailWhere(email, 'Invite', { organization_id: organizationId, status: 'pending' }), transaction: tx });
    for (const invitation of pending) {
      if (invitation.expires_at && invitation.expires_at > new Date()) throw fail('An active invitation already exists', 409);
      await invitation.update({ status: 'expired', token: null, token_hash: null }, { transaction: tx });
    }
    const token = randomBytes(32).toString('hex');
    const invitation = await Invite.unscoped().create({ organization_id: organizationId, email, role_id: role.role_id, membership_role: membershipRole, first_name: input.first_name, last_name: input.last_name, department_id: input.department_id || null, job_title: input.job_title || null, employee_id: input.employee_id || `ST-${randomBytes(6).toString('hex')}`, token: null, token_hash: hash(token), sent_at: new Date(), expires_at: new Date(Date.now() + 60 * 60 * 1000), status: 'pending', invited_by_user_id: actor.user_id }, { transaction: tx });
    await audit(actor, organizationId, 'membership.invited', invitation.invite_id, { membership_role: membershipRole, role_id: role.role_id }, tx);
    return { invitation, token, role };
  });
  return transaction ? work(transaction) : sequelize.transaction(work);
}
async function sendInvitation({ invitation, token, role }) {
  const frontend = process.env.NODE_ENV === 'production' ? process.env.FRONTEND_PROD_URL : process.env.FRONTEND_URL;
  await require('../utils/sendEmail')({ to: invitation.email, subject: 'Invitation to STECHAD Hub', htmlFilePath: require('path').join(__dirname, '../templates/projectManagerInvitation.html'), replacements: { firstname: invitation.first_name, role: role.name, employeeId: invitation.employee_id, year: new Date().getFullYear(), url: `${frontend || 'http://localhost:5173'}/accept-invite?token=${encodeURIComponent(token)}` } });
}
async function acceptInvitation({ token, input, identity }) {
  if (typeof token !== 'string' || token.length < 16 || token.length > 256) throw fail('Invalid or expired invite', 400);
  return runWithoutTenant(() => sequelize.transaction(async (transaction) => {
    // A raw legacy token is accepted only when no hash exists; a stored hash is never a bearer credential.
    const where = { status: 'pending', [Op.or]: [{ token_hash: hash(token) }, { token_hash: null, token }] };
    const hint = await Invite.unscoped().findOne({ where, transaction });
    if (!hint?.organization_id) throw fail('Invalid or expired invite', 400);
    const organization = await Organization.findByPk(hint.organization_id, { transaction, lock: transaction.LOCK.UPDATE });
    const invite = await Invite.unscoped().findOne({ where: { ...where, invite_id: hint.invite_id }, transaction, lock: transaction.LOCK.UPDATE });
    if (!invite || !invite.expires_at || invite.expires_at <= new Date() || organization?.status !== 'active') throw fail('Invalid or expired invite', 400);
    const role = await Role.findOne({ where: { organization_id: invite.organization_id, role_id: invite.role_id }, transaction });
    if (!role || role.role_key === 'super_admin') throw fail('Invalid invitation HR role', 400);
    if (identity && (!identity.is_verified || normalizeEmail(identity.email) !== normalizeEmail(invite.email))) throw fail('Sign in with the verified email addressed by this invitation', 403);
    let user = await User.unscoped().findOne({ where: emailWhere(invite.email), paranoid: false, transaction, lock: transaction.LOCK.UPDATE });
    if (user) {
      if (!identity) throw fail('Sign in to accept the invitation for your existing account', 401);
      if (identity.user_id !== user.user_id || !user.is_verified || !user.is_active || user.deleted_at) throw fail('Verified invitation identity is unavailable', 403);
    } else {
      if (identity) throw fail('Invitation email does not match your account', 403);
      const password = input.new_password || input.password;
      if (password !== input.confirm_password) throw fail('Passwords do not match', 400);
      const policy = require('../utils/passwordPolicy').passwordError(password);
      if (policy) throw fail(policy, 400);
      // Possession of the emailed single-use token verifies this new identity's email.
      user = await User.unscoped().create({ email: invite.email, password, role_id: role.role_id, first_name: input.first_name || invite.first_name, last_name: input.last_name || invite.last_name, is_verified: true }, { transaction });
    }
    let membership = await OrganizationMembership.findOne({ where: { organization_id: invite.organization_id, user_id: user.user_id }, transaction, lock: transaction.LOCK.UPDATE });
    if (membership?.status === 'active') throw fail('This user is already an active member', 409);
    if (membership) await membership.update({ status: 'active', membership_role: invite.membership_role || 'member' }, { transaction });
    else membership = await OrganizationMembership.create({ organization_id: invite.organization_id, user_id: user.user_id, membership_role: invite.membership_role || 'member' }, { transaction });
    const values = { role_id: role.role_id, employee_id: invite.employee_id || `ST-${randomBytes(6).toString('hex')}`, department_id: invite.department_id || null, job_title: invite.job_title || null, archived_at: null, deleted_at: null, deleted_by_user_id: null };
    const profile = await HRProfile.findOne({ where: { organization_id: invite.organization_id, user_id: user.user_id }, transaction });
    if (profile) await profile.update(values, { transaction });
    else await HRProfile.create({ ...values, organization_id: invite.organization_id, user_id: user.user_id, membership_id: membership.membership_id }, { transaction });
    const specific = role.role_key === 'talent' ? Talent : role.role_key === 'project_manager' ? ProjectManager : role.role_key === 'admin' ? Admin : null;
    if (specific) await specific.findOrCreate({ where: { organization_id: invite.organization_id, user_id: user.user_id }, defaults: specific === ProjectManager ? { status: 'active' } : {}, transaction });
    await invite.update({ status: 'accepted', token: null, token_hash: null, responded_at: new Date() }, { transaction });
    await audit(user, invite.organization_id, 'membership.invitation_accepted', membership.membership_id, { role_id: role.role_id }, transaction);
    return { organization_id: invite.organization_id, membership_id: membership.membership_id };
  }));
}
module.exports = { createInvitation, sendInvitation, acceptInvitation };
