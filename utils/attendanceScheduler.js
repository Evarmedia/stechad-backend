const moment = require("moment");
const { Op } = require("sequelize");
const { Attendance, User, Organization, OrganizationMembership, HRProfile, Role } = require("../models");
const { peekTenantContext, revalidateTenantContext } = require("../services/tenantContext");
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
// Request ticks use the validated selected organization. Timer ticks enumerate
// active organizations explicitly; they never borrow an employee's authority.
async function jobOrganizations() {
  const context = peekTenantContext();
  if (context) await revalidateTenantContext(context);
  return Organization.findAll({ where: { status: "active", ...(context ? { organization_id: context.organizationId } : {}) } });
}
async function lockJobMember(organizationId, userId, transaction) {
  const organization = await Organization.findOne({ where: { organization_id: organizationId, status: "active" }, transaction, lock: transaction.LOCK.SHARE });
  if (!organization) return null;
  const membership = await OrganizationMembership.findOne({ where: { organization_id: organizationId, user_id: userId, status: "active" }, transaction, lock: transaction.LOCK.UPDATE });
  if (!membership) return null;
  const profile = await HRProfile.findOne({ where: { organization_id: organizationId, user_id: userId, membership_id: membership.membership_id, archived_at: null }, transaction, lock: transaction.LOCK.UPDATE });
  if (!profile) return null;
  const user = await User.unscoped().findOne({ where: { user_id: userId, is_active: true }, transaction, lock: transaction.LOCK.SHARE });
  if (!user) return null;
  const role = await Role.findOne({ where: { organization_id: organizationId, role_id: profile.role_id }, transaction });
  return role ? { user_id: userId, role } : null;
}
async function reconcileTenantAttendance(value) {
  let absent = 0;
  for (const organization of await jobOrganizations()) {
    const organizationId = organization.organization_id;
    const now = getWorkforceMoment(value);
    const closedThrough = now.clone().subtract(isAttendanceDayClosed(now) ? 0 : 1, "day").format("YYYY-MM-DD");
    const eligible = { organization_id: organizationId, clock_out: null, status: { [Op.notIn]: ["absent", "cancelled"] }, [Op.or]: [{ auto_clock_out_at: { [Op.lte]: now.toDate() } }, { work_date: { [Op.lte]: closedThrough } }] };
    const candidates = await Attendance.findAll({ where: eligible, attributes: ["user_id"], group: ["user_id"], raw: true });
    for (const { user_id } of candidates) {
      absent += await sequelize.transaction(async (transaction) => {
        const member = await lockJobMember(organizationId, user_id, transaction);
        if (!member) return 0;
        const admin = ["admin", "super_admin"].includes(member.role.role_key);
        const entries = await Attendance.findAll({ where: admin ? { organization_id: organizationId, user_id, clock_out: null } : { ...eligible, user_id }, transaction, lock: transaction.LOCK.UPDATE });
        let count = 0;
        for (const entry of entries) {
          let values, action;
          if (admin) {
            values = { auto_clock_out_at: null, ...(!["absent", "cancelled"].includes(entry.status) ? { status: "cancelled", clock_out_source: null } : {}) };
            action = "attendance.cancelled";
          } else if (entry.auto_clock_out_at && new Date(entry.auto_clock_out_at) <= now.toDate() && new Date(entry.clock_in) <= new Date(entry.auto_clock_out_at)) {
            values = { clock_out: entry.auto_clock_out_at, clock_out_source: "automatic", status: "completed" };
            action = "attendance.automatic_clock_out";
          } else if (entry.work_date <= closedThrough) {
            values = { status: "absent" }; action = "attendance.absent"; count++;
          } else continue;
          await entry.update(values, { transaction, audit: false });
          await recordAudit({ organizationId, action, target_type: "Attendance", target_id: entry.attendance_id, changes: { user_id, ...values } }, transaction);
        }
        return count;
      });
    }
  }
  return absent;
}
async function reconcileUnclosedAttendance(value) {
  if (peekTenantContext() || process.env.TENANCY_ENFORCED === "true") return reconcileTenantAttendance(value);
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
module.exports = { jobOrganizations, lockJobMember, getWorkforceMoment, autoClockOutDeadline, isAfterAutoClockOut, isAttendanceDayClosed, reconcileUnclosedAttendance, startAttendanceCloseScheduler };
