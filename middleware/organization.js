const { resolveTenantContext, runWithTenant } = require('../services/tenantContext');
const requireOrganization = async (req, res, next) => {
  try {
    const organizationId = req.get('X-Organization-Id');
    const context = await resolveTenantContext({ userId: req.user?.user_id, organizationId });
    req.tenant = context;
    return runWithTenant(context, next);
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message, code: error.code || (error.status === 403 ? 'MEMBERSHIP_UNAVAILABLE' : undefined) });
  }
};
module.exports = { requireOrganization };
