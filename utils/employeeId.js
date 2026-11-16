const crypto = require("crypto");
const { User, Invite, Setting } = require("../models");

const DEFAULT_EMPLOYEE_ID_PREFIX = "STE";
const EMPLOYEE_ID_PREFIX_PATTERN = /^[A-Z][A-Z0-9]{0,9}$/;

const generateUniqueEmployeeId = async ({ transaction } = {}) => {
  const setting = await Setting.findOne({ where: { key: "EMPLOYEE_ID_PREFIX" }, transaction });
  const prefix = setting?.value || DEFAULT_EMPLOYEE_ID_PREFIX;
  if (!EMPLOYEE_ID_PREFIX_PATTERN.test(prefix)) throw new Error("Invalid employee ID prefix setting");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const employeeId = `${prefix}${crypto.randomInt(0, 10_000).toString().padStart(4, "0")}`;
    const queryOptions = { where: { employee_id: employeeId }, transaction };
    const [existingUser, existingInvite] = await Promise.all([
      User.findOne(queryOptions),
      Invite.findOne(queryOptions),
    ]);

    if (!existingUser && !existingInvite) return employeeId;
  }

  throw new Error("Could not allocate a unique employee ID");
};

module.exports = { DEFAULT_EMPLOYEE_ID_PREFIX, EMPLOYEE_ID_PREFIX_PATTERN, generateUniqueEmployeeId };
