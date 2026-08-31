const crypto = require("crypto");
const { User, Invite } = require("../models");

const EMPLOYEE_ID_PREFIX = "STE";

const generateUniqueEmployeeId = async ({ transaction } = {}) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const employeeId = `${EMPLOYEE_ID_PREFIX}${crypto.randomInt(0, 10_000).toString().padStart(4, "0")}`;
    const queryOptions = { where: { employee_id: employeeId }, transaction };
    const [existingUser, existingInvite] = await Promise.all([
      User.findOne(queryOptions),
      Invite.findOne(queryOptions),
    ]);

    if (!existingUser && !existingInvite) return employeeId;
  }

  throw new Error("Could not allocate a unique employee ID");
};

module.exports = { EMPLOYEE_ID_PREFIX, generateUniqueEmployeeId };
