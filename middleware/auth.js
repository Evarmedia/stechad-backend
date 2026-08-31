const jwt = require('jsonwebtoken');
const { User, RolePermission } = require('../models');
const { getRoleKey } = require('../utils/roleUtils');

const permissionDefaults = {
  super_admin: ["*"],
  admin: ["view_dashboard", "manage_departments", "approve_leave", "approve_expenses", "verify_receipts", "submit_expenses", "create_projects", "manage_staff", "manage_kpis", "approve_invoices"],
  project_manager: ["view_dashboard", "approve_leave", "submit_expenses", "create_projects", "manage_kpis"],
  staff: ["view_dashboard", "submit_expenses"],
};

// Verify JWT token
const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'No token provided, authorization denied' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const user = await User.findByPk(decoded.user_id);
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'User Doesnt Exist' 
      });
    }

    if (!user.is_active) {
      return res.status(401).json({ 
        success: false, 
        message: 'Account has been deactivated' 
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ 
      success: false, 
      message: 'Token is not valid' 
    });
  }
};

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

const hasPermission = async (user, permissionKey) => {
  const roleKey = getRoleKey(user);
  if (roleKey === "super_admin") return true;
  if (roleKey === "engineer") return ["view_dashboard", "submit_expenses"].includes(permissionKey);
  if (Array.isArray(user.workforce_permissions) && user.workforce_permissions.includes(permissionKey)) return true;
  const roleColumn = roleKey === "project_manager" ? "project_manager" : roleKey;
  if (!["admin", "project_manager", "staff"].includes(roleColumn)) return false;
  const permission = await RolePermission.findOne({ where: { permission_key: permissionKey } });
  if (!permission) return (permissionDefaults[roleKey] || []).includes(permissionKey);
  return Boolean(permission[roleColumn]);
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

module.exports = { authenticate, authorize, hasPermission, authorizePermission, authorizeAnyPermission, authorizeApprovalAction };
