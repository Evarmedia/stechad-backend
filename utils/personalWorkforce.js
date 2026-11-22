const isAdmin = (user) => ["admin", "super_admin"].includes(typeof user === "string" ? user : user?.role?.role_key);

function requirePersonalWorkforce(user) {
  if (isAdmin(user)) throw Object.assign(new Error("Personal attendance and expenses are unavailable for admin accounts"), { status: 403 });
}

function denyAdminPersonalWorkforce(req, res, next) {
  try { requirePersonalWorkforce(req.user); next(); }
  catch (error) { res.status(error.status).json({ success: false, message: error.message }); }
}

// Call with the user row locked before acquiring attendance locks.
async function cancelAdminAttendance(userId, transaction) {
  const Attendance = require("../services/hrModels").Attendance;
  const entries = await Attendance.findAll({ where: { user_id: userId, clock_out: null }, transaction, lock: transaction.LOCK.UPDATE });
  for (const entry of entries) {
    await entry.update({ auto_clock_out_at: null, ...(!["absent", "cancelled"].includes(entry.status) ? { status: "cancelled", clock_out_source: null } : {}) }, { transaction });
  }
}

module.exports = { isAdmin, requirePersonalWorkforce, denyAdminPersonalWorkforce, cancelAdminAttendance };
