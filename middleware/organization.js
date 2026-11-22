const { resolveTenantContext, runWithTenant } = require('../services/tenantContext');
const validateOrganizationInput = (req, context) => {
  for (const source of [req.body, req.query]) {
    for (const key of ['organization_id', 'organizationId']) {
      if (source?.[key] !== undefined && source[key] !== context.organizationId) throw Object.assign(new Error('Conflicting organization identifier'), { status: 400 });
    }
  }
};
const requireOrganization = async (req, res, next) => {
  try {
    const organizationId = req.get('X-Organization-Id');
    const context = await resolveTenantContext({ userId: req.user?.user_id, organizationId });
    validateOrganizationInput(req, context);
    req.tenant = context;
    return runWithTenant(context, next);
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message, code: error.code || (error.status === 403 ? 'MEMBERSHIP_UNAVAILABLE' : undefined) });
  }
};
module.exports = { requireOrganization, validateOrganizationInput };
