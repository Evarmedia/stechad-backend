// Isolated local fixture for browser verification. Never uses the application database.
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const { Sequelize } = require("sequelize");
const url = process.env.WORKFORCE_TEST_DATABASE_URL;
if (!url) throw new Error("WORKFORCE_TEST_DATABASE_URL is required for the isolated preview");
const schema = `feature_preview_${randomUUID().replaceAll("-", "")}`;
const db = new Sequelize(url, { schema, logging: false }); db.schema = schema;
db.afterDefine((model) => { model.options.schema = schema; });
const path = require.resolve("../../config/database"); require.cache[path] = { id: path, filename: path, loaded: true, exports: db };
const mail = require.resolve("../../utils/sendEmail"); require.cache[mail] = { id: mail, filename: mail, loaded: true, exports: async () => {} };
process.env.GOOGLE_CLIENT_ID = "local-test"; process.env.GOOGLE_CLIENT_SECRET = "local-test";
process.env.JWT_SECRET = randomUUID(); process.env.JWT_REFRESH_SECRET = randomUUID();
const models = require("../../models");
const express = require("express");
const http = require("node:http");
const { Server } = require("socket.io");
let server, io;
async function start() {
  await db.createSchema(schema); await db.sync();
  await require("../../migrations/20261119090000-user-management").up(db.getQueryInterface(), Sequelize);
  await require("../../migrations/20261119110000-custom-role-permissions").up(db.getQueryInterface(), Sequelize);
  require("../../utils/audit").installAuditing(models);
  require("../../utils/zohoService").isConfigured = () => false;
  const roles = {};
  for (const role_key of ["super_admin", "admin", "project_manager", "staff", "talent", "custom"]) roles[role_key] = await models.Role.create({ role_key, name: role_key.replaceAll("_", " "), is_system: role_key !== "custom" });
  const users = {};
  for (const [key, role] of Object.entries({ admin: "admin", superadmin: "super_admin", custom: "custom", staff: "staff", delegated: "staff", pm: "project_manager", talent: "talent", deleted: "staff" })) {
    const user = await models.User.create({ email: `${key}@example.test`, first_name: key[0].toUpperCase() + key.slice(1), last_name: "Preview", role_id: roles[role].role_id, password: "Feature-test-123", employee_id: `TEST-${key.toUpperCase()}`, workforce_permissions: key === "delegated" ? ["create_projects", "manage_staff", "manage_departments", "manage_kpis"] : [], notification_sound_enabled: true });
    if (["admin", "super_admin"].includes(role)) await models.Admin.create({ user_id: user.user_id, is_super_admin: role === "super_admin" });
    if (role === "project_manager") await models.ProjectManager.create({ user_id: user.user_id, status: "active" });
    if (role === "talent") await models.Talent.create({ user_id: user.user_id, is_onboarded: true });
    users[key] = { id: user.user_id, email: user.email, role };
  }
  await models.User.update({ reports_to_user_id: users.superadmin.id, reporting_manager_mode: "override" }, { where: { user_id: users.custom.id } });
  await models.Department.create({ name: "Executive", code: "EXEC", manager_user_id: users.superadmin.id });
  const department = await models.Department.create({ name: "Engineering", code: "ENG", manager_user_id: users.admin.id });
  await models.User.update({ department_id: department.department_id, reports_to_user_id: users.admin.id }, { where: { user_id: users.staff.id } });
  const approvals = {};
  for (const [key, category, status] of [["expense", "Travel", "pending"], ["receipt", "Equipment", "approved"]]) {
    const claim = await models.ExpenseClaim.create({ user_id: users.delegated.id, category, amount: 25, expense_date: "2026-11-19", status, description: "Local approval workflow verification" });
    approvals[key] = claim.expense_claim_id;
  }
  const invoice = await models.Invoice.create({ submitted_by: users.delegated.id, invoice_number: "PREVIEW-INVOICE", invoice_type: "staff", period: "November 2026", amount: 50 });
  approvals.invoice = invoice.invoice_id;
  const clockIn = new Date(); clockIn.setDate(clockIn.getDate() - 1); clockIn.setHours(9, 0, 0, 0);
  await models.Attendance.create({ user_id: users.staff.id, work_date: clockIn.toISOString().slice(0, 10), clock_in: clockIn, clock_out: new Date(clockIn.getTime() + 8 * 3600000), status: "completed", clock_out_source: "manual", work_log: "Reviewed implementation and completed assigned work." });
  await models.Attendance.create({ user_id: users.admin.id, work_date: clockIn.toISOString().slice(0, 10), clock_in: clockIn, auto_clock_out_at: new Date(clockIn.getTime() + 8 * 3600000) });
  await require("../../migrations/20261119100000-admin-workflow-simplification").up(db.getQueryInterface());
  await require("../../utils/userLifecycle").deleteUser(users.deleted.id, await models.User.findByPk(users.admin.id));
  const app = express(); app.use(require("cors")({ origin: "http://127.0.0.1:58087" })); app.use(express.json()); app.use(require("../../utils/audit").auditContext);
  for (const name of ["auth", "admin", "staff", "project", "notification", "talent", "pm", "chat", "jobs", "application", "interview", "referral", "analytics", "export"]) {
    const path = { project: "projects", notification: "notifications", talent: "talents", application: "applications", interview: "interviews", referral: "referrals" }[name] || name;
    app.use(`/api/${path}`, require(`../../routes/${name}Routes`));
  }
  app.use("/api/workforce/management", require("../../routes/managementRoutes"));
  server = http.createServer(app); io = new Server(server, { cors: { origin: "http://127.0.0.1:58087" } }); app.set("io", io);
  require("../../utils/events").setRealtime(io); require("../../utils/chatSocket").initializeChatSocket(io);
  server.listen(55040, "127.0.0.1", () => { fs.writeFileSync("/tmp/stechad-feature-preview.json", JSON.stringify({ pid: process.pid, schema, users, approvals, origin: "http://127.0.0.1:55040", password: "Feature-test-123" })); console.log("Isolated feature preview ready on port 55040"); });
}
async function stop() { if (io) await new Promise((resolve) => io.close(resolve)); try { await db.dropSchema(schema, { cascade: true }); } finally { await db.close(); process.exit(0); } }
process.on("SIGTERM", stop); process.on("SIGINT", stop);
start().catch(async (error) => { console.error(error); await stop(); });
