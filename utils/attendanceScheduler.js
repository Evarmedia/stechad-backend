const moment = require("moment");
const { Op } = require("sequelize");
const { Attendance, User } = require("../models");
const sequelize = require("../config/database");
const { recordAudit } = require("./audit");
const getUtcOffsetMinutes = () => {
  const configured = process.env.ATTENDANCE_UTC_OFFSET_MINUTES === undefined ? NaN : Number(process.env.ATTENDANCE_UTC_OFFSET_MINUTES);
  return Number.isFinite(configured) ? configured : 60;
};
const getWorkforceMoment = (value) => moment(value).utcOffset(getUtcOffsetMinutes());
const autoClockOutDeadline = (value) => getWorkforceMoment(value).startOf("day").hour(17).toDate();
const isAfterAutoClockOut = (value) => getWorkforceMoment(value).valueOf() >= autoClockOutDeadline(value).valueOf();
const isAttendanceDayClosed = (value) => {
  const now = getWorkforceMoment(value);
  return now.hour() === 23 && now.minute() >= 59;
};
async function reconcileUnclosedAttendance(value) {
  const now = getWorkforceMoment(value);
  const closedThrough = now.clone().subtract(isAttendanceDayClosed(now) ? 0 : 1, "day").format("YYYY-MM-DD");
  const eligible = { clock_out: null, status: { [Op.notIn]: ["absent", "cancelled"] }, [Op.or]: [{ auto_clock_out_at: { [Op.lte]: now.toDate() } }, { work_date: { [Op.lte]: closedThrough } }] };
  const candidates = await Attendance.findAll({ where: eligible, attributes: ["user_id"], group: ["user_id"], raw: true });
  let absentCount = 0;
  for (const { user_id } of candidates) {
    absentCount += await sequelize.transaction(async (transaction) => {
      // All attendance writers lock the user before the session. Role changes
      // therefore either precede reconciliation or cancel the remaining session.
      const user = await User.findByPk(user_id, { paranoid: false, transaction, lock: { level: transaction.LOCK.UPDATE, of: User }, skipLocked: true });
      if (!user) return 0;
      if (require("./personalWorkforce").isAdmin(user)) {
        await require("./personalWorkforce").cancelAdminAttendance(user_id, transaction);
        return 0;
      }
      const entries = await Attendance.findAll({ where: { ...eligible, user_id }, transaction, lock: transaction.LOCK.UPDATE, skipLocked: true });
      let absent = 0;
      for (const entry of entries) {
        if (entry.auto_clock_out_at && new Date(entry.auto_clock_out_at) <= now.toDate() && new Date(entry.clock_in) <= new Date(entry.auto_clock_out_at)) {
          await entry.update({ clock_out: entry.auto_clock_out_at, clock_out_source: "automatic", status: "completed" }, { transaction });
          await recordAudit({ action: "attendance.automatic_clock_out", target_type: "Attendance", target_id: entry.attendance_id, changes: { user_id, clock_out: entry.auto_clock_out_at } }, transaction);
        } else if (entry.work_date <= closedThrough) {
          await entry.update({ status: "absent" }, { transaction });
          absent++;
        }
      }
      return absent;
    });
  }
  return absentCount;
}
async function startAttendanceCloseScheduler() {
  const reconcile = async () => { try { await reconcileUnclosedAttendance(); } catch (error) { console.error("Attendance reconciliation failed:", error.message); } };
  await reconcile();
  const timer = setInterval(reconcile, 60_000);
  timer.unref?.();
  return timer;
}
module.exports = { getWorkforceMoment, autoClockOutDeadline, isAfterAutoClockOut, isAttendanceDayClosed, reconcileUnclosedAttendance, startAttendanceCloseScheduler };
