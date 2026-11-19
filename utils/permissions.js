const { getRoleKey } = require("./roleUtils");

const catalog = [
  ["manage_departments", "Manage departments", true, false, false],
  ["approve_leave", "Approve leave", true, false, false],
  ["approve_expenses", "Approve expenses", true, false, false],
  ["verify_receipts", "Verify expense receipts", true, false, false],
  ["submit_expenses", "Submit expenses", true, true, true],
  ["create_projects", "Create projects", true, true, false],
  ["manage_staff", "Manage staff", true, false, false],
  ["manage_kpis", "Manage KPIs and appraisals", true, false, false],
  ["approve_invoices", "Approve invoices", true, false, false],
].map(([permission_key, name, admin, project_manager, staff]) => ({ permission_key, name, admin, project_manager, staff, super_admin: true }));

const normalizePermission = (key) => key === "create_project" ? "create_projects" : key;
const normalizeGrants = (values) => {
  if (!Array.isArray(values) || values.some((v) => typeof v !== "string"))
    throw Object.assign(new Error("Permissions must be an array of permission keys"), { status: 400 });
  const keys = [...new Set(values.map(normalizePermission))];
  if (keys.some((key) => !catalog.some((p) => p.permission_key === key)))
    throw Object.assign(new Error("Unknown permission key"), { status: 400 });
  return keys;
};

async function effectivePermissions(user) {
  if (getRoleKey(user) === "super_admin") return ["*"];
  const { RolePermission } = require("../models");
  const role = getRoleKey(user);
  const configured = await RolePermission.findAll();
  const roleKeys = catalog.filter((fallback) => {
    const row = configured.find((p) => p.permission_key === fallback.permission_key);
    return ["admin", "project_manager", "staff"].includes(role) && Boolean((row || fallback)[role]);
  }).map((p) => p.permission_key);
  // Preserve the existing talent expense entitlement, while honoring individual grants.
  if (role === "talent") roleKeys.push("submit_expenses");
  if (require("./roleUtils").isCustomRole(user)) {
    const currentRole = await require("../models/Role").findByPk(user.role_id || user.role.role_id);
    roleKeys.push(...(currentRole?.permission_keys || []).map(normalizePermission));
  }
  return [...new Set([...roleKeys, ...(user.workforce_permissions || []).map(normalizePermission)])]
    .filter((key) => catalog.some((p) => p.permission_key === key));
}

async function hasPermission(user, key) {
  const permissions = await effectivePermissions(user);
  return permissions.includes("*") || permissions.includes(normalizePermission(key));
}

module.exports = { catalog, normalizePermission, normalizeGrants, effectivePermissions, hasPermission };
