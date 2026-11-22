const { AsyncLocalStorage } = require("node:async_hooks");
const context = new AsyncLocalStorage();
const personalFields = new Set(["first_name", "last_name", "phone_number", "date_of_birth", "email", "city", "country", "avatar_object_name"]);
const operationalFields = new Set(["role_id", "permission_keys", "workforce_permissions", "is_active", "is_verified", "session_version", "deleted_at", "deleted_by_user_id", "employee_id", "department_id", "reports_to_user_id", "reporting_manager_mode", "manager_user_id", "job_title", "employment_type", "hire_date", "leave_allowance_days", "auto_clock_out_enabled", "auto_clock_out_time", "notification_sound_enabled", "location_sharing_enabled", "location_permission_status", "status", "clock_in", "clock_out", "clock_out_source", "auto_clock_out_at", "work_date", "progress", "priority", "project_managers_id", "created_by_user_id", "permission_key", "admin", "project_manager", "staff", "super_admin", "recipient_count", "key", "type", "review_cycle", "assigned_to_user_id", "reviewed_by", "start_date", "end_date"]);

function safeChanges(values = {}, previous = {}) {
  const changes = {};
  // Names such as "project_manager" also identify eager-loaded associations.
  // Only record scalar operational values and the explicit permission arrays.
  const safeValue = (key, value) => value == null || value instanceof Date || ["string", "number", "boolean"].includes(typeof value)
    || (["permission_keys", "workforce_permissions"].includes(key) && Array.isArray(value) && value.every((entry) => typeof entry === "string"));
  for (const [key, value] of Object.entries(values)) {
    if (operationalFields.has(key) && safeValue(key, value) && safeValue(key, previous[key])) changes[key] = { from: previous[key] ?? null, to: value };
    else if (personalFields.has(key)) changes[key] = { changed: true };
  }
  return changes;
}

