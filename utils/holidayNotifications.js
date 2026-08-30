const moment = require("moment");
const { Op } = require("sequelize");
const { Holiday, User, Notification } = require("../models");

const sendUpcomingHolidayNotifications = async () => {
  const today = moment().startOf("day");
  const holidays = await Holiday.findAll({
    where: { date: { [Op.between]: [today.format("YYYY-MM-DD"), today.clone().add(7, "days").format("YYYY-MM-DD")] } },
  });
  const due = holidays.map((holiday) => ({ holiday, days: moment(holiday.date).startOf("day").diff(today, "days") })).filter(({ days }) => [1, 7].includes(days));
  if (!due.length) return 0;
  const users = await User.findAll({ where: { is_active: true, role: { [Op.in]: ["engineer", "project_manager", "staff", "admin", "super_admin"] } }, attributes: ["user_id"] });
  let created = 0;
  for (const { holiday, days } of due) {
    const title = `Holiday in ${days} day${days === 1 ? "" : "s"}`;
    const message = `${holiday.name} is on ${holiday.date}${holiday.region ? ` for ${holiday.region}` : ""}.`;
    for (const user of users) {
      const [, wasCreated] = await Notification.findOrCreate({
        where: { user_id: user.user_id, title, message },
        defaults: { user_id: user.user_id, title, message, type: "info", action_url: "/dashboard/staff/holidays", metadata: { holiday_id: holiday.holiday_id, reminder_days: days } },
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
