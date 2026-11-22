const { Op } = require("sequelize");
const Role = require("../services/hrModels").Role;

const SYSTEM_ROLE_KEYS = Object.freeze([
  "super_admin",
  "admin",
  "project_manager",
  "talent",
  "staff",
]);

const ROLE_INCLUDE = Object.freeze({
  model: Role,
  as: "role",
  attributes: ["role_id", "role_key", "name", "description", "is_system", "permission_keys"],
  required: true,
});

const getRoleKey = (userOrInvite) => userOrInvite?.role?.role_key || userOrInvite?.role_details?.role_key || (typeof userOrInvite?.role === 'string' ? userOrInvite.role : null);
const roleRecord = (value) => value?.role && typeof value.role === "object" ? value.role : value;
const isCustomRole = (value) => {
  const role = roleRecord(value);
  return role?.is_system === false && !SYSTEM_ROLE_KEYS.includes(role.role_key);
};
const isWorkforceRole = (value) => ["admin", "project_manager", "staff"].includes(roleRecord(value)?.role_key) || isCustomRole(value);
const directoryWhere = (excludeTalents = false) => ({ "$role.role_key$": { [Op.notIn]: ["super_admin", ...(excludeTalents ? ["talent"] : [])] } });
const requireDirectoryTarget = (user) => {
  if (!user || getRoleKey(user) === "super_admin") throw Object.assign(new Error("User not found"), { status: 404 });
  return user;
};
const personalBasePath = (user) => {
  const role = getRoleKey(user);
  return ["admin", "super_admin"].includes(role) ? "/admin" : role === "project_manager" ? "/dashboard/pm" : role === "talent" ? "/dashboard/talent" : "/dashboard/staff";
};
const personalFeaturePath = (user, feature) => {
  const base = personalBasePath(user);
  if (base === "/admin" && ["kpis", "holidays"].includes(feature)) return `/admin/workforce?tab=${feature}`;
  if (getRoleKey(user) === "talent" && feature === "holidays") return base;
  return `${base}/${feature}`;
};

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));

const findRoleByIdentifier = async (identifier, options = {}) => {
  if (!identifier) return null;
  const normalizedIdentifier = String(identifier).trim().toLowerCase();
  const identifiers = [{ role_key: normalizedIdentifier }];
  if (isUuid(normalizedIdentifier)) identifiers.unshift({ role_id: normalizedIdentifier });
  return Role.findOne({
    where: {
      [Op.or]: identifiers,
    },
    ...options,
  });
};

const findRoleByKey = (roleKey, options = {}) => Role.findOne({
  where: { role_key: String(roleKey || "").trim().toLowerCase() },
  ...options,
});

module.exports = {
  SYSTEM_ROLE_KEYS,
  ROLE_INCLUDE,
  getRoleKey,
  findRoleByIdentifier,
  findRoleByKey,
  isCustomRole,
  isWorkforceRole,
  directoryWhere,
  requireDirectoryTarget,
  personalBasePath,
  personalFeaturePath,
};
