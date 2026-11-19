const { User, Department } = require("../models");
const sequelize = require("../config/database");
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const lockHierarchy = (transaction) => sequelize.query("SELECT pg_advisory_xact_lock(hashtext(:key))", { replacements: { key: `${sequelize.schema || "public"}:workforce-hierarchy` }, transaction });
async function validateLinks(changes, transaction) {
  const users = await User.findAll({ attributes: ["user_id", "reports_to_user_id", "is_active"], transaction });
  const links = new Map(users.map((user) => [user.user_id, user.reports_to_user_id]));
  for (const [id, manager] of changes) {
    if (manager && !users.some((u) => u.user_id === manager && u.is_active)) fail("Reporting manager must be an active user");
    links.set(id, manager);
  }
  for (const [id] of changes) {
    const seen = new Set(); let cursor = id;
    while (cursor) {
      if (seen.has(cursor)) fail("This reporting assignment would create a management cycle", 409);
      seen.add(cursor); cursor = links.get(cursor);
    }
  }
}
async function reportingUpdates(user, input, transaction) {
  let mode = input.reporting_manager_mode ?? (Object.hasOwn(input, "reports_to_user_id") ? "override" : user.reporting_manager_mode || "department");
  if (!["department", "override"].includes(mode)) fail("Invalid reporting manager mode");
  const departmentId = input.department_id === undefined ? user.department_id : input.department_id || null;
  if (departmentId) require("./http").requireUuid(departmentId);
  const department = departmentId ? await Department.findByPk(departmentId, { transaction }) : null;
  if (departmentId && !department) fail("Department not found", 404);
  if (department && departmentId !== user.department_id && department.status !== "active") fail("Select an active department");
  let manager = mode === "department" ? department?.manager_user_id || null : input.reports_to_user_id === undefined ? user.reports_to_user_id : input.reports_to_user_id || null;
  if (mode === "department" && manager === user.user_id) manager = null;
  if (manager) require("./http").requireUuid(manager);
  if (mode === "override" && manager && manager !== user.reports_to_user_id) {
    require("./roleUtils").requireDirectoryTarget(await User.findByPk(manager, { transaction }));
  }
  if (manager === user.user_id) fail("A user cannot report to themselves");
  if (manager !== user.reports_to_user_id || mode !== user.reporting_manager_mode || departmentId !== user.department_id) await validateLinks([[user.user_id, manager]], transaction);
  return { department_id: departmentId, reports_to_user_id: manager, reporting_manager_mode: mode };
}
async function updateDepartmentMembers(department, managerId, transaction) {
  if (managerId) {
    const manager = await User.findByPk(managerId, { transaction });
    if (!manager?.is_active) fail("Department manager must be an active user");
  }
  const members = await User.findAll({ where: { department_id: department.department_id, reporting_manager_mode: "department" }, transaction });
  const changes = members.map((user) => [user.user_id, user.user_id === managerId ? null : managerId]);
  await validateLinks(changes, transaction);
  for (const [id, manager] of changes) await User.update({ reports_to_user_id: manager || null }, { where: { user_id: id }, transaction });
}
module.exports = { lockHierarchy, reportingUpdates, updateDepartmentMembers, validateLinks };
