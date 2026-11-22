let io;
const setRealtime = (value) => { io = value; };
const getRealtime = () => io;
const { peekTenantContext, runWithTenant, runWithoutTenant, resolveTenantContext } = require('../services/tenantContext');
const userRoom = (id, organizationId = peekTenantContext()?.organizationId) => organizationId ? `organization_${organizationId}_user_${id}` : `user_${id}`;
const identityRoom = (id) => `identity_${id}`;
const chatRoom = (id, organizationId = peekTenantContext()?.organizationId) => organizationId ? `organization_${organizationId}_chat_${id}` : `chat_${id}`;
async function canDeliver(id, organizationId) {
  if (!organizationId) return process.env.TENANCY_ENFORCED !== 'true';
  try {
    await runWithoutTenant(() => resolveTenantContext({ userId: id, organizationId }));
    return true;
  } catch { return false; }
}
async function emitToUser(realtime, id, event, payload = {}, organizationId = peekTenantContext()?.organizationId) {
  if (!realtime) return false;
  if (!organizationId && process.env.TENANCY_ENFORCED === 'true') {
    // Global identity updates carry no tenant business data.
    if (event === 'account_updated') { realtime.to(identityRoom(id)).emit(event, {}); return true; }
    throw Object.assign(new Error('Organization context is required for realtime delivery'), { status: 403 });
  }
  if (!await canDeliver(id, organizationId)) return false;
  realtime.to(userRoom(id, organizationId)).emit(event, organizationId ? { ...payload, organization_id: organizationId } : payload);
  return true;
}
const afterCommit = (transaction, callback) => {
  const tenant = peekTenantContext();
  const safe = async () => { try { await (tenant ? runWithTenant(tenant, callback) : runWithoutTenant(callback)); } catch (error) { console.error("Realtime delivery failed:", error.message); } };
  if (transaction) transaction.afterCommit(safe);
  else return safe();
};
const emitUser = (id, event, payload = {}) => emitToUser(io, id, event, payload);
const disconnectUser = (id) => io?.in(identityRoom(id)).in(userRoom(id, null)).disconnectSockets(true);
const disconnectMembership = (id, organizationId) => io?.in(userRoom(id, organizationId)).disconnectSockets(true);
module.exports = { setRealtime, getRealtime, afterCommit, emitUser, emitToUser, disconnectUser, disconnectMembership, userRoom, identityRoom, chatRoom, canDeliver };
