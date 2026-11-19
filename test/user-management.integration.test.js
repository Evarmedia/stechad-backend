const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { once } = require("node:events");
const url = process.env.WORKFORCE_TEST_DATABASE_URL;
if (!url) {
  test("PostgreSQL workforce integration (set WORKFORCE_TEST_DATABASE_URL)", { skip: true }, () => {});
} else {
  const { Sequelize, Op } = require("sequelize");
  const schema = `workforce_${randomUUID().replaceAll("-", "")}`;
  const db = new Sequelize(url, { schema, logging: false, pool: { max: 8 } });
  db.schema = schema;
  db.afterDefine((model) => { model.options.schema = schema; });
  const path = require.resolve("../config/database");
  require.cache[path] = { id: path, filename: path, loaded: true, exports: db };
  const mail = require.resolve("../utils/sendEmail");
  const sentEmails = [];
  require.cache[mail] = { id: mail, filename: mail, loaded: true, exports: async (message) => { sentEmails.push(message); } };
  process.env.GOOGLE_CLIENT_ID = "test"; process.env.GOOGLE_CLIENT_SECRET = "test";
  process.env.JWT_SECRET = randomUUID(); process.env.JWT_REFRESH_SECRET = randomUUID();
  const models = require("../models");
  const { User, Role, RolePermission, Department, Attendance, Project, Talent, Notification, AuditLog, Invite } = models;
  const { generateTokens } = require("../utils/generateTokens");
  const { catalog } = require("../utils/permissions");
  const { setRealtime } = require("../utils/events");
  const { auditContext, installAuditing } = require("../utils/audit");
  const { getWorkforceMoment, autoClockOutDeadline, isAfterAutoClockOut, reconcileUnclosedAttendance } = require("../utils/attendanceScheduler");
  const { reportingUpdates, lockHierarchy } = require("../utils/reporting");
  const express = require("express");
  const http = require("node:http");
  const { Server } = require("socket.io");
  const { io: socketClient } = require("socket.io-client");
  let server, io, origin, admin, staff, other, superAdmin;
  const sockets = new Set();
  const token = (user) => generateTokens({ user_id: user.user_id, role: user.role?.role_key, session_version: user.session_version }).token;
  const request = async (path, method = "GET", body, who = admin) => {
    const response = await fetch(`${origin}/api/${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${typeof who === "string" ? who : token(who)}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, ...await response.json() };
  };
  const createUser = async (role = "staff", extra = {}) => User.create({ email: `${randomUUID()}@example.test`, first_name: "Test", last_name: role, role_id: (await Role.findOne({ where: { role_key: role } })).role_id, password: "valid-password", ...extra });
  const loadUser = (id) => User.findByPk(id);
  const setReporting = async (user, updates) => db.transaction(async (transaction) => { await lockHierarchy(transaction); await user.update(await reportingUpdates(user, updates, transaction), { transaction }); });
  before(async () => {
    await db.createSchema(schema); await db.sync();
    await require("../migrations/20261119090000-user-management").up(db.getQueryInterface(), Sequelize);
    installAuditing(models);
    for (const role_key of ["super_admin", "admin", "project_manager", "staff", "talent"]) await Role.create({ role_key, name: role_key, is_system: true });
    for (const permission of catalog) await RolePermission.findOrCreate({ where: { permission_key: permission.permission_key }, defaults: permission });
    admin = await createUser("admin"); staff = await createUser(); other = await createUser(); superAdmin = await createUser("super_admin");
    await models.Admin.create({ user_id: admin.user_id });
    const app = express(); app.use(express.json()); app.use(auditContext);
    for (const name of ["auth", "admin", "staff", "project", "notification"]) app.use(`/api/${name === "project" ? "projects" : name === "notification" ? "notifications" : name}`, require(`../routes/${name}Routes`));
    app.use("/api/workforce/management", require("../routes/managementRoutes"));
    server = http.createServer(app); io = new Server(server); app.set("io", io); setRealtime(io);
    require("../utils/chatSocket").initializeChatSocket(io);
    server.listen(0, "127.0.0.1"); await once(server, "listening"); origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { for (const socket of sockets) socket.disconnect(); if (io) await new Promise((resolve) => io.close(resolve)); else if (server) await new Promise((resolve) => server.close(resolve)); setRealtime(null); await db.dropSchema(schema, { cascade: true }); await db.close(); });

  test("legacy role bootstrap upgrades before model reads and repeated startup preserves configured access", async () => {
    const settings = (await RolePermission.findAll()).map((row) => [row.permission_key, row.admin, row.project_manager, row.staff]);
    await db.getQueryInterface().removeColumn({ tableName: "roles", schema }, "permission_keys");
    const { migrateRoleStorage } = require("../utils/roleMigration");
    await migrateRoleStorage(); await migrateRoleStorage();
    assert.deepEqual((await loadUser(staff.user_id)).role.permission_keys, []);
    assert.deepEqual((await RolePermission.findAll()).map((row) => [row.permission_key, row.admin, row.project_manager, row.staff]), settings);
    assert.equal(await User.count({ where: { "$role.role_key$": "super_admin" } }), 1);
    await assert.rejects(createUser("super_admin"), /Validation error/);
  });
  test("directories exclude Super Admin and talents before filtering, pagination and counts, without hiding reporting or audits", async () => {
    const customRole = await Role.create({ role_key: `directory_${randomUUID().replaceAll("-", "")}`, name: `Directory ${randomUUID()}` });
    const retainedPm = await models.ProjectManager.create({ user_id: superAdmin.user_id });
    const retainedTalent = await Talent.create({ user_id: superAdmin.user_id });
    const employee = await createUser(customRole.role_key, { date_of_birth: getWorkforceMoment().format("MM-DD"), reports_to_user_id: superAdmin.user_id, reporting_manager_mode: "override" });
    const talent = await createUser("talent");
    await superAdmin.update({ date_of_birth: getWorkforceMoment().format("MM-DD") });
    for (const who of [admin, superAdmin]) {
      for (const query of ["", "?status=all&limit=100", "?status=active", "?status=inactive", "?status=deleted", `?search=${encodeURIComponent(superAdmin.email)}`, "?role=super_admin", "?role=talent"]) {
        const directory = await request(`admin/users${query}`, "GET", undefined, who);
        assert.equal(directory.status, 200); assert.ok(directory.data.users.every((user) => !["talent", "super_admin"].includes(user.role)));
        assert.ok(directory.data.roles.every((role) => !["talent", "super_admin"].includes(role.role_key)));
      }
      const everyone = await User.findAll({ paranoid: false });
      const eligible = everyone.filter((user) => !["talent", "super_admin"].includes(user.role.role_key));
      const singlePage = await request("admin/users?limit=1&status=all", "GET", undefined, who);
      assert.equal(singlePage.data.users.length, 1); assert.equal(singlePage.data.pagination.totalItems, eligible.length);
      assert.equal(singlePage.data.counts.totalUsers, eligible.filter((user) => !user.deleted_at).length);
      assert.equal(singlePage.data.counts.deletedUsers, eligible.filter((user) => user.deleted_at).length);
      assert.equal((await request(`admin/project-managers/${retainedPm.project_managers_id}`, "GET", undefined, who)).status, 404);
      assert.equal((await request(`admin/talents/${retainedTalent.talent_id}`, "GET", undefined, who)).status, 404);
      const managers = await request("admin/project-managers", "GET", undefined, who);
      assert.ok(managers.data.projectManagers.every((manager) => manager.user_id !== superAdmin.user_id && manager.user?.user_id !== superAdmin.user_id));
      const workforce = await request("admin/workforce", "GET", undefined, who);
      assert.ok(workforce.data.staff.every((user) => ![superAdmin.user_id, talent.user_id].includes(user.id)));
      assert.equal(workforce.data.staff.find((user) => user.id === employee.user_id).managerId, superAdmin.user_id);
      assert.ok(workforce.data.roles.some((role) => role.role_id === customRole.role_id));
      for (const [path, method, body] of [[`admin/users/${superAdmin.user_id}/attendance`, "GET"], [`admin/users/${superAdmin.user_id}`, "DELETE"], [`admin/users/${superAdmin.user_id}/restore`, "POST", {}], [`admin/users/${superAdmin.user_id}/employee-id`, "PUT", { employee_id: "FORGED" }], [`admin/users/${superAdmin.user_id}/permissions`, "PUT", { workforce_permissions: [] }], [`admin/workforce/users/${superAdmin.user_id}`, "PUT", { is_active: false }], [`workforce/management/users/${superAdmin.user_id}`, "PUT", { job_title: "FORGED" }]]) assert.equal((await request(path, method, body, who)).status, 404, path);
      assert.equal((await request(`workforce/management/users/${employee.user_id}`, "PUT", { job_title: `Preserve manager ${who.user_id}` }, who)).status, 200);
      assert.equal((await loadUser(employee.user_id)).reports_to_user_id, superAdmin.user_id);
    }
    const delegate = await createUser("staff", { workforce_permissions: ["manage_staff"] });
    const list = await request("workforce/management/users", "GET", undefined, delegate);
    assert.ok(list.data.every((user) => !["super_admin", "talent"].includes(user.role)));
    assert.equal((await request(`workforce/management/users/${superAdmin.user_id}`, "PUT", { job_title: "FORGED" }, delegate)).status, 404);
    assert.equal((await request("admin/departments", "POST", { name: "Forbidden manager", code: randomUUID(), manager_user_id: superAdmin.user_id })).status, 404);
    const existingDepartment = await Department.create({ name: "Existing executive", code: randomUUID(), manager_user_id: superAdmin.user_id });
    assert.equal((await request(`admin/departments/${existingDepartment.department_id}`, "PUT", { name: "Existing executive updated", manager_user_id: superAdmin.user_id })).status, 200);
    await existingDepartment.reload(); assert.equal(existingDepartment.manager_user_id, superAdmin.user_id);
    const birthdays = await request("staff/birthdays", "GET", undefined, employee);
    assert.equal(birthdays.status, 200); assert.ok(!JSON.stringify(birthdays.data).includes(superAdmin.user_id)); assert.ok(JSON.stringify(birthdays.data).includes(employee.user_id));
    const me = await request("auth/me", "GET", undefined, superAdmin); assert.equal(me.status, 200); assert.equal(me.data.user.user_id, superAdmin.user_id);
    const log = await AuditLog.findOne({ where: { actor_user_id: superAdmin.user_id } }); assert.ok(log);
    assert.ok((await request(`admin/audit-logs?actor_user_id=${superAdmin.user_id}`)).data.logs.some((row) => row.actor_user_id === superAdmin.user_id));
  });
  test("custom role permission APIs preserve individual grants and notify active sessions after committed changes", async () => {
    const payload = { name: `Finance ${randomUUID()}`, permission_keys: ["create_project", "approve_leave"] };
    assert.equal((await request("admin/roles", "POST", payload)).status, 403);
    const created = await request("admin/roles", "POST", payload, superAdmin); assert.equal(created.status, 201);
    const role = created.data; assert.deepEqual(role.permission_keys, ["create_projects", "approve_leave"]);
    const member = await createUser(role.role_key, { workforce_permissions: ["verify_receipts"] });
    const me = await request("auth/me", "GET", undefined, member); assert.deepEqual(new Set(me.data.user.effective_permissions), new Set(["create_projects", "approve_leave", "verify_receipts"]));
    assert.equal(me.data.user.role_details.name, role.name);
    const catalogResponse = await request("admin/roles", "GET", undefined, superAdmin); assert.ok(Array.isArray(catalogResponse.data)); assert.ok(catalogResponse.permission_catalog.some((permission) => permission.permission_key === "create_projects"));
    const before = await Role.findByPk(role.role_id);
    for (const invalid of [["unknown_permission"], "create_projects", ["*"]]) assert.equal((await request(`admin/roles/${role.role_id}`, "PUT", { permission_keys: invalid }, superAdmin)).status, 400);
    assert.deepEqual((await Role.findByPk(role.role_id)).permission_keys, before.permission_keys);
    const socket = socketClient(origin, { auth: { token: token(member) }, transports: ["websocket"], reconnection: false }); sockets.add(socket); await once(socket, "connect");
    const updated = once(socket, "account_updated", { signal: AbortSignal.timeout(5000) });
    assert.equal((await request(`admin/roles/${role.role_id}`, "PUT", { name: `${role.name} renamed`, permission_keys: [] }, superAdmin)).status, 200); await updated;
    const refreshed = await request("auth/me", "GET", undefined, member); assert.deepEqual(refreshed.data.user.effective_permissions, ["verify_receipts"]); assert.equal(refreshed.data.user.role_details.name, `${role.name} renamed`);
    assert.equal((await request("projects", "POST", { title: "Revoked role" }, member)).status, 403);
    assert.equal((await request(`admin/roles/${role.role_id}`, "DELETE", undefined, superAdmin)).status, 409);
    assert.equal((await request(`admin/roles/${(await Role.findOne({ where: { role_key: "staff" } })).role_id}`, "PUT", { permission_keys: ["create_projects"] }, superAdmin)).status, 409);
    assert.ok((await AuditLog.findAll({ where: { target_id: role.role_id } })).some((entry) => entry.changes.permission_keys));
    socket.disconnect();
  });
  test("custom roles support invitations, assignment, employee APIs, KPIs, birthdays, notifications and staff contact rules", async () => {
    const role = await Role.create({ name: `Operations ${randomUUID()}`, role_key: `operations_${randomUUID().replaceAll("-", "")}`, permission_keys: ["manage_kpis", "create_projects"] });
    const email = `${randomUUID()}@example.test`;
    const invited = await request("admin/workforce/invite", "POST", { email, first_name: "Custom", last_name: "Invite", role_id: role.role_id }); assert.equal(invited.status, 201);
    const invite = await Invite.findOne({ where: { email } });
    assert.equal((await request(`auth/accept-invite/${invite.token}`, "POST", { new_password: "Custom-pass-123", confirm_password: "Custom-pass-123" })).status, 201);
    const login = await request("auth/login", "POST", { email, password: "Custom-pass-123" }); assert.equal(login.status, 200); assert.equal(login.data.user.role, role.role_key); assert.equal(login.data.user.role_details.name, role.name);
    const member = await User.findOne({ where: { email } });
    for (const path of ["staff/dashboard", "staff/attendance", "staff/leave", "staff/kpis", "staff/holidays", "staff/profile"]) assert.equal((await request(path, "GET", undefined, member)).status, 200, path);
    const dashboard = await request("staff/dashboard", "GET", undefined, member); assert.equal(dashboard.data.permissions.find((permission) => permission.key === "create_projects").allowed, true);
    assert.equal((await request("admin/users", "GET", undefined, member)).status, 403);
    const kpi = await request("workforce/management/kpis", "POST", { assigned_to_user_id: member.user_id, title: "Custom role target", criteria: [{ id: "quality", title: "Quality" }] }, member); assert.equal(kpi.status, 201);
    assert.ok((await request("staff/kpis", "GET", undefined, member)).data.some((item) => item.id === kpi.data.kpi_id));
    const note = await Notification.findOne({ where: { user_id: member.user_id, title: "New KPI assigned" } }); assert.equal(note.action_url, "/dashboard/staff/kpis");
    const holiday = await request("admin/holidays", "POST", { name: "Custom role holiday", date: getWorkforceMoment().add(1, "day").format("YYYY-MM-DD") }); assert.equal(holiday.status, 201);
    assert.ok(await Notification.findOne({ where: { user_id: member.user_id, title: "Holiday calendar updated", action_url: "/dashboard/staff/holidays" } }));
    await require("../utils/holidayNotifications").sendUpcomingHolidayNotifications(); assert.ok(await Notification.findOne({ where: { user_id: member.user_id, title: "Holiday in 1 day" } }));
    const policy = require("../utils/chatPolicy"); const contacts = await User.findAll({ where: await policy.contactFilter(member.user_id) }); assert.ok(contacts.some((user) => user.user_id === staff.user_id));
    await assert.rejects(policy.contactFilter(member.user_id, "group"), /Only admins and PMs/);
    assert.ok((await User.findAll({ where: await policy.contactFilter(staff.user_id) })).some((user) => user.user_id === member.user_id));
    assert.equal((await request(`admin/workforce/users/${member.user_id}`, "PUT", { role: "project_manager" })).status, 200); assert.ok(await models.ProjectManager.findOne({ where: { user_id: member.user_id } }));
    assert.equal((await request(`admin/workforce/users/${member.user_id}`, "PUT", { role_id: role.role_id, is_active: false })).status, 200);
    assert.equal((await request("auth/me", "GET", undefined, member)).status, 401);
    assert.equal((await request(`admin/workforce/users/${member.user_id}`, "PUT", { is_active: true })).status, 200);
    assert.equal((await request("projects", "POST", { title: "Custom after PM", project_manager_id: randomUUID() }, await loadUser(member.user_id))).status, 403);
    const actual = await loadUser(member.user_id); assert.equal(actual.role.role_key, role.role_key);
    assert.equal((await request(`admin/workforce/users/${superAdmin.user_id}`, "PUT", { role_id: role.role_id })).status, 404);
  });
  test("creator project actions enforce ownership, field limits, revocation and all deletion statuses", async () => {
    const creator = await createUser("staff", { workforce_permissions: ["create_project"] });
    for (const status of ["planning", "on_hold", "cancelled", "in_progress", "completed"]) {
      const own = await Project.create({ title: `Creator ${status}`, status, created_by_user_id: creator.user_id });
      const edited = await request(`projects/${own.projects_id}`, "PUT", { title: "Updated", priority: "high", deadline: "2026-12-31" }, creator); assert.equal(edited.status, 200);
      for (const body of [{ created_by_user_id: other.user_id }, { status: "cancelled" }, { project_manager_id: randomUUID() }, { talent_ids: [] }, { progress: 100 }]) assert.equal((await request(`projects/${own.projects_id}`, "PUT", body, creator)).status, 403);
      assert.equal((await request(`projects/${own.projects_id}`, "PUT", { title: " " }, creator)).status, 400);
      assert.equal((await request(`projects/${own.projects_id}`, "DELETE", undefined, creator)).status, ["planning", "on_hold", "cancelled"].includes(status) ? 200 : 400);
    }
    const privateProject = await Project.create({ title: "Other creator", created_by_user_id: other.user_id });
    for (const method of ["GET", "PUT", "DELETE"]) assert.equal((await request(`projects/${privateProject.projects_id}`, method, method === "PUT" ? { title: "Forbidden" } : undefined, creator)).status, 403);
    const unowned = await Project.create({ title: "Legacy without creator" });
    assert.equal((await request(`projects/${unowned.projects_id}`, "DELETE", undefined, creator)).status, 403);
    const list = await request("projects?created_by_me=true", "GET", undefined, creator); assert.ok(list.data.projects.every((project) => project.created_by_user_id === creator.user_id));
    const adminList = await request("projects?created_by_me=true"); assert.ok(adminList.data.projects.every((project) => project.created_by_user_id === admin.user_id));
    assert.equal((await request("projects?created_by_me=invalid", "GET", undefined, creator)).status, 400);
    const pending = await Project.create({ title: "Revoke creator", created_by_user_id: creator.user_id });
    await creator.update({ workforce_permissions: [] });
    assert.equal((await request(`projects/${pending.projects_id}`, "PUT", { title: "Revoked" }, creator)).status, 403); assert.equal((await request(`projects/${pending.projects_id}`, "DELETE", undefined, creator)).status, 403);
    assert.equal((await request(`projects/${pending.projects_id}`, "DELETE")).status, 200);
    const pm = await createUser("project_manager"); const pmProfile = await models.ProjectManager.create({ user_id: pm.user_id });
    const pmProject = await Project.create({ title: "PM ownership", project_managers_id: pmProfile.project_managers_id });
    assert.equal((await request(`projects/${pmProject.projects_id}`, "PUT", { progress: 50 }, pm)).status, 200); assert.equal((await request(`projects/${pmProject.projects_id}`, "DELETE", undefined, pm)).status, 200);
    const talent = await createUser("talent"), talentProfile = await Talent.create({ user_id: talent.user_id }); const talentProject = await Project.create({ title: "Talent assigned" }); await talentProject.addTalent(talentProfile);
    assert.equal((await request(`projects/${talentProject.projects_id}`, "PUT", { progress: 50 }, talent)).status, 200); assert.equal((await request(`projects/${talentProject.projects_id}`, "DELETE", undefined, talent)).status, 403);
  });
  test("project deletion and state updates serialize their checks", async (t) => {
    const creator = await createUser("staff", { workforce_permissions: ["create_projects"] });
    const project = await Project.create({ title: "Concurrent project", created_by_user_id: creator.user_id });
    let release; const hold = new Promise((resolve) => { release = resolve; }); let ready; const started = new Promise((resolve) => { ready = resolve; });
    const change = db.transaction(async (transaction) => { await lockHierarchy(transaction); await project.update({ status: "in_progress" }, { transaction }); ready(); await hold; });
    await started; const deletion = request(`projects/${project.projects_id}`, "DELETE", undefined, creator); release(); await change;
    assert.equal((await deletion).status, 400); assert.ok(await Project.findByPk(project.projects_id));
    const waitingProject = await Project.create({ title: "Revoke queued deletion", created_by_user_id: creator.user_id });
    let unblock, locked, authenticated;
    const wait = new Promise((resolve) => { unblock = resolve; });
    const acquired = new Promise((resolve) => { locked = resolve; });
    const observedAuth = new Promise((resolve) => { authenticated = resolve; });
    const holder = db.transaction(async (transaction) => { await lockHierarchy(transaction); locked(); await wait; });
    await acquired;
    const findUser = User.findByPk.bind(User);
    t.mock.method(User, "findByPk", (id, options) => {
      const result = findUser(id, options);
      if (id === creator.user_id && !options?.transaction) void result.then(authenticated);
      return result;
    });
    const queued = request(`projects/${waitingProject.projects_id}`, "DELETE", undefined, creator);
    await observedAuth; await creator.update({ workforce_permissions: [] }); unblock(); await holder;
    assert.equal((await queued).status, 403); assert.ok(await Project.findByPk(waitingProject.projects_id));
  });
  test("approval-only PM, staff and custom users receive only granted queues and cannot read workforce lookup data", async () => {
    const leave = await models.LeaveRequest.create({ user_id: other.user_id, leave_type: "Annual", start_date: "2026-12-01", end_date: "2026-12-01" });
    const pending = await models.ExpenseClaim.create({ user_id: other.user_id, category: "Travel", amount: 12, expense_date: "2026-11-19" });
    const approved = await models.ExpenseClaim.create({ user_id: other.user_id, category: "Equipment", amount: 24, expense_date: "2026-11-19", status: "approved" });
    const invoice = await models.Invoice.create({ submitted_by: other.user_id, invoice_number: randomUUID(), invoice_type: "staff", period: "November", amount: 36 });
    const custom = await Role.create({ role_key: `approval_${randomUUID()}`, name: "Approval-only custom", is_system: false });
    for (const role of ["project_manager", "staff", custom.role_key]) {
      const user = await createUser(role);
      assert.equal((await request("staff/approvals", "GET", undefined, user)).status, 403);
      for (const [permission, ids, type, forbiddenType, forbiddenId, forbiddenAction] of [
        ["approve_leave", [leave.leave_request_id], "leave", "expense", pending.expense_claim_id, "approved"],
        ["approve_expenses", [pending.expense_claim_id], "expense", "expense", approved.expense_claim_id, "receipt_verified"],
        ["verify_receipts", [approved.expense_claim_id], "expense", "expense", pending.expense_claim_id, "approved"],
        ["approve_invoices", [invoice.invoice_id], "invoice", "leave", leave.leave_request_id, "approved"],
      ]) {
        await user.update({ workforce_permissions: [permission] });
        const queue = await request("staff/approvals", "GET", undefined, user);
        assert.equal(queue.status, 200); assert.ok(ids.every((id) => queue.data.some((item) => item.id === id)));
        assert.ok(queue.data.every((item) => item.type === type));
        if (permission === "verify_receipts") assert.ok(queue.data.every((item) => item.actions.every((action) => action === "receipt_verified")));
        if (permission === "approve_expenses") assert.ok(queue.data.every((item) => !item.actions.includes("receipt_verified")));
        for (const path of ["workforce/management/users", "workforce/management/departments", "workforce/management/kpis"]) assert.equal((await request(path, "GET", undefined, user)).status, 403);
        assert.equal((await request(`staff/approvals/${forbiddenType}/${forbiddenId}`, "PUT", { action: forbiddenAction }, user)).status, 403);
      }
      await user.update({ workforce_permissions: [] });
      assert.equal((await request("staff/approvals", "GET", undefined, user)).status, 403);
      assert.equal((await request(`staff/approvals/invoice/${invoice.invoice_id}`, "PUT", { action: "approved" }, user)).status, 403);
    }
    const setting = await RolePermission.findOne({ where: { permission_key: "approve_leave" } });
    const configured = setting.project_manager; const pm = await createUser("project_manager");
    try { await setting.update({ project_manager: true }); assert.equal((await request("staff/approvals", "GET", undefined, pm)).status, 200); }
    finally { await setting.update({ project_manager: configured }); }
  });
  test("approval actions preserve notes and notification/email links resolve through the new Workforce entry", async () => {
    const approver = await createUser("project_manager", { workforce_permissions: ["approve_leave", "approve_expenses", "verify_receipts", "approve_invoices"] });
    const submitted = await request("staff/leave", "POST", { leave_type: "Annual", start_date: "2026-12-02", end_date: "2026-12-02", reason: "Approval tab verification" }, other);
    assert.equal(submitted.status, 201);
    const notice = await Notification.findOne({ where: { user_id: approver.user_id, title: "New leave request" } });
    assert.equal(notice.action_url, "/approvals");
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(sentEmails.some((email) => email.to === approver.email && email.replacements?.url.endsWith("/approvals")));
    const leave = await models.LeaveRequest.findOne({ where: { user_id: other.user_id, reason: "Approval tab verification" } });
    assert.equal((await request(`staff/approvals/leave/${leave.leave_request_id}`, "PUT", { action: "approved", notes: "Approved in Workforce" }, approver)).status, 200);
    await leave.reload(); assert.equal(leave.review_notes, "Approved in Workforce"); assert.equal(leave.reviewed_by, approver.user_id);
    const rejected = await models.LeaveRequest.create({ user_id: other.user_id, leave_type: "Annual", start_date: "2026-12-03", end_date: "2026-12-03" });
    assert.equal((await request(`staff/approvals/leave/${rejected.leave_request_id}`, "PUT", { action: "rejected", notes: "Reschedule" }, approver)).status, 200);
    const claim = await models.ExpenseClaim.create({ user_id: other.user_id, category: "Travel", amount: 25, expense_date: "2026-11-19" });
    assert.equal((await request(`staff/approvals/expense/${claim.expense_claim_id}`, "PUT", { action: "approved" }, approver)).status, 200);
    assert.equal((await Notification.findOne({ where: { user_id: approver.user_id, title: "Expense approved for receipt verification" }, order: [["created_at", "DESC"]] })).action_url, "/approvals");
    assert.equal((await request(`staff/approvals/expense/${claim.expense_claim_id}`, "PUT", { action: "receipt_verified" }, approver)).status, 200);
    await claim.reload(); assert.equal(claim.accounts_verified_by, approver.user_id);
    const invoice = await models.Invoice.create({ submitted_by: other.user_id, invoice_number: randomUUID(), invoice_type: "staff", period: "November", amount: 50 });
    assert.equal((await request(`staff/approvals/invoice/${invoice.invoice_id}`, "PUT", { action: "accounts_approved" }, approver)).status, 409);
    assert.equal((await request(`staff/approvals/invoice/${invoice.invoice_id}`, "PUT", { action: "approved" }, approver)).status, 200);
    assert.equal((await request(`staff/approvals/invoice/${invoice.invoice_id}`, "PUT", { action: "accounts_approved" }, approver)).status, 200);
    assert.equal((await request(`staff/approvals/invoice/${invoice.invoice_id}`, "PUT", { action: "disputed" }, approver)).status, 409);
  });

  test("admin exemptions override grants and wildcard access while oversight and account preferences remain available", async () => {
    for (const user of [admin, superAdmin]) {
      for (const [path, method, body] of [["staff/attendance", "GET"], ["staff/attendance/clock-in", "POST", {}], ["staff/attendance/clock-out", "POST", { work_log: "Work" }], ["staff/expenses", "GET"], ["staff/expenses", "POST", {}]]) assert.equal((await request(path, method, body, user)).status, 403);
      for (const enabled of [true, false]) assert.equal((await request("auth/preferences", "PUT", { auto_clock_out_enabled: enabled }, user)).status, 403);
      assert.equal((await request("auth/preferences", "PUT", { notification_sound_enabled: false }, user)).status, 200);
      assert.equal((await request("admin/workforce", "GET", undefined, user)).status, 200);
      assert.equal((await request(`admin/users/${staff.user_id}/attendance`, "GET", undefined, user)).status, 200);
    }
    for (const role of ["staff", "project_manager"]) {
      const user = await createUser(role);
      assert.equal((await request("staff/attendance", "GET", undefined, user)).status, 200);
      assert.equal((await request("staff/expenses", "GET", undefined, user)).status, 200);
      assert.equal((await request("auth/preferences", "PUT", { auto_clock_out_enabled: true }, user)).status, 200);
    }
  });
  test("merged employment edits save Employee IDs atomically and support custom roles while excluding talents", async () => {
    const customRole = await Role.create({ role_key: `custom_${randomUUID()}`, name: "Custom workforce", is_system: false });
    const custom = await User.create({ email: `${randomUUID()}@example.test`, role_id: customRole.role_id });
    const talent = await createUser("talent");
    for (const who of [admin, superAdmin]) {
      const employee_id = `EMP-${randomUUID()}`;
      assert.equal((await request(`workforce/management/users/${custom.user_id}`, "PUT", { employee_id, job_title: "Custom specialist" }, who)).status, 200);
      const conflict = await request(`workforce/management/users/${other.user_id}`, "PUT", { employee_id, job_title: "Must roll back" }, who);
      assert.equal(conflict.status, 409); assert.notEqual((await loadUser(other.user_id)).job_title, "Must roll back");
      assert.equal((await request(`workforce/management/users/${talent.user_id}`, "PUT", { job_title: "Unavailable" }, who)).status, 400);
      assert.equal((await request(`admin/users/${talent.user_id}/employee-id`, "PUT", { employee_id: `T-${randomUUID()}` }, who)).status, 400);
    }
    await staff.update({ workforce_permissions: ["manage_staff"] });
    assert.equal((await request(`workforce/management/users/${custom.user_id}`, "PUT", { employee_id: "FORGED" }, staff)).status, 400);
    assert.equal((await request(`workforce/management/users/${custom.user_id}`, "PUT", { job_title: "Delegated edit" }, staff)).status, 200);
    assert.equal((await request(`workforce/management/users/${talent.user_id}`, "PUT", { job_title: "Unavailable" }, staff)).status, 400);
    const directory = await request("admin/workforce");
    assert.ok(directory.data.staff.some((row) => row.id === custom.user_id && row.employment.job_title === "Delegated edit"));
    assert.ok(!directory.data.staff.some((row) => row.id === talent.user_id));
    assert.equal((await request("workforce/management/users", "GET", undefined, staff)).data.some((row) => row.user_id === talent.user_id), false);
    await staff.update({ workforce_permissions: [] });
  });
  test("promotion cancels open attendance and disables deadlines without changing completed history", async () => {
    const user = await createUser("staff", { auto_clock_out_enabled: true, auto_clock_out_time: "17:00:00" });
    const open = await Attendance.create({ user_id: user.user_id, work_date: "2026-11-18", clock_in: new Date("2026-11-18T08:00Z"), auto_clock_out_at: new Date("2026-11-18T16:00Z") });
    const closed = await Attendance.create({ user_id: user.user_id, work_date: "2026-11-17", clock_in: new Date("2026-11-17T08:00Z"), clock_out: new Date("2026-11-17T16:00Z"), status: "completed", clock_out_source: "manual" });
    assert.equal((await request(`admin/workforce/users/${user.user_id}`, "PUT", { role: "admin" })).status, 200);
    const promoted = await loadUser(user.user_id); await open.reload(); await closed.reload();
    assert.equal(promoted.auto_clock_out_enabled, false); assert.equal(promoted.auto_clock_out_time, null);
    assert.equal(open.status, "cancelled"); assert.equal(open.clock_out, null); assert.equal(open.auto_clock_out_at, null); assert.equal(open.clock_out_source, null);
    assert.equal(closed.status, "completed"); assert.equal(closed.clock_out.toISOString(), "2026-11-17T16:00:00.000Z");
    await reconcileUnclosedAttendance("2026-11-19T18:00Z"); await open.reload(); assert.equal(open.status, "cancelled");
    assert.equal((await request(`admin/users/${user.user_id}/attendance?start_date=2026-11-01&end_date=2026-11-30&status=cancelled`)).data.entries.length, 1);
    const bulk = await createUser("staff", { auto_clock_out_enabled: true, auto_clock_out_time: "17:00:00" });
    const bulkEntry = await Attendance.create({ user_id: bulk.user_id, work_date: getWorkforceMoment().format("YYYY-MM-DD"), clock_in: getWorkforceMoment().startOf("day").hour(8).toDate(), auto_clock_out_at: autoClockOutDeadline() });
    await User.update({ role_id: admin.role_id }, { where: { user_id: bulk.user_id } });
    assert.equal((await loadUser(bulk.user_id)).auto_clock_out_enabled, false); await bulkEntry.reload(); assert.equal(bulkEntry.status, "cancelled");
    await User.update({ role_id: staff.role_id }, { where: { user_id: bulk.user_id } });
    assert.equal((await request("auth/preferences", "PUT", { auto_clock_out_enabled: true }, bulk)).status, 200);
    await bulkEntry.reload(); assert.equal(bulkEntry.auto_clock_out_at, null);
  });
  test("admin migration is repeatable and user-first scheduler locks protect concurrent promotions", async () => {
    const user = await createUser();
    const entry = await Attendance.create({ user_id: user.user_id, work_date: "2026-10-12", clock_in: new Date("2026-10-12T08:00Z"), auto_clock_out_at: new Date("2026-10-12T16:00Z") });
    await db.transaction(async (transaction) => {
      const locked = await User.findByPk(user.user_id, { transaction, lock: { level: transaction.LOCK.UPDATE, of: User } });
      await reconcileUnclosedAttendance("2026-10-12T16:01Z");
      await entry.reload({ transaction }); assert.equal(entry.clock_out, null);
      await locked.update({ role_id: admin.role_id }, { transaction });
    });
    await entry.reload(); assert.equal(entry.status, "cancelled");
    const legacy = await Attendance.create({ user_id: admin.user_id, work_date: "2026-10-13", clock_in: new Date("2026-10-13T08:00Z"), auto_clock_out_at: new Date("2026-10-13T16:00Z") });
    await db.query(`UPDATE "${schema}"."users" SET auto_clock_out_enabled = true, auto_clock_out_time = '17:00' WHERE user_id = :id`, { replacements: { id: admin.user_id } });
    const regular = await createUser("staff", { auto_clock_out_enabled: true, auto_clock_out_time: "17:00:00" });
    const regularEntry = await Attendance.create({ user_id: regular.user_id, work_date: "2026-10-13", clock_in: new Date("2026-10-13T08:00Z"), auto_clock_out_at: new Date("2026-10-13T16:00Z") });
    const migration = require("../migrations/20261119100000-admin-workflow-simplification");
    await migration.up(db.getQueryInterface()); await migration.up(db.getQueryInterface()); await migration.down(db.getQueryInterface());
    await legacy.reload(); assert.equal(legacy.status, "cancelled"); assert.equal(legacy.clock_out, null); assert.equal(legacy.auto_clock_out_at, null);
    await regularEntry.reload(); assert.equal(regularEntry.status, "present"); assert.ok(regularEntry.auto_clock_out_at); assert.equal((await loadUser(regular.user_id)).auto_clock_out_enabled, true);
    assert.equal((await loadUser(admin.user_id)).auto_clock_out_enabled, false);
    await reconcileUnclosedAttendance("2026-10-14T16:01Z"); await legacy.reload(); assert.equal(legacy.status, "cancelled");
  });

  test("REST and auth/me share effective grants, including the singular project alias and role revocation", async () => {
    assert.equal((await request("projects", "POST", { title: "Forbidden" }, staff)).status, 403);
    await staff.update({ workforce_permissions: ["create_project"] });
    const me = await request("auth/me", "GET", undefined, staff);
    assert.ok(me.data.user.effective_permissions.includes("create_projects"));
    const created = await request("projects", "POST", { title: "Delegated creation" }, staff);
    assert.equal(created.status, 201); assert.equal(created.data.created_by_user_id, staff.user_id); assert.equal(created.data.project_managers_id, null);
    const unrelated = await Project.create({ title: "Private project", created_by_user_id: other.user_id });
    const listing = await request("projects", "GET", undefined, staff);
    assert.deepEqual(listing.data.projects.map((p) => p.projects_id), [created.data.projects_id]);
    assert.equal((await request(`projects/${unrelated.projects_id}`, "GET", undefined, staff)).status, 403);
    assert.equal((await request(`projects/${created.data.projects_id}`, "PUT", { title: "Permitted creator edit" }, staff)).status, 200);
    assert.equal((await request("projects", "POST", { title: "Forged manager", project_manager_id: randomUUID() }, staff)).status, 403);
    await staff.update({ workforce_permissions: [] });
    assert.equal((await request("projects", "POST", { title: "Revoked" }, staff)).status, 403);
    const permission = await RolePermission.findOne({ where: { permission_key: "create_projects" } });
    await permission.update({ admin: false });
    assert.equal((await request("projects", "POST", { title: "Admin denied" })).status, 403);
    assert.ok(!(await request("auth/me")).data.user.effective_permissions.includes("create_projects"));
    await permission.update({ admin: true });
  });
  test("custom roles receive only explicit grants and individual grant endpoints reject unknown permissions", async () => {
    const customRole = await Role.create({ role_key: "name", name: "Custom name role", is_system: false });
    const user = await User.create({ email: `${randomUUID()}@example.test`, role_id: customRole.role_id });
    assert.deepEqual((await request("auth/me", "GET", undefined, user)).data.user.effective_permissions, []);
    assert.equal((await request(`admin/users/${user.user_id}/permissions`, "PUT", { workforce_permissions: ["unknown_permission"] })).status, 400);
    const assigned = await request(`admin/users/${user.user_id}/permissions`, "PUT", { workforce_permissions: ["create_project"] });
    assert.equal(assigned.status, 200); assert.deepEqual(assigned.data.user.workforce_permissions, ["create_projects"]);
    assert.equal((await request("projects", "POST", { title: "Custom role project" }, user)).status, 201);
  });
  test("delegated management APIs allow matching features and reject privilege escalation and alternate-route bypasses", async () => {
    await staff.update({ workforce_permissions: ["manage_staff", "manage_departments", "manage_kpis"] });
    assert.equal((await request("workforce/management/users", "GET", undefined, staff)).status, 200);
    const changed = await request(`workforce/management/users/${other.user_id}`, "PUT", { job_title: "Engineer" }, staff);
    assert.equal(changed.status, 200); assert.equal(changed.data.job_title, "Engineer"); assert.equal(changed.data.browser_latitude, undefined);
    for (const field of ["role_id", "workforce_permissions", "employee_id", "is_active"]) assert.equal((await request(`workforce/management/users/${other.user_id}`, "PUT", { [field]: "forged" }, staff)).status, 400);
    assert.equal((await request("admin/users", "GET", undefined, staff)).status, 403);
    assert.equal((await request("admin/audit-logs", "GET", undefined, staff)).status, 403);
    assert.equal((await request("admin/notifications/broadcast", "POST", {}, staff)).status, 403);
    const department = await request("workforce/management/departments", "POST", { name: "Delegated", code: randomUUID() }, staff);
    assert.equal(department.status, 201);
    await staff.update({ workforce_permissions: [] });
    assert.equal((await request(`workforce/management/departments/${department.data.department_id}`, "PUT", { name: "Revoked" }, staff)).status, 403);
    const permission = await RolePermission.findOne({ where: { permission_key: "manage_departments" } }); await permission.update({ admin: false });
    assert.equal((await request(`admin/departments/${department.data.department_id}`, "PUT", { name: "Bypass" })).status, 403); await permission.update({ admin: true });
  });
  test("reporting defaults, overrides, explicit no-manager, manager changes and cycles are enforced", async () => {
    const managerA = await createUser(), managerB = await createUser(), inherited = await createUser(), overridden = await createUser();
    const department = await Department.create({ name: randomUUID(), code: randomUUID(), manager_user_id: managerA.user_id });
    await setReporting(inherited, { department_id: department.department_id });
    await setReporting(overridden, { department_id: department.department_id, reports_to_user_id: managerA.user_id });
    assert.equal(inherited.reports_to_user_id, managerA.user_id); assert.equal(overridden.reporting_manager_mode, "override");
    assert.equal((await request(`admin/departments/${department.department_id}`, "PUT", { manager_user_id: managerB.user_id })).status, 200);
    assert.equal((await loadUser(inherited.user_id)).reports_to_user_id, managerB.user_id);
    assert.equal((await loadUser(overridden.user_id)).reports_to_user_id, managerA.user_id);
    await setReporting(overridden, { reporting_manager_mode: "override", reports_to_user_id: null });
    await request(`admin/departments/${department.department_id}`, "PUT", { manager_user_id: managerA.user_id });
    assert.equal((await loadUser(overridden.user_id)).reports_to_user_id, null);
    await assert.rejects(setReporting(managerA, { reports_to_user_id: inherited.user_id }), /cycle/);
    await assert.rejects(setReporting(managerA, { reports_to_user_id: managerA.user_id }), /themselves/);
    await request(`admin/departments/${department.department_id}`, "DELETE");
    assert.equal((await loadUser(inherited.user_id)).department_id, null); assert.equal((await loadUser(inherited.user_id)).reports_to_user_id, null);
    assert.equal((await loadUser(overridden.user_id)).reporting_manager_mode, "override");
  });
  test("soft deletion preserves history and profiles, excludes accounts, reserves identifiers and invalidates old sessions through restore", async () => {
    const user = await createUser("talent", { employee_id: `ID-${randomUUID()}` }); const profile = await Talent.create({ user_id: user.user_id });
    const entry = await Attendance.create({ user_id: user.user_id, work_date: "2026-01-05", clock_in: new Date("2026-01-05T08:00:00Z"), clock_out: new Date("2026-01-05T16:00:00Z"), status: "completed" });
    const oldToken = token(user); const refresh = generateTokens({ user_id: user.user_id, role: "talent" }).refreshToken;
    assert.equal((await request(`admin/users/${user.user_id}`, "DELETE")).status, 200);
    assert.equal(await User.findByPk(user.user_id), null); assert.ok(await Talent.findByPk(profile.talent_id)); assert.ok(await Attendance.findByPk(entry.attendance_id));
    assert.equal((await request("auth/me", "GET", undefined, oldToken)).status, 401);
    assert.equal((await request("auth/refresh-token", "POST", { refresh_token: refresh })).status, 401);
    const deleted = await request("admin/users?status=deleted"); assert.ok(!deleted.data.users.some((row) => row.user_id === user.user_id));
    assert.equal((await request(`admin/users/${other.user_id}/employee-id`, "PUT", { employee_id: user.employee_id })).status, 409);
    assert.equal((await request(`admin/users/${user.user_id}/attendance?start_date=2026-01-01&end_date=2026-01-31`)).data.entries.length, 1);
    assert.equal((await request(`admin/users/${user.user_id}/restore`, "POST", {})).status, 200);
    assert.equal((await request("auth/me", "GET", undefined, oldToken)).status, 401);
    assert.ok(await User.findByPk(user.user_id));
    assert.equal((await request(`admin/users/${admin.user_id}`, "DELETE")).status, 409);
    assert.equal((await request(`admin/users/${superAdmin.user_id}`, "DELETE")).status, 404);
  });
  test("deletion lists department, direct-report and actual talent-project blockers", async () => {
    const user = await createUser("talent"); const talent = await Talent.create({ user_id: user.user_id });
    const department = await Department.create({ name: randomUUID(), code: randomUUID(), manager_user_id: user.user_id });
    const report = await createUser(); await report.update({ reports_to_user_id: user.user_id, reporting_manager_mode: "override" });
    const project = await Project.create({ title: "Active talent assignment", status: "on_hold" }); await project.addTalent(talent);
    const result = await request(`admin/users/${user.user_id}`, "DELETE");
    assert.equal(result.status, 409); assert.equal(result.blockers.departments[0].department_id, department.department_id); assert.equal(result.blockers.directReports[0].user_id, report.user_id); assert.equal(result.blockers.projects[0].projects_id, project.projects_id);
  });
  test("Employee ID validation covers empty, overlong, existing and reserved values and concurrent edits", async () => {
    for (const employee_id of ["", "   ", "x".repeat(256)]) assert.equal((await request(`admin/users/${other.user_id}/employee-id`, "PUT", { employee_id })).status, 400);
    const reserved = `RES-${randomUUID()}`;
    await Invite.create({ email: `${randomUUID()}@example.test`, role_id: staff.role_id, employee_id: reserved, sent_at: new Date(), invited_by_user_id: admin.user_id });
    assert.equal((await request(`admin/users/${other.user_id}/employee-id`, "PUT", { employee_id: reserved })).status, 409);
    const id = `CONCURRENT-${randomUUID()}`;
    const results = await Promise.all([request(`admin/users/${other.user_id}/employee-id`, "PUT", { employee_id: id }), request(`admin/users/${staff.user_id}/employee-id`, "PUT", { employee_id: id })]);
    assert.deepEqual(results.map((row) => row.status).sort(), [200, 409]);
  });
  test("historical project identities survive deletion while assignments and all notification writers exclude deleted users", async () => {
    const managerUser = await createUser("project_manager"), talentUser = await createUser("talent");
    const manager = await models.ProjectManager.create({ user_id: managerUser.user_id });
    const talent = await Talent.create({ user_id: talentUser.user_id });
    const project = await Project.create({ title: "Completed history", status: "completed", project_managers_id: manager.project_managers_id });
    await project.addTalent(talent);
    assert.equal((await request(`admin/users/${managerUser.user_id}`, "DELETE")).status, 200);
    assert.equal((await request(`admin/users/${talentUser.user_id}`, "DELETE")).status, 200);
    const historical = await request(`projects/${project.projects_id}`);
    assert.equal(historical.status, 200);
    assert.equal(historical.data.project_manager.user.email, managerUser.email);
    assert.equal(historical.data.talents[0].user.email, talentUser.email);
    assert.equal((await request(`projects/${project.projects_id}`, "PUT", { status: "planning" })).status, 400);
    assert.equal((await request(`projects/${project.projects_id}`, "PUT", { project_manager_id: null, talent_ids: [], status: "planning" })).status, 200);
    assert.equal((await request(`projects/${project.projects_id}`, "PUT", { project_manager_id: manager.project_managers_id })).status, 400);
    assert.equal((await request(`projects/${project.projects_id}`, "PUT", { talent_ids: [talent.talent_id] })).status, 400);
    const newManagerUser = await createUser("project_manager");
    const newManager = await models.ProjectManager.create({ user_id: newManagerUser.user_id });
    assert.equal((await request(`projects/${project.projects_id}`, "PUT", { project_manager_id: newManager.project_managers_id })).status, 200);
    assert.equal((await request(`admin/users/${newManagerUser.user_id}`, "DELETE")).status, 409);
    assert.equal((await request(`projects/${project.projects_id}`, "PUT", { project_manager_id: null })).status, 200);
    assert.equal((await request(`admin/users/${newManagerUser.user_id}`, "DELETE")).status, 200);
    assert.equal(await Notification.create({ user_id: talentUser.user_id, title: "Excluded", message: "Deleted recipient" }), null);
    const deliveries = await Notification.bulkCreate([{ user_id: talentUser.user_id, title: "Excluded", message: "Deleted recipient" }, { user_id: admin.user_id, title: "Delivered", message: "Current recipient" }]);
    assert.equal(deliveries.length, 1); assert.equal(deliveries[0].user_id, admin.user_id);
    assert.equal(await Notification.count({ where: { user_id: talentUser.user_id } }), 0);
  });
  test("successful login verifies every role; failed login and password changes enforce current credentials", async () => {
    for (const role of ["admin", "staff", "project_manager", "talent"]) {
      const user = await createUser(role); assert.equal(user.is_verified, false);
      assert.equal((await request("auth/login", "POST", { email: user.email, password: "wrong" })).status, 401);
      assert.equal((await loadUser(user.user_id)).is_verified, false);
      const login = await request("auth/login", "POST", { email: user.email, password: "valid-password" }); assert.equal(login.status, 200); assert.equal(login.data.user.is_verified, true);
      assert.ok((await loadUser(user.user_id)).last_login);
    }
    const user = await createUser(); const prior = token(user);
    assert.equal((await request("auth/edit-password", "POST", { old_password: "wrong", new_password: "different-password", confirm_password: "different-password" }, user)).status, 400);
    assert.equal((await request("auth/edit-password", "POST", { old_password: "valid-password", new_password: "valid-password", confirm_password: "valid-password" }, user)).status, 400);
    const change = await request("auth/edit-password", "POST", { old_password: "valid-password", new_password: "different-password", confirm_password: "different-password" }, user);
    assert.equal(change.status, 200); assert.equal((await request("auth/me", "GET", undefined, prior)).status, 401); assert.equal((await request("auth/me", "GET", undefined, change.data.token)).status, 200);
    assert.equal((await request("auth/signup", "POST", { email: admin.email, role: "talent", password: "valid-password", confirm_password: "valid-password", googleSignIn: true })).status, 403);
  });
  test("attendance cutoff uses company time and independent disabled/enabled preferences", async () => {
    assert.equal(isAfterAutoClockOut("2026-01-05T15:59:59Z"), false); assert.equal(isAfterAutoClockOut("2026-01-05T16:00:00Z"), true);
    assert.equal(autoClockOutDeadline("2026-01-05T08:00:00Z").toISOString(), "2026-01-05T16:00:00.000Z");
    const enabled = await createUser(), disabled = await createUser();
    assert.equal((await request("auth/preferences", "PUT", { auto_clock_out_enabled: true }, enabled)).data.user.auto_clock_out_time, "17:00:00");
    assert.equal((await loadUser(disabled.user_id)).auto_clock_out_time, null);
    const day = "2026-01-07";
    const first = await Attendance.create({ user_id: enabled.user_id, work_date: day, clock_in: new Date(`${day}T08:00Z`), auto_clock_out_at: new Date(`${day}T16:00Z`) });
    const second = await Attendance.create({ user_id: disabled.user_id, work_date: day, clock_in: new Date(`${day}T08:00Z`) });
    await Promise.all([reconcileUnclosedAttendance(`${day}T16:01Z`), reconcileUnclosedAttendance(`${day}T16:01Z`)]);
    await first.reload(); await second.reload(); assert.equal(first.clock_out.toISOString(), `${day}T16:00:00.000Z`); assert.equal(first.clock_out_source, "automatic"); assert.equal(second.clock_out, null);
    assert.equal((await request("auth/preferences", "PUT", { auto_clock_out_enabled: false }, enabled)).data.user.auto_clock_out_time, null);
    await assert.rejects(db.transaction((transaction) => User.update({ auto_clock_out_enabled: false, auto_clock_out_time: "17:00" }, { where: { user_id: disabled.user_id }, transaction })), /check constraint/);
  });
  test("preference changes update or cancel a pending deadline and reject enabling during an open late session", async (t) => {
    const user = await createUser();
    const now = getWorkforceMoment(); const workDate = now.format("YYYY-MM-DD");
    const entry = await Attendance.create({ user_id: user.user_id, work_date: workDate, clock_in: now.clone().startOf("day").hour(8).toDate() });
    const changed = await request("auth/preferences", "PUT", { auto_clock_out_enabled: true }, user);
    if (isAfterAutoClockOut()) assert.equal(changed.status, 409);
    else { assert.equal(changed.status, 200); await entry.reload(); assert.ok(entry.auto_clock_out_at); }
    await request("auth/preferences", "PUT", { auto_clock_out_enabled: false }, user); await entry.reload(); assert.equal(entry.auto_clock_out_at, null);
  });
  test("location opt-out purges all history, rejects live writes, ignores submitted coordinates and preserves manual addresses", async () => {
    const user = await createUser("staff", { city: "Manual City", country: "Manual Country", location_sharing_enabled: true, location_permission_status: "granted", browser_latitude: 1, browser_longitude: 2, browser_location_country: "Collected" });
    const entry = await Attendance.create({ user_id: user.user_id, work_date: "2026-02-05", clock_in: new Date("2026-02-05T08:00Z"), latitude: 1, longitude: 2, location_accuracy: 5 });
    const result = await request("staff/location-sharing", "PUT", { enabled: false, latitude: 8, longitude: 9 }, user);
    assert.equal(result.status, 200); assert.equal(result.data.user.browser_latitude, null); assert.equal(result.data.user.city, "Manual City"); assert.equal(result.data.user.country, "Manual Country");
    await entry.reload(); assert.equal(entry.latitude, null); assert.equal(entry.longitude, null); assert.equal(entry.location_accuracy, null);
    assert.equal((await request("staff/location", "POST", { latitude: 3, longitude: 4 }, user)).status, 403);
    assert.equal((await request("staff/location/reverse-geo?latitude=1&longitude=2", "GET", undefined, user)).status, 403);
  });
  test("an in-flight geocoding response cannot restore locations after disabling and re-enabling sharing", async (t) => {
    const user = await createUser("staff", { location_sharing_enabled: true, location_permission_status: "granted" });
    const entry = await Attendance.create({ user_id: user.user_id, work_date: getWorkforceMoment().format("YYYY-MM-DD"), clock_in: new Date(), latitude: 1, longitude: 2 });
    const originalFetch = global.fetch;
    const originalKey = process.env.GEOAPIFY_API_KEY; process.env.GEOAPIFY_API_KEY = "test-key";
    t.after(() => { if (originalKey === undefined) delete process.env.GEOAPIFY_API_KEY; else process.env.GEOAPIFY_API_KEY = originalKey; });
    let release, entered;
    const waiting = new Promise((resolve) => { release = resolve; });
    const started = new Promise((resolve) => { entered = resolve; });
    t.mock.method(global, "fetch", async (input, options) => {
      if (String(input).startsWith("https://api.geoapify.com/")) {
        entered(); await waiting;
        return new Response(JSON.stringify({ features: [{ properties: { country: "Stale collected location" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(input, options);
    });
    const pending = request("staff/location", "POST", { latitude: 3, longitude: 4 }, user);
    await started;
    assert.equal((await request("staff/location-sharing", "PUT", { enabled: false }, user)).status, 200);
    assert.equal((await request("staff/location-sharing", "PUT", { enabled: true, permission_status: "granted" }, user)).status, 200);
    release(); assert.equal((await pending).status, 403);
    await entry.reload(); assert.equal(entry.latitude, null); assert.equal((await loadUser(user.user_id)).browser_location_country, null);
  });
  test("clock-in at the cutoff is blocked and automatic/manual races preserve the scheduled timestamp", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-04-06T15:59:00Z") });
    const user = await createUser();
    assert.equal((await request("auth/preferences", "PUT", { auto_clock_out_enabled: true }, user)).status, 200);
    assert.equal((await request("staff/attendance/clock-in", "POST", {}, user)).status, 201);
    t.mock.timers.setTime(new Date("2026-04-06T16:00:00Z").getTime());
    const late = await createUser("staff", { auto_clock_out_enabled: true, auto_clock_out_time: "17:00:00" });
    assert.equal((await request("staff/attendance/clock-in", "POST", {}, late)).status, 409);
    const results = await Promise.all([request("staff/attendance/clock-out", "POST", { work_log: "Today's work" }, user), reconcileUnclosedAttendance()]);
    assert.ok([200, 409].includes(results[0].status));
    const row = await Attendance.findOne({ where: { user_id: user.user_id } });
    assert.equal(row.clock_out.toISOString(), "2026-04-06T16:00:00.000Z"); assert.equal(row.clock_out_source, "automatic");
    await reconcileUnclosedAttendance(); await row.reload(); assert.equal(row.clock_out.toISOString(), "2026-04-06T16:00:00.000Z");
  });
  test("Google authentication verifies active accounts and rejects inactive or deleted identities", async () => {
    const strategy = require("passport")._strategy("google");
    const verify = (email) => new Promise((resolve, reject) => strategy._verify("verified-provider-token", "", { _json: { email } }, (error, user) => error ? reject(error) : resolve(user)));
    const user = await createUser("admin"); await verify(user.email); assert.equal((await loadUser(user.user_id)).is_verified, true);
    await user.update({ is_active: false }); await assert.rejects(verify(user.email), /unavailable/);
    const deleted = await createUser(); await request(`admin/users/${deleted.user_id}`, "DELETE"); await assert.rejects(verify(deleted.email), /unavailable/);
  });
  test("broadcasts are durable, retry-safe, isolated to authenticated recipient rooms and emit only after commit", async () => {
    const user = await createUser(); const socket = socketClient(origin, { auth: { token: token(user) }, transports: ["websocket"], reconnection: false }); sockets.add(socket); await once(socket, "connect");
    const broadcast_id = randomUUID(); const events = []; socket.on("notification_created", (event) => events.push(event.notification));
    const pending = once(socket, "notification_created");
    const result = await request("admin/notifications/broadcast", "POST", { broadcast_id, title: "Announcement", message: "For everyone", type: "info" });
    assert.equal(result.status, 200); const [event] = await pending; assert.equal(event.notification.user_id, user.user_id);
    assert.ok(await Notification.findByPk(event.notification.notifications_id));
    const retry = await request("admin/notifications/broadcast", "POST", { broadcast_id, title: "Announcement", message: "For everyone", type: "info" });
    assert.equal(retry.status, 200); assert.equal(await Notification.count({ where: { user_id: user.user_id, broadcast_id } }), 1);
    assert.equal((await request("admin/notifications/broadcast", "POST", { broadcast_id, title: "Different", message: "For everyone" })).status, 409);
    assert.equal((await request("notifications", "GET", undefined, user)).data.notifications.filter((row) => row.broadcast_id === broadcast_id).length, 1);
    assert.equal(events.length, 1);
    socket.disconnect();
  });
  test("attendance summaries include all matching records and reject invalid filters", async () => {
    const user = await createUser();
    const base = new Date("2025-01-01T08:00Z");
    const entries = Array.from({ length: 65 }, (_, i) => { const clock_in = new Date(base.getTime() + i * 86400000); return { user_id: user.user_id, work_date: clock_in.toISOString().slice(0, 10), clock_in, clock_out: new Date(clock_in.getTime() + 8 * 3600000), clock_out_source: "manual", status: "completed" }; });
    await Attendance.bulkCreate(entries);
    const response = await request(`admin/users/${user.user_id}/attendance?start_date=2025-01-01&end_date=2025-04-01&limit=10`);
    assert.equal(response.status, 200); assert.equal(response.data.entries.length, 10); assert.equal(response.data.summary.totalEntries, 65); assert.equal(response.data.summary.workedHours, 520);
    assert.equal((await request(`admin/users/${user.user_id}/attendance?start_date=2025-02-30`)).status, 400);
    assert.equal((await request("admin/users?limit=1000")).status, 400);
  });
  test("audits are append-only, redact credentials and locations, retain actors, and roll back with their mutations", async () => {
    const beforeCount = await AuditLog.count();
    await assert.rejects(db.transaction(async (transaction) => { await other.update({ job_title: "Rolled back" }, { transaction }); throw new Error("rollback"); }));
    assert.equal(await AuditLog.count(), beforeCount);
    assert.notEqual((await loadUser(other.user_id)).job_title, "Rolled back");
    const logs = await request("admin/audit-logs"); assert.equal(logs.status, 200); assert.ok(logs.data.pagination.totalItems > 0);
    const changes = JSON.stringify((await AuditLog.findAll()).map((row) => row.changes));
    for (const secret of ["valid-password", "different-password", "browser_latitude", "browser_longitude", "reset_password_token"]) assert.ok(!changes.includes(secret), `Audit changes exposed ${secret}`);
    const originalTitle = (await loadUser(other.user_id)).job_title;
    const auditFailure = require("../models/AuditLog").create;
    require("../models/AuditLog").create = async () => { throw new Error("Audit storage unavailable"); };
    try { await assert.rejects(other.update({ job_title: "Must not persist" }), /Audit storage unavailable/); }
    finally { require("../models/AuditLog").create = auditFailure; }
    assert.equal((await loadUser(other.user_id)).job_title, originalTitle);
    const row = await AuditLog.findOne(); await assert.rejects(row.update({ outcome: "forged" }), /append-only/); await assert.rejects(row.destroy(), /append-only/);
    assert.equal((await request("admin/users/not-an-id", "DELETE")).status, 400);
  });
}
