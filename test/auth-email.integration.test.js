const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { once } = require("node:events");

const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;
if (!databaseUrl) {
  test("PostgreSQL auth regression (set AUTH_TEST_DATABASE_URL to run)", { skip: true }, () => {});
} else {
  const { Sequelize } = require("sequelize");
  const schema = `auth_test_${randomUUID().replaceAll("-", "")}`;
  const database = new Sequelize(databaseUrl, { logging: false, schema });
  database.schema = schema;
  database.afterDefine((model) => { model.options.schema = schema; });
  const databasePath = require.resolve("../config/database");
  require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: database };
  const emails = [];
  const mailPath = require.resolve("../utils/sendEmail");
  require.cache[mailPath] = { id: mailPath, filename: mailPath, loaded: true, exports: async (mail) => { emails.push(mail); } };
  process.env.GOOGLE_CLIENT_ID ||= "test-client";
  process.env.GOOGLE_CLIENT_SECRET ||= "test-secret";
  process.env.JWT_SECRET = randomUUID();
  process.env.JWT_REFRESH_SECRET = randomUUID();
  const { User, Role, Invite, Interview } = require("../models");
  const express = require("express");
  let server, origin, role, user;
  const request = async (path, body, token) => {
    const response = await fetch(`${origin}/api/auth/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    });
    return { status: response.status, ...await response.json() };
  };

  before(async () => {
    await database.createSchema(schema);
    await database.sync();
    role = await Role.create({ role_key: "staff", name: "Staff", is_system: true });
    await Role.create({ role_key: "talent", name: "Talent", is_system: true });
    user = await User.create({ email: "Compassion@stechad.com", password: "old-password", role_id: role.role_id, first_name: "Compassion" });
    // Reproduce an account created before normalization was introduced.
    await database.query(`UPDATE "${schema}".users SET email = 'Compassion@stechad.com' WHERE user_id = :id`, { replacements: { id: user.user_id } });
    const app = express();
    app.use(express.json());
    app.use("/api/auth", require("../routes/authRoutes"));
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    try { await database.dropSchema(schema, { cascade: true }); }
    finally { await database.close(); }
  });

  test("lowercase OTP lookup, reset and login work for a legacy mixed-case account", async () => {
    const sent = await request("send-otp", { email: " compassion@stechad.com ", purpose: "password_reset" });
    assert.equal(sent.status, 200);
    const otp = emails.at(-1).replacements.resetCode;
    assert.ok(otp);
    const reset = await request("reset-password", { otp, new_password: "new-password", confirm_password: "new-password" });
    assert.equal(reset.status, 200);
    for (const email of ["compassion@stechad.com", "COMPASSION@STECHAD.COM", " Compassion@stechad.com "]) {
      const login = await request("login", { email, password: "new-password" });
      assert.equal(login.status, 200);
      assert.equal(login.data.user.user_id, user.user_id);
    }
    assert.equal((await request("login", { email: "compassion@stechad.com", password: "old-password" })).status, 401);
    assert.equal((await request("reset-password", { otp, new_password: "another-password", confirm_password: "another-password" })).status, 400);
    const saved = await User.unscoped().findByPk(user.user_id);
    assert.equal(await saved.comparePassword("new-password"), true, "password is hashed exactly once");
    assert.equal(saved.reset_password_token, null);
  });

  test("reset errors preserve the code so users can correct and retry", async () => {
    await request("send-otp", { email: "COMPASSION@stechad.com" });
    const otp = emails.at(-1).replacements.resetCode;
    for (const [password, confirmation, message] of [
      ["short", "short", /at least 6/],
      ["new-password", "different", /do not match/],
      ["new-password", "new-password", /different from the old/],
    ]) {
      const result = await request("reset-password", { otp, new_password: password, confirm_password: confirmation });
      assert.equal(result.status, 400);
      assert.match(result.message, message);
    }
    assert.equal((await request("reset-password", { otp, new_password: "valid6", confirm_password: "valid6" })).status, 200);
    assert.equal((await request("login", { email: "COMPASSION@stechad.com", password: "valid6" })).status, 200);
    await request("send-otp", { email: "compassion@stechad.com" });
    const expiredOtp = emails.at(-1).replacements.resetCode;
    await User.update({ reset_password_expires: new Date(0) }, { where: { user_id: user.user_id } });
    assert.equal((await request("reset-password", { otp: expiredOtp, new_password: "next-password", confirm_password: "next-password" })).status, 400);
  });

  test("signup normalizes without removing email dots or plus tags, rejects duplicates and returns field errors", async () => {
    const body = { email: " Jane.Doe+Team@Gmail.com ", password: "valid6", confirm_password: "valid6", role: "talent" };
    const created = await request("signup", body);
    assert.equal(created.status, 201);
    assert.equal(created.data.user.email, "jane.doe+team@gmail.com");
    assert.equal((await request("signup", { ...body, email: "JANE.DOE+TEAM@gmail.com" })).status, 400);
    const invalid = await request("signup", { ...body, email: "bad", password: "short", confirm_password: "other" });
    assert.equal(invalid.status, 400);
    assert.ok(invalid.errors.email);
    assert.match(invalid.errors.password, /at least 6/);
    assert.match(invalid.errors.confirm_password, /do not match/);
    assert.equal(invalid.errors.undefined, undefined);
    const existing = await request("signup", { ...body, email: "COMPASSION@stechad.com" });
    assert.equal(existing.status, 400);
    assert.match(existing.message, /already exists/);
    assert.equal((await request("send-otp", { email: "bad" })).status, 400);
  });

  test("email setters cover create, update, invites and interview snapshots", async () => {
    const account = await User.create({ email: " NEW@Example.com ", role_id: role.role_id });
    assert.equal(account.email, "new@example.com");
    await User.update({ email: " Updated@Example.com " }, { where: { user_id: account.user_id } });
    assert.equal((await User.findByPk(account.user_id)).email, "updated@example.com");
    assert.equal(Invite.build({ email: " Invited@Example.com " }).email, "invited@example.com");
    const interview = Interview.build({ candidate_email: " Candidate@Example.com ", interviewer_email: " Interviewer@Example.com " });
    assert.equal(interview.candidate_email, "candidate@example.com");
    assert.equal(interview.interviewer_email, "interviewer@example.com");
    assert.equal(await account.comparePassword("anything"), false, "accounts without passwords do not throw");
  });

  test("invited staff can set a password and subsequently change it", async () => {
    const invitation = await Invite.create({
      email: " Invited@Example.com ", role_id: role.role_id, token: randomUUID(),
      invited_by_user_id: user.user_id, sent_at: new Date(), expires_at: new Date(Date.now() + 3600_000),
    });
    const path = `accept-invite/${invitation.token}`;
    assert.equal((await request(path, { new_password: "short", confirm_password: "short" })).status, 400);
    assert.equal((await request(path, { new_password: "valid6", confirm_password: "valid6" })).status, 201);
    const login = await request("login", { email: "INVITED@example.com", password: "valid6" });
    assert.equal(login.status, 200);
    const changed = await request("edit-password", { old_password: "valid6", new_password: "changed6", confirm_password: "changed6" }, login.data.token);
    assert.equal(changed.status, 200);
    assert.equal((await request("login", { email: "invited@example.com", password: "changed6" })).status, 200);
  });
}