async function recordAudit({ action, target_type, target_id = null, outcome = "success", changes = {}, actor, organizationId }, transaction) {
  const req = context.getStore();
  const user = actor || req?.user;
  const organization_id = organizationId || require('../services/tenantContext').peekTenantContext()?.organizationId;
  const models = require('../models');
  const Model = organization_id || process.env.TENANCY_ENFORCED !== 'true' ? models.AuditLog : models.IdentityAuditLog;
  return Model.create({
    ...(organization_id ? { organization_id } : {}),
    actor_user_id: user?.user_id || null,
    actor_name: user ? `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.email : null,
    action, target_type, target_id: target_id == null ? null : String(target_id), outcome, changes,
  }, { transaction });
}

const auditContext = (req, res, next) => context.run(req, next);
let installed = false;
function installAuditing(models) {
  if (installed) return;
  installed = true;
  const sequelize = require("../config/database");
  const securityTables = new Set(require('../services/tenancyInventory').GLOBAL_SECURITY_TABLES);
  for (const [name, model] of Object.entries(models)) {
    if (!model?.addHook || ['AuditLog', 'IdentityAuditLog'].includes(name)) continue;
    // Credential primary keys may be token/code hashes. Security services own
    // their transactions and explicit sanitized audits, never generic targets.
    if (securityTables.has(model.tableName)) continue;
    // Mutations and their hooks share a transaction, including legacy controllers.
    const wrap = (owner, method, optionIndex) => {
      const original = owner[method];
      if (typeof original !== "function") return;
      owner[method] = function (...args) {
        const options = args[optionIndex] || {};
        if (options.transaction) return original.apply(this, args);
        return sequelize.transaction(async (transaction) => {
          args[optionIndex] = { ...options, transaction };
          return original.apply(this, args);
        });
      };
    };
    for (const [method, index] of [["create", 1], ["bulkCreate", 1], ["update", 1], ["upsert", 1], ["destroy", 0], ["restore", 0]]) wrap(model, method, index);
    for (const [method, index] of [["save", 0], ["update", 1], ["destroy", 0], ["restore", 0]]) wrap(model.prototype, method, index);
    if (["Notification", "Message", "ChatUserState"].includes(name)) continue;
    const log = (operation, instance, options) => {
      if (options.audit === false) return;
      const fields = operation === "update" ? (instance.changed() || []) : Object.keys(instance.dataValues);
      return recordAudit({ action: `${name.toLowerCase()}.${operation}`, target_type: name,
        organizationId: instance.organization_id,
        target_id: instance.get(model.primaryKeyAttribute),
        changes: safeChanges(Object.fromEntries(fields.map((f) => [f, instance.get(f)])), instance._previousDataValues),
      }, options.transaction);
    };
    model.addHook("afterCreate", (row, options) => log("create", row, options));
    model.addHook("afterUpdate", (row, options) => log("update", row, options));
    model.addHook("afterDestroy", (row, options) => log("delete", row, options));
    model.addHook("afterRestore", (row, options) => log("restore", row, options));
    model.addHook("afterBulkCreate", (rows, options) => recordAudit({ action: `${name.toLowerCase()}.bulk_create`, target_type: name, changes: { count: rows.length } }, options.transaction));
    model.addHook("afterBulkUpdate", (options) => {
      if (!options.individualHooks) return recordAudit({ action: `${name.toLowerCase()}.bulk_update`, target_type: name, changes: safeChanges(options.attributes) }, options.transaction);
    });
    model.addHook("afterBulkDestroy", (options) => {
      if (!options.individualHooks) return recordAudit({ action: `${name.toLowerCase()}.bulk_delete`, target_type: name }, options.transaction);
    });
    model.addHook("afterUpsert", (_, options) => recordAudit({ action: `${name.toLowerCase()}.upsert`, target_type: name }, options.transaction));
  }
  const publish = (rows, options) => {
    const { afterCommit, emitUser } = require("./events");
    const notifications = rows.filter((row) => !row.chat_message_id);
    if (notifications.length) afterCommit(options.transaction, async () => {
      const { emitToUser } = require('./events');
      const io = require('./events').getRealtime();
      for (const notification of notifications) await emitToUser(io, notification.user_id, "notification_created", { notification: notification.toJSON() }, notification.organization_id);
    });
  };
  models.Notification.addHook("afterCreate", (row, options) => publish([row], options));
  models.Notification.addHook("afterBulkCreate", publish);
  models.User.addHook("afterUpdate", (row, options) => {
    const { afterCommit, emitUser } = require("./events");
    const revoked = !row.is_active || row.changed("password") || row.changed("session_version");
    afterCommit(options.transaction, () => {
      if (revoked) require("./events").disconnectUser(row.user_id);
      else return require('../services/tenantContext').runWithoutTenant(() => emitUser(row.user_id, "account_updated"));
    });
  });
  models.Role.addHook("afterUpdate", async (role, options) => {
    const users = role.organization_id
      ? await models.HRProfile.findAll({ where: { role_id: role.role_id, organization_id: role.organization_id }, attributes: ['user_id'], transaction: options.transaction })
      : await models.User.findAll({ where: { role_id: role.role_id }, attributes: ["user_id"], transaction: options.transaction });
    const { afterCommit, emitUser } = require("./events");
    afterCommit(options.transaction, async () => { for (const user of users) await require('./events').emitToUser(require('./events').getRealtime(), user.user_id, 'account_updated', {}, role.organization_id); });
  });
  models.RolePermission.addHook("afterUpdate", async (permission, options) => {
    const { afterCommit, emitUser } = require("./events");
    const users = permission.organization_id
      ? await models.HRProfile.findAll({ where: { organization_id: permission.organization_id }, attributes: ['user_id'], transaction: options.transaction })
      : await models.User.findAll({ attributes: ["user_id"], transaction: options.transaction });
    afterCommit(options.transaction, async () => {
      for (const user of users) await require('./events').emitToUser(require('./events').getRealtime(), user.user_id, 'account_updated', {}, permission.organization_id);
    });
  });
  models.HRProfile.addHook('afterUpdate', (profile, options) => {
    const events = require('./events');
    events.afterCommit(options.transaction, () => events.emitToUser(events.getRealtime(), profile.user_id, 'account_updated', {}, profile.organization_id));
  });
  models.OrganizationMembership.addHook('afterUpdate', (membership, options) => {
    if (membership.status !== 'active') require('./events').afterCommit(options.transaction, () => require('./events').disconnectMembership(membership.user_id, membership.organization_id));
  });
}
module.exports = { auditContext, recordAudit, safeChanges, installAuditing };
