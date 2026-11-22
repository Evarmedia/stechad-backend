const crypto = require("crypto");
const { Op } = require("sequelize");
const sequelize = require("../config/database");
const { User, Invite, Setting } = require("../services/hrModels");

const DEFAULT_EMPLOYEE_ID_PREFIX = "STE";
const EMPLOYEE_ID_PREFIX_PATTERN = /^[A-Z][A-Z0-9]{0,9}$/;

const generateUniqueEmployeeId = async ({ transaction } = {}) => {
  if (transaction) await lockEmployeeIds(transaction);
  const setting = await Setting.findOne({ where: { key: "EMPLOYEE_ID_PREFIX" }, transaction });
  const prefix = setting?.value || DEFAULT_EMPLOYEE_ID_PREFIX;
  if (!EMPLOYEE_ID_PREFIX_PATTERN.test(prefix)) throw new Error("Invalid employee ID prefix setting");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const employeeId = `${prefix}${crypto.randomInt(0, 10_000).toString().padStart(4, "0")}`;
    const queryOptions = { where: { employee_id: employeeId }, transaction };
    const existingUser = await User.findOne({ ...queryOptions, paranoid: false });
    const existingInvite = await Invite.findOne(queryOptions);

    if (!existingUser && !existingInvite) return employeeId;
  }

  throw new Error("Could not allocate a unique employee ID");
};

const lockEmployeeIds = (transaction) => sequelize.query("SELECT pg_advisory_xact_lock(hashtext(:key))", { replacements: { key: `${sequelize.schema || "public"}:employee-ids` }, transaction });

async function validateEmployeeId(value, userId, transaction) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 255) throw Object.assign(new Error("Employee ID must contain 1–255 characters"), { status: 400 });
  const employeeId = value.trim();
  await lockEmployeeIds(transaction);
  const user = await User.findOne({ where: { employee_id: employeeId, ...(userId ? { user_id: { [Op.ne]: userId } } : {}) }, paranoid: false, transaction });
  const invite = await Invite.findOne({ where: { employee_id: employeeId }, transaction });
  if (user || invite) throw Object.assign(new Error("Employee ID is already assigned or reserved"), { status: 409 });
  return employeeId;
}

module.exports = { validateEmployeeId, lockEmployeeIds, DEFAULT_EMPLOYEE_ID_PREFIX, EMPLOYEE_ID_PREFIX_PATTERN, generateUniqueEmployeeId };
