const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeBirthday } = require("../utils/birthday");
const { User, Talent, Invite, Setting } = require("../models");
const { generateUniqueEmployeeId } = require("../utils/employeeId");

test("birthdays accept valid month/day values and discard legacy birth years", () => {
  for (const [input, expected] of [["02-29", "02-29"], ["1992-04-12", "04-12"], ["12-31", "12-31"], ["", null], [null, null]]) {
    assert.equal(normalizeBirthday(input), expected);
  }
  for (const input of ["02-30", "04-31", "00-12", "13-01", "01-00", "1-2", "birthday", 412]) {
    assert.throws(() => normalizeBirthday(input), /Birthday must/);
  }
});

test("user and talent models serialize birthdays without a year, including legacy records", () => {
  for (const Model of [User, Talent]) {
    const fresh = Model.build({ date_of_birth: "02-29" });
    assert.equal(fresh.getDataValue("date_of_birth"), "2000-02-29");
    assert.equal(fresh.toJSON().date_of_birth, "02-29");
    const legacy = Model.build({ date_of_birth: "1984-12-31" }, { raw: true });
    assert.equal(legacy.toJSON().date_of_birth, "12-31");
    legacy.date_of_birth = "";
    assert.equal(legacy.getDataValue("date_of_birth"), null);
  }
});

test("employee ID allocation reads the configured prefix and checks users and reserved invitations", async (t) => {
  const transaction = {};
  let userChecks = 0;
  let inviteChecks = 0;
  t.mock.method(Setting, "findOne", async (options) => {
    assert.equal(options.where.key, "EMPLOYEE_ID_PREFIX");
    assert.equal(options.transaction, transaction);
    return { value: "TEAM" };
  });
  t.mock.method(User, "findOne", async ({ where, transaction: received }) => {
    assert.match(where.employee_id, /^TEAM\d{4}$/);
    assert.equal(received, transaction);
    userChecks += 1;
    return null;
  });
  t.mock.method(Invite, "findOne", async () => ++inviteChecks === 1 ? { invite_id: "reserved" } : null);
  assert.match(await generateUniqueEmployeeId({ transaction }), /^TEAM\d{4}$/);
  assert.equal(userChecks, 2);
  assert.equal(inviteChecks, 2);
});

test("employee ID allocation defaults to STE and rejects an invalid persisted prefix", async (t) => {
  const setting = t.mock.method(Setting, "findOne", async () => null);
  t.mock.method(User, "findOne", async () => null);
  t.mock.method(Invite, "findOne", async () => null);
  assert.match(await generateUniqueEmployeeId(), /^STE\d{4}$/);
  setting.mock.mockImplementation(async () => ({ value: "bad prefix" }));
  await assert.rejects(generateUniqueEmployeeId(), /Invalid employee ID prefix/);
});

const response = () => ({
  code: 200,
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; },
});

test("settings API validates prefixes before writing and exposes the default prefix", async (t) => {
  const { getSettings, updateSettings } = require("../controllers/adminController");
  const writes = t.mock.method(Setting, "upsert", async () => {});
  t.mock.method(Setting, "findAll", async () => []);
  const get = response();
  await getSettings({}, get);
  assert.equal(get.body.data.EMPLOYEE_ID_PREFIX, "STE");
  for (const settings of [undefined, [], { EMPLOYEE_ID_PREFIX: "" }, { EMPLOYEE_ID_PREFIX: "lower" }, { EMPLOYEE_ID_PREFIX: "1ABC" }, { EMPLOYEE_ID_PREFIX: "ABCDEFGHIJK" }, { EMPLOYEE_ID_PREFIX: 123 }]) {
    const res = response();
    await updateSettings({ body: { settings } }, res);
    assert.equal(res.code, 400);
  }
  assert.equal(writes.mock.callCount(), 0);
  const res = response();
  await updateSettings({ body: { settings: { EMPLOYEE_ID_PREFIX: "TEAM2" } } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(writes.mock.calls[0].arguments[0], { key: "EMPLOYEE_ID_PREFIX", value: "TEAM2", type: "string" });
});

test("all profile endpoints reject invalid birthdays before any uploads or database writes", async () => {
  for (const role of ["admin", "pm", "talent", "staff"]) {
    const { updateProfile, completeOnboarding } = require(`../controllers/${role}Controller`);
    for (const handler of [updateProfile, completeOnboarding].filter(Boolean)) {
      const res = response();
      await handler({ body: { date_of_birth: "04-31" } }, res);
      assert.equal(res.code, 400, `${role} rejects an impossible calendar date`);
    }
  }
});

test("birthday endpoint handles year rollover without returning any year", async (t) => {
  const { getBirthdays } = require("../controllers/staffController");
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-12-30T12:00:00Z") });
  t.mock.method(User, "findAll", async () => [
    { user_id: "next-year", first_name: "January", date_of_birth: "01-02" },
    { user_id: "tomorrow", first_name: "December", date_of_birth: "12-31" },
  ]);
  const res = response();
  await getBirthdays({}, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.data.map(({ date, monthDay, daysAway }) => ({ date, monthDay, daysAway })), [
    { date: "12-31", monthDay: "12-31", daysAway: 1 },
    { date: "01-02", monthDay: "01-02", daysAway: 3 },
  ]);
});

test("February 29 birthdays are included in non-leap years", async (t) => {
  const { getBirthdays } = require("../controllers/staffController");
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2027-02-27T12:00:00Z") });
  t.mock.method(User, "findAll", async () => [{ user_id: "leap", first_name: "Leap", date_of_birth: "02-29" }]);
  const res = response();
  await getBirthdays({}, res);
  assert.equal(res.body.data[0].date, "02-29");
  assert.equal(res.body.data[0].daysAway, 1);
});
