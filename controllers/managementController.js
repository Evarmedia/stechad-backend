const { User, Department, Kpi, KpiAppraisal } = require("../services/hrModels");
const { directoryWhere, requireDirectoryTarget } = require("../utils/roleUtils");
const sequelize = require("../config/database");
const { hasPermission } = require("../utils/permissions");
const { lockHierarchy, reportingUpdates } = require("../utils/reporting");
const { requireUuid } = require("../utils/http");
const employmentFields = ["department_id", "job_title", "reports_to_user_id", "reporting_manager_mode", "employment_type", "hire_date", "leave_allowance_days", "current_assignment", "work_region"];
const basicFields = ["user_id", "first_name", "last_name", "email", "is_active"];
async function getUsers(req, res) {
  const canManage = await hasPermission(req.user, "manage_staff");
  const users = await User.findAll({ where: directoryWhere(true), attributes: canManage ? [...basicFields, ...employmentFields, "employee_id"] : basicFields, ...(canManage ? { include: [{ model: User, as: "reporting_manager", attributes: basicFields }] } : {}), order: [["first_name", "ASC"]] });
  res.json({ success: true, data: users });
}
async function updateUser(req, res) {
  const id = requireUuid(req.params.user_id);
  const allowedFields = [...employmentFields, ...(require("../utils/personalWorkforce").isAdmin(req.user) ? ["employee_id"] : [])];
  if (Object.keys(req.body).some((key) => !allowedFields.includes(key))) throw Object.assign(new Error("Only employment and reporting fields may be changed here"), { status: 400 });
  if (req.body.leave_allowance_days !== undefined && (!Number.isInteger(req.body.leave_allowance_days) || req.body.leave_allowance_days < 0)) throw Object.assign(new Error("Leave allowance must be a nonnegative whole number"), { status: 400 });
  const user = await sequelize.transaction(async (transaction) => {
    await lockHierarchy(transaction);
    const row = await User.findByPk(id, { transaction });
    requireDirectoryTarget(row);
    if (row.role?.role_key === "talent") throw Object.assign(new Error("Employment editing is unavailable for talent accounts"), { status: 400 });
    const changesReporting = ["department_id", "reports_to_user_id", "reporting_manager_mode"].some((key) => Object.hasOwn(req.body, key));
    const updates = { ...req.body, ...(changesReporting ? await reportingUpdates(row, req.body, transaction) : {}) };
    if (Object.hasOwn(req.body, "employee_id")) updates.employee_id = await require("../utils/employeeId").validateEmployeeId(req.body.employee_id, id, transaction);
    await row.update(updates, { transaction });
    return Object.fromEntries([...basicFields, ...employmentFields, "employee_id"].map((key) => [key, row.get(key)]));
  });
  res.json({ success: true, data: user });
}
async function getDepartments(req, res) {
  res.json({ success: true, data: await Department.findAll({ include: [{ model: User, as: "manager", attributes: basicFields }], order: [["name", "ASC"]] }) });
}
async function getKpis(req, res) {
  res.json({ success: true, data: await Kpi.findAll({ include: [{ model: User, paranoid: false, as: "assignee", attributes: basicFields }, { model: KpiAppraisal, as: "appraisals", separate: true, order: [["created_at", "DESC"]] }], order: [["created_at", "DESC"]] }) });
}
module.exports = { getUsers, updateUser, getDepartments, getKpis };
