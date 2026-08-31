const { Op } = require("sequelize");
const Role = require("../models/Role");

const SYSTEM_ROLE_KEYS = Object.freeze([
  "super_admin",
  "admin",
  "project_manager",
  "engineer",
  "staff",
]);

const ROLE_INCLUDE = Object.freeze({
  model: Role,
  as: "role",
  attributes: ["role_id", "role_key", "name", "description", "is_system"],
  required: true,
});

const getRoleKey = (userOrInvite) => userOrInvite?.role?.role_key || null;

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
};
