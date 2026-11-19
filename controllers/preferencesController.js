const { User, Attendance } = require("../models");
const { Op } = require("sequelize");
const sequelize = require("../config/database");
const { getWorkforceMoment, autoClockOutDeadline, isAfterAutoClockOut, reconcileUnclosedAttendance } = require("../utils/attendanceScheduler");
const { formatUserResponse } = require("./authController");
const { afterCommit, emitUser } = require("../utils/events");
const getPreferences = async (req, res) => res.json({ success: true, data: { user: await formatUserResponse(req.user) } });
async function updatePreferences(req, res) {
  const allowed = ["auto_clock_out_enabled", "notification_sound_enabled", "import_sound_preference"];
  if (Object.keys(req.body).some((key) => !allowed.includes(key))) throw Object.assign(new Error("Unsupported preference"), { status: 400 });
  for (const key of allowed) if (req.body[key] !== undefined && typeof req.body[key] !== "boolean") throw Object.assign(new Error(`${key} must be a boolean`), { status: 400 });
  if (req.body.auto_clock_out_enabled !== undefined) require("../utils/personalWorkforce").requirePersonalWorkforce(req.user);
  if (req.body.auto_clock_out_enabled !== undefined) await reconcileUnclosedAttendance();
  const user = await sequelize.transaction(async (transaction) => {
    const current = await User.findByPk(req.user.user_id, { transaction, lock: { level: transaction.LOCK.UPDATE, of: User } });
    const open = await Attendance.findOne({ where: { user_id: current.user_id, work_date: getWorkforceMoment().format("YYYY-MM-DD"), clock_out: null, status: { [Op.notIn]: ["absent", "cancelled"] } }, transaction, lock: transaction.LOCK.UPDATE });
    const updates = {};
    if (req.body.auto_clock_out_enabled !== undefined) {
      require("../utils/personalWorkforce").requirePersonalWorkforce(current);
      const enabled = req.body.auto_clock_out_enabled;
      if (enabled && open && isAfterAutoClockOut()) throw Object.assign(new Error("Finish your current session manually before enabling automatic clock-out after 5 PM"), { status: 409 });
      updates.auto_clock_out_enabled = enabled;
      updates.auto_clock_out_time = enabled ? "17:00:00" : null;
      if (open) await open.update({ auto_clock_out_at: enabled ? autoClockOutDeadline() : null }, { transaction });
    }
    if (req.body.notification_sound_enabled !== undefined && (!req.body.import_sound_preference || current.notification_sound_enabled === null)) updates.notification_sound_enabled = req.body.notification_sound_enabled;
    await current.update(updates, { transaction });
    afterCommit(transaction, () => emitUser(current.user_id, "account_updated"));
    return current;
  });
  res.json({ success: true, data: { user: await formatUserResponse(user) } });
}
module.exports = { getPreferences, updatePreferences };
