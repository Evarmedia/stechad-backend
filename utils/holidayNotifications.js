const moment = require("moment");
const { Op } = require("sequelize");
const { Holiday, User, Notification, OrganizationMembership } = require("../models");
const sequelize = require("../config/database");
const { peekTenantContext } = require("../services/tenantContext");
const { jobOrganizations, lockJobMember } = require("./attendanceScheduler");
const { ROLE_INCLUDE, personalFeaturePath } = require("./roleUtils");

async function sendTenantHolidayNotifications() {
  const today = moment().startOf("day");
  let created = 0;
  for (const organization of await jobOrganizations()) {
    const organizationId = organization.organization_id;
    const holidays = await Holiday.findAll({ where: { organization_id: organizationId, date: { [Op.between]: [today.format("YYYY-MM-DD"), today.clone().add(7, "days").format("YYYY-MM-DD")] } } });
    const due = holidays.map((holiday) => ({ holiday, days: moment(holiday.date).startOf("day").diff(today, "days") })).filter(({ days }) => [1, 7].includes(days));
    if (!due.length) continue;
    const memberships = await OrganizationMembership.findAll({ where: { organization_id: organizationId, status: "active" }, attributes: ["user_id"] });
    for (const { user_id } of memberships) {
      created += await sequelize.transaction(async (transaction) => {
        // Serialize each recipient's reminder dedupe with membership changes and
        // concurrent ticks, then recheck active profile, identity and HR role.
        const user = await lockJobMember(organizationId, user_id, transaction);
        if (!user) return 0;
        let count = 0;
        for (const { holiday, days } of due) {
          const title = `Holiday in ${days} day${days === 1 ? "" : "s"}`;
          const message = `${holiday.name} is on ${holiday.date}${holiday.region ? ` for ${holiday.region}` : ""}.`;
          const where = { organization_id: organizationId, user_id, title, message };
          // The membership lock above serializes this dedupe. Avoid Sequelize's
          // findOrCreate savepoint: notification afterCommit hooks must attach to
          // the outer transaction so delivery runs after the reminder commits.
          if (!await Notification.findOne({ where, transaction })) {
            const notification = await Notification.create({ ...where, type: "info", action_url: personalFeaturePath(user, "holidays"), metadata: { organization_id: organizationId, holiday_id: holiday.holiday_id, reminder_days: days } }, { transaction });
            if (notification) count++;
          }
        }
        return count;
      });
    }
  }
  return created;
}
const sendUpcomingHolidayNotifications = async () => {
  if (peekTenantContext() || process.env.TENANCY_ENFORCED === "true") return sendTenantHolidayNotifications();
  const today = moment().startOf("day");
  const holidays = await Holiday.findAll({
    where: { date: { [Op.between]: [today.format("YYYY-MM-DD"), today.clone().add(7, "days").format("YYYY-MM-DD")] } },
  });
  const due = holidays.map((holiday) => ({ holiday, days: moment(holiday.date).startOf("day").diff(today, "days") })).filter(({ days }) => [1, 7].includes(days));
  if (!due.length) return 0;
  const users = await User.findAll({ where: { is_active: true }, attributes: ["user_id", "role_id"], include: [ROLE_INCLUDE] });
  let created = 0;
  for (const { holiday, days } of due) {
    const title = `Holiday in ${days} day${days === 1 ? "" : "s"}`;
    const message = `${holiday.name} is on ${holiday.date}${holiday.region ? ` for ${holiday.region}` : ""}.`;
    for (const user of users) {
      const [, wasCreated] = await Notification.findOrCreate({
        where: { user_id: user.user_id, title, message },
        defaults: { user_id: user.user_id, title, message, type: "info", action_url: personalFeaturePath(user, "holidays"), metadata: { holiday_id: holiday.holiday_id, reminder_days: days } },
      });
      if (wasCreated) created += 1;
    }
  }
  return created;
};

const startHolidayNotificationScheduler = () => {
  sendUpcomingHolidayNotifications().catch((error) => console.error("Holiday reminder check failed:", error.message));
  const interval = setInterval(() => {
    sendUpcomingHolidayNotifications().catch((error) => console.error("Holiday reminder check failed:", error.message));
  }, 24 * 60 * 60 * 1000);
  interval.unref();
};

module.exports = { sendUpcomingHolidayNotifications, startHolidayNotificationScheduler };
