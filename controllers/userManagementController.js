const { Op, fn, col } = require("sequelize");
const { User, Role, Department, Attendance, AuditLog, Notification, NotificationBroadcast } = require("../models");
const sequelize = require("../config/database");
const { ROLE_INCLUDE, directoryWhere, requireDirectoryTarget } = require("../utils/roleUtils");
const { pagination, pageInfo, requireUuid } = require("../utils/http");
const { catalog, normalizeGrants } = require("../utils/permissions");
const lifecycle = require("../utils/userLifecycle");
const { validateEmployeeId } = require("../utils/employeeId");
const { getWorkforceMoment, reconcileUnclosedAttendance } = require("../utils/attendanceScheduler");
async function getUsers(req, res) {
  const { page, limit, offset } = pagination(req.query);
  const status = req.query.status || "current";
  if (!["current", "active", "inactive", "deleted", "all"].includes(status)) throw Object.assign(new Error("Invalid account status"), { status: 400 });
  const where = directoryWhere(true);
  if (status === "deleted") where.deleted_at = { [Op.ne]: null };
  if (["active", "inactive"].includes(status)) where.is_active = status === "active";
  if (req.query.search) where[Op.or] = ["first_name", "last_name", "email", "employee_id"].map((key) => ({ [key]: { [Op.iLike]: `%${String(req.query.search).slice(0, 255)}%` } }));
  if (req.query.role) where[Op.and] = [{ "$role.role_key$": req.query.role }];
  const [users, total, deleted, roles] = await Promise.all([
    User.findAndCountAll({ where, paranoid: !["deleted", "all"].includes(status), include: [ROLE_INCLUDE, { model: Department, as: "department", attributes: ["department_id", "name"] }], order: [["created_at", "DESC"], ["user_id", "DESC"]], limit, offset, distinct: true }),
    User.count({ where: directoryWhere(true) }), User.count({ paranoid: false, where: { ...directoryWhere(true), deleted_at: { [Op.ne]: null } } }), Role.findAll({ where: { role_key: { [Op.notIn]: ["talent", "super_admin"] } }, order: [["name", "ASC"]] }),
  ]);
  res.json({ success: true, data: { users: users.rows, roles, permissions: catalog, counts: { totalUsers: total, deletedUsers: deleted }, pagination: pageInfo(users.count, page, limit) } });
}
async function deleteUser(req, res) { await lifecycle.deleteUser(requireUuid(req.params.id), req.user); res.json({ success: true, message: "User deleted. Their history has been preserved." }); }
async function restoreUser(req, res) { const user = await lifecycle.restoreUser(requireUuid(req.params.id), req.user); res.json({ success: true, data: { user } }); }
async function updatePermissions(req, res) {
  const id = requireUuid(req.params.id);
  const grants = normalizeGrants(req.body.workforce_permissions);
  const user = await User.findByPk(id);
  requireDirectoryTarget(user);
  if (require("../utils/roleUtils").getRoleKey(user) === "super_admin") throw Object.assign(new Error("Super Admin permissions are always enabled"), { status: 409 });
  await user.update({ workforce_permissions: grants });
  res.json({ success: true, data: { user } });
}
async function updateEmployeeId(req, res) {
  const id = requireUuid(req.params.id);
  const user = await sequelize.transaction(async (transaction) => {
    const current = await User.findByPk(id, { transaction });
    requireDirectoryTarget(current);
    if (current.role?.role_key === "talent") throw Object.assign(new Error("Employment editing is unavailable for talent accounts"), { status: 400 });
    const employee_id = await validateEmployeeId(req.body.employee_id, id, transaction);
    return current.update({ employee_id }, { transaction });
  });
  res.json({ success: true, data: { user } });
}
function dateRange(query, field, defaults = false) {
  const start = query.start_date || (defaults ? getWorkforceMoment().startOf("month").format("YYYY-MM-DD") : null);
  const end = query.end_date || (defaults ? getWorkforceMoment().format("YYYY-MM-DD") : null);
  for (const value of [start, end].filter(Boolean)) if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw Object.assign(new Error("Use valid dates in YYYY-MM-DD format"), { status: 400 });
  if (start && end && start > end) throw Object.assign(new Error("Start date must be before end date"), { status: 400 });
  if (!start && !end) return {};
  return { [field]: { ...(start ? { [Op.gte]: start } : {}), ...(end ? { [Op.lte]: field === "occurred_at" ? new Date(`${end}T23:59:59.999Z`) : end } : {}) } };
}
async function getAttendance(req, res) {
  const id = requireUuid(req.params.id);
  const person = await User.findByPk(id, { paranoid: false, attributes: ["user_id", "first_name", "last_name", "email", "deleted_at"] });
  requireDirectoryTarget(person);
  await reconcileUnclosedAttendance();
  const { page, limit, offset } = pagination(req.query);
  const where = { user_id: id, ...dateRange(req.query, "work_date", true) };
  if (req.query.status) {
    if (!["present", "late", "completed", "absent", "cancelled"].includes(req.query.status)) throw Object.assign(new Error("Invalid attendance status"), { status: 400 });
    where.status = req.query.status;
  }
  if (req.query.source) {
    if (!["manual", "automatic"].includes(req.query.source)) throw Object.assign(new Error("Invalid clock-out source"), { status: 400 });
    where.clock_out_source = req.query.source;
  }
  const [result, groups, durations] = await Promise.all([
    Attendance.findAndCountAll({ where, limit, offset, order: [["work_date", "DESC"], ["attendance_id", "DESC"]] }),
    Attendance.findAll({ where, attributes: ["status", [fn("COUNT", col("attendance_id")), "count"]], group: ["status"], raw: true }),
    Attendance.findAll({ where, attributes: [[fn("SUM", sequelize.literal('EXTRACT(EPOCH FROM ("clock_out" - "clock_in"))')), "seconds"]], raw: true }),
  ]);
  res.json({ success: true, data: { user: person, entries: result.rows, summary: { totalEntries: result.count, statuses: Object.fromEntries(groups.map((row) => [row.status, Number(row.count)])), workedHours: Number(durations[0]?.seconds || 0) / 3600 }, pagination: pageInfo(result.count, page, limit) } });
}
async function getAuditLogs(req, res) {
  const { page, limit, offset } = pagination(req.query);
  const where = dateRange(req.query, "occurred_at");
  for (const key of ["actor_user_id", "target_type", "target_id", "action", "outcome"]) if (req.query[key]) where[key] = req.query[key];
  if (where.actor_user_id) requireUuid(where.actor_user_id);
  const logs = await AuditLog.findAndCountAll({ where, limit, offset, order: [["occurred_at", "DESC"], ["audit_log_id", "DESC"]] });
  res.json({ success: true, data: { logs: logs.rows, pagination: pageInfo(logs.count, page, limit) } });
}
async function broadcast(req, res) {
  const { broadcast_id, title, message, type = "info" } = req.body;
  requireUuid(broadcast_id);
  if (typeof title !== "string" || !title.trim() || title.length > 200 || typeof message !== "string" || !message.trim() || message.length > 5000 || !["info", "success", "warning"].includes(type)) throw Object.assign(new Error("Enter a title (up to 200 characters), message (up to 5000 characters), and valid notification type"), { status: 400 });
  const result = await sequelize.transaction(async (transaction) => {
    await sequelize.query("SELECT pg_advisory_xact_lock(hashtext(:id))", { replacements: { id: broadcast_id }, transaction });
    const existing = await NotificationBroadcast.findByPk(broadcast_id, { transaction });
    if (existing) {
      if (existing.created_by !== req.user.user_id || existing.title !== title.trim() || existing.message !== message.trim() || existing.type !== type) throw Object.assign(new Error("This broadcast identifier was already used for a different notification"), { status: 409 });
      return existing;
    }
    const recipients = await User.findAll({ attributes: ["user_id"], transaction, lock: { level: transaction.LOCK.SHARE, of: User }, order: [["user_id", "ASC"]] });
    const batch = await NotificationBroadcast.create({ broadcast_id, title: title.trim(), message: message.trim(), type, created_by: req.user.user_id, recipient_count: recipients.length }, { transaction });
    await Notification.bulkCreate(recipients.map((user) => ({ user_id: user.user_id, broadcast_id, title: batch.title, message: batch.message, type, metadata: { broadcast_id } })), { transaction });
    return batch;
  });
  res.json({ success: true, data: result });
}
module.exports = { updatePermissions, getUsers, deleteUser, restoreUser, updateEmployeeId, getAttendance, getAuditLogs, broadcast, dateRange };
