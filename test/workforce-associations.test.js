const { test } = require("node:test");
const assert = require("node:assert/strict");

const { User } = require("../models");

test("User exposes reporting manager workforce associations", () => {
  const reportingManager = User.associations.reporting_manager;
  const directReports = User.associations.direct_reports;

  assert.ok(reportingManager, "reporting_manager association is registered");
  assert.equal(reportingManager.target, User);
  assert.equal(reportingManager.foreignKey, "reports_to_user_id");

  assert.ok(directReports, "direct_reports association is registered");
  assert.equal(directReports.target, User);
  assert.equal(directReports.foreignKey, "reports_to_user_id");
});
