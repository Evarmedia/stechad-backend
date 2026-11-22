const jwt = require('jsonwebtoken');
const { User, RolePermission } = require('../models');
const { getRoleKey } = require('../utils/roleUtils');

const { hasPermission } = require("../utils/permissions");

// Global identity verification does not join a legacy HR role.
const authenticateIdentity = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace(/^Bearer /i, '');
    if (!token) return res.status(401).json({ success: false, message: 'No token provided, authorization denied' });
    const result = await require('../services/authSessions').authenticateAccessToken(token);
    req.identity = result.identity; req.user = result.identity;
    req.authSession = result.session; req.legacySession = result.legacy;
    return require('../services/tenantContext').runWithoutTenant(next);
  } catch (error) { return res.status(error.status || 401).json({ success: false, message: error.message, code: error.code }); }
};
const authenticate = (req, res, next) => authenticateIdentity(req, res, async () => {
  const globalAuth = /\/auth$/i.test(req.baseUrl || '') && !/^\/preferences\/?$/i.test(req.path);
  if (globalAuth || /\/organizations$/i.test(req.baseUrl || '')) return next();
  if (process.env.TENANCY_ENFORCED !== 'true' && !req.get('X-Organization-ID') && !await require('../models').OrganizationMembership.count({ where: { user_id: req.identity.user_id } })) {
    req.user = await User.findByPk(req.identity.user_id);
    return next();
  }
  try {
    const { resolveTenantContext, runWithTenant, getHRIdentity } = require('../services/tenantContext');
    const context = await resolveTenantContext({ userId: req.identity.user_id, organizationId: req.get('X-Organization-ID') });
    require('./organization').validateOrganizationInput(req, context);
    req.tenant = context; req.user = getHRIdentity(req.identity, context);
    return runWithTenant(context, next);
  } catch (error) { return res.status(error.status || 500).json({ success: false, message: error.message, code: error.code || (error.status === 403 ? 'MEMBERSHIP_UNAVAILABLE' : undefined) }); }
});

// Role-based authorization
const authorize = (...roles) => {
  return (req, res, next) => {
    const roleKey = getRoleKey(req.user);
    // Super admins inherit every endpoint that grants the admin role.
    if (roleKey === 'super_admin' && roles.includes('admin')) {
      return next();
    }
    if (!roles.includes(roleKey)) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied: insufficient permissions' 
      });
    }
    next();
  };
};

const authorizePermission = (permissionKey) => async (req, res, next) => {
  try {
    if (await hasPermission(req.user, permissionKey)) return next();
    return res.status(403).json({ success: false, message: `Access denied: ${permissionKey} permission is required` });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to verify workforce permission", error: error.message });
  }
};

const authorizeAnyPermission = (...permissionKeys) => async (req, res, next) => {
  try {
    for (const permissionKey of permissionKeys) {
      if (await hasPermission(req.user, permissionKey)) return next();
    }
    return res.status(403).json({ success: false, message: "Access denied: approval permission is required" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to verify workforce permission", error: error.message });
  }
};

const authorizeApprovalAction = async (req, res, next) => {
  const action = req.body.action;
  const permissionKey = req.params.type === "leave"
    ? "approve_leave"
    : req.params.type === "expense"
      ? (action === "receipt_verified" || action === "paid" ? "verify_receipts" : "approve_expenses")
      : req.params.type === "invoice"
        ? "approve_invoices"
        : null;
  if (!permissionKey) return res.status(400).json({ success: false, message: "Invalid approval type" });
  return authorizePermission(permissionKey)(req, res, next);
};

module.exports = { authenticateIdentity, authenticate, authorize, hasPermission, authorizePermission, authorizeAnyPermission, authorizeApprovalAction };
