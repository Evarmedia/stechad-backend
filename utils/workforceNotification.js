const path = require("path");
const { Op } = require("sequelize");
const { User, Notification } = require("../models");
const { hasPermission } = require("../middleware/auth");
const sendEmail = require("./sendEmail");

const notifyPermissionHolders = async ({ permissionKey, title, message, actionUrl = "/", metadata = {} }) => {
  const users = await User.findAll({
    where: { is_active: true, role: { [Op.in]: ["staff", "project_manager", "admin", "super_admin"] } },
    attributes: ["user_id", "email", "role", "workforce_permissions"],
  });
  const checks = await Promise.all(users.map(async (user) => ({ user, allowed: await hasPermission(user, permissionKey) })));
  const recipients = checks.filter((entry) => entry.allowed).map((entry) => entry.user);
  if (!recipients.length) return [];
  const notifications = await Notification.bulkCreate(recipients.map((user) => ({ user_id: user.user_id, title, message, type: "info", action_url: actionUrl, metadata })));
  const frontendUrl = process.env.NODE_ENV === "production" ? process.env.FRONTEND_PROD_URL : process.env.FRONTEND_URL;
  setImmediate(() => {
    Promise.allSettled(recipients.map((user) => sendEmail({
      to: user.email,
      subject: title,
      htmlFilePath: path.join(__dirname, "../templates/workforceNotification.html"),
      replacements: { title, message, url: `${frontendUrl || ""}${actionUrl}` },
    }))).then((results) => {
      const failures = results.filter((result) => result.status === "rejected").length;
      if (failures) console.error(`Failed to email ${failures} workforce notification recipient(s)`);
    });
  });
  return notifications;
};

module.exports = { notifyPermissionHolders };
