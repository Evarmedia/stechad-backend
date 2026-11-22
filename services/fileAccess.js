const { Op } = require('sequelize');
const { peekTenantContext, revalidateTenantContext, getHRIdentity, runWithTenant } = require('./tenantContext');
const denied = () => Object.assign(new Error('File is not available in this organization'), { status: 403 });
const normalizePurpose = (purpose) => purpose === 'profile-images' ? 'avatars' : purpose;

async function fileOwner(objectName, context) {
  const { StoredFile, Talent, ExpenseClaim, Chat, Message, User, OrganizationMembership } = require('../models');
  const registered = await StoredFile.findOne({ where: { organization_id: context.organizationId, object_name: objectName } });
  if (registered) return { owner: registered.owner_user_id, purpose: normalizePurpose(registered.purpose) };
  if (await StoredFile.findOne({ where: { object_name: objectName } })) return null;
  // Legacy references retain their object names. Resolve ownership through data,
  // never by accepting a caller-controlled storage path or UUID prefix.
  const talent = await Talent.findOne({ where: { organization_id: context.organizationId, cv_object_name: objectName } });
  if (talent) return { owner: talent.user_id, purpose: 'resumes' };
  const expense = await ExpenseClaim.findOne({ where: { organization_id: context.organizationId, receipt_object_name: objectName } });
  if (expense) return { owner: expense.user_id, purpose: 'receipts' };
  const chat = await Chat.findOne({ where: { organization_id: context.organizationId, avatar_object_name: objectName, participants: { [Op.contains]: [context.userId] } } });
  if (chat) return { owner: chat.created_by, purpose: 'chat-avatars', chat };
  const attachment = await Message.findOne({ where: { organization_id: context.organizationId, [Op.or]: [{ attachments: { [Op.contains]: [{ object_name: objectName }] } }, { attachments: { [Op.contains]: [{ objectName }] } }] }, include: [{ model: Chat, as: 'chat', where: { organization_id: context.organizationId, participants: { [Op.contains]: [context.userId] } }, required: true }] });
  if (attachment) return { owner: attachment.sender_id, purpose: 'chat-attachments', chat: attachment.chat };
  const avatar = await User.unscoped().findOne({ where: { avatar_object_name: objectName }, attributes: ['user_id'], paranoid: false });
  if (avatar && await OrganizationMembership.findOne({ where: { organization_id: context.organizationId, user_id: avatar.user_id } })) return { owner: avatar.user_id, purpose: 'avatars' };
  return null;
}

async function assertFileOwnership(objectName, { write = false } = {}) {
  let context = peekTenantContext();
  if (!context) {
    if (process.env.TENANCY_ENFORCED === 'true') throw denied();
    return null;
  }
  if (typeof objectName !== 'string' || !objectName || objectName.includes('..') || objectName.includes('://')) throw denied();
  context = await revalidateTenantContext(context);
  const file = await fileOwner(objectName, context);
  if (!file) throw denied();
  if (file.owner === context.userId) return file;
  if (write) throw denied();
  if (file.purpose === 'avatars' || file.chat) return file;
  const role = context.role?.role_key;
  if (file.purpose.includes('chat')) {
    const { Chat } = require('../models');
    if (await Chat.findOne({ where: { organization_id: context.organizationId, avatar_object_name: objectName, participants: { [Op.contains]: [context.userId] } } })) return file;
    throw denied();
  }
  // Recruiting roles retain their existing candidate-CV access independently of
  // staff-management permissions. All permission keys use the shared resolver.
  if (file.purpose === 'resumes' && ['admin', 'super_admin', 'project_manager'].includes(role)) return file;
  const keys = file.purpose.includes('receipt') ? ['approve_expenses', 'verify_receipts'] : ['manage_staff'];
  const permissions = await runWithTenant(context, () => require('../utils/permissions').effectivePermissions(getHRIdentity({ user_id: context.userId }, context)));
  if (permissions.includes('*') || keys.some((key) => permissions.includes(key))) return file;
  throw denied();
}

async function registerFile(objectName, ownerUserId, purpose) {
  const context = peekTenantContext();
  if (!context) {
    if (process.env.TENANCY_ENFORCED === 'true') throw denied();
    return;
  }
  await revalidateTenantContext(context);
  if (ownerUserId !== context.userId) throw denied();
  return require('../models/StoredFile').create({ organization_id: context.organizationId, owner_user_id: ownerUserId, object_name: objectName, purpose: normalizePurpose(purpose) });
}

module.exports = { assertFileOwnership, registerFile };
