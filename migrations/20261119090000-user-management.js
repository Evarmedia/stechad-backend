"use strict";
const { randomUUID } = require("node:crypto");
const { catalog } = require("../utils/permissions");
module.exports = {
  async up(q, S) {
    const schema = q.sequelize.options.schema || process.env.DB_SCHEMA || "public";
    const table = (tableName) => ({ tableName, schema });
    const quoted = (name) => q.queryGenerator.quoteTable(table(name));
    await q.sequelize.transaction(async (transaction) => {
      const add = async (name, columns) => {
        const existing = await q.describeTable(table(name), { transaction });
        for (const [key, definition] of Object.entries(columns)) if (!existing[key]) await q.addColumn(table(name), key, definition, { transaction });
      };
      const initialUserColumns = await q.describeTable(table("users"), { transaction });
      await add("users", {
        location_consent_version: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
        deleted_at: { type: S.DATE, allowNull: true }, deleted_by_user_id: { type: S.UUID, allowNull: true },
        session_version: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
        auto_clock_out_enabled: { type: S.BOOLEAN, allowNull: false, defaultValue: false },
        auto_clock_out_time: { type: S.TIME, allowNull: true }, notification_sound_enabled: { type: S.BOOLEAN, allowNull: true },
        reporting_manager_mode: { type: S.STRING, allowNull: false, defaultValue: "department" },
      });
      await add("attendance_entries", { auto_clock_out_at: { type: S.DATE, allowNull: true }, clock_out_source: { type: S.STRING, allowNull: true } });
      await add("projects", { created_by_user_id: { type: S.UUID, allowNull: true } });
      await add("notifications", { broadcast_id: { type: S.UUID, allowNull: true } });
      await q.sequelize.query(`ALTER TABLE ${quoted("users")} DROP CONSTRAINT IF EXISTS users_auto_clock_out_consistent`, { transaction });
      await q.sequelize.query(`ALTER TABLE ${quoted("users")} ADD CONSTRAINT users_auto_clock_out_consistent CHECK ((auto_clock_out_enabled = false AND auto_clock_out_time IS NULL) OR (auto_clock_out_enabled = true AND auto_clock_out_time IS NOT NULL AND auto_clock_out_time = TIME '17:00'))`, { transaction });
      await q.sequelize.query(`ALTER TABLE ${quoted("users")} DROP CONSTRAINT IF EXISTS users_reporting_manager_mode_valid`, { transaction });
      await q.sequelize.query(`ALTER TABLE ${quoted("users")} ADD CONSTRAINT users_reporting_manager_mode_valid CHECK (reporting_manager_mode IN ('department', 'override'))`, { transaction });
      const tables = await q.showAllTables({ transaction });
      const exists = (name) => tables.some((entry) => typeof entry === "string" ? entry === name : entry.tableName === name && (!entry.schema || entry.schema === schema));
      if (!exists("audit_logs")) await q.createTable(table("audit_logs"), {
        audit_log_id: { type: S.UUID, primaryKey: true, allowNull: false }, actor_user_id: { type: S.UUID, allowNull: true }, actor_name: { type: S.TEXT, allowNull: true },
        action: { type: S.STRING, allowNull: false }, target_type: { type: S.STRING, allowNull: false }, target_id: { type: S.TEXT, allowNull: true },
        outcome: { type: S.STRING, allowNull: false, defaultValue: "success" }, changes: { type: S.JSONB, allowNull: false, defaultValue: {} }, occurred_at: { type: S.DATE, allowNull: false, defaultValue: S.fn("NOW") },
      }, { transaction });
      if (!exists("notification_broadcasts")) await q.createTable(table("notification_broadcasts"), {
        broadcast_id: { type: S.UUID, primaryKey: true, allowNull: false }, created_by: { type: S.UUID, allowNull: false },
        title: { type: S.TEXT, allowNull: false }, message: { type: S.TEXT, allowNull: false }, type: { type: S.STRING, allowNull: false },
        recipient_count: { type: S.INTEGER, allowNull: false, defaultValue: 0 }, created_at: { type: S.DATE, allowNull: false, defaultValue: S.fn("NOW") },
      }, { transaction });
      const index = async (name, fields, options) => {
        const indexes = await q.showIndex(table(name), { transaction });
        if (!indexes.some((i) => i.name === options.name)) await q.addIndex(table(name), fields, { ...options, transaction });
      };
      await index("users", ["deleted_at"], { name: "users_deleted_at" });
      await index("projects", ["created_by_user_id"], { name: "projects_created_by_user" });
      await index("attendance_entries", ["auto_clock_out_at"], { name: "attendance_pending_auto_clock_out", where: { clock_out: null, auto_clock_out_at: { [S.Op.ne]: null } } });
      await index("notifications", ["user_id", "broadcast_id"], { name: "notifications_broadcast_recipient_unique", unique: true });
      for (const [name, fields] of [["audit_logs_time", ["occurred_at"]], ["audit_logs_actor_time", ["actor_user_id", "occurred_at"]], ["audit_logs_target", ["target_type", "target_id"]], ["audit_logs_action_time", ["action", "occurred_at"]]]) await index("audit_logs", fields, { name });
      // Never overwrite configured role switches. Canonical project permission wins if both keys exist.
      await q.sequelize.query(`DELETE FROM ${quoted("role_permissions")} WHERE permission_key = 'create_project' AND EXISTS (SELECT 1 FROM ${quoted("role_permissions")} WHERE permission_key = 'create_projects')`, { transaction });
      await q.sequelize.query(`UPDATE ${quoted("role_permissions")} SET permission_key = 'create_projects' WHERE permission_key = 'create_project'`, { transaction });
      for (const permission of catalog) {
        const [rows] = await q.sequelize.query(`SELECT 1 FROM ${quoted("role_permissions")} WHERE permission_key = :key`, { replacements: { key: permission.permission_key }, transaction });
        if (!rows.length) await q.bulkInsert(table("role_permissions"), [{ role_permission_id: randomUUID(), ...permission, created_at: new Date(), updated_at: new Date() }], { transaction });
      }
      await q.sequelize.query(`UPDATE ${quoted("users")} SET workforce_permissions = array_replace(workforce_permissions, 'create_project', 'create_projects')`, { transaction });
      if (!initialUserColumns.reporting_manager_mode) {
      await q.sequelize.query(`UPDATE ${quoted("users")} SET reporting_manager_mode = 'override' WHERE reports_to_user_id IS NOT NULL`, { transaction });
      const [users] = await q.sequelize.query(`SELECT user_id, department_id, reports_to_user_id, is_active FROM ${quoted("users")}`, { transaction });
      const [departments] = await q.sequelize.query(`SELECT department_id, manager_user_id FROM ${quoted("departments")}`, { transaction });
      const links = new Map(users.map((u) => [u.user_id, u.reports_to_user_id]));
      for (const user of users.filter((u) => !u.reports_to_user_id)) {
        const manager = departments.find((d) => d.department_id === user.department_id)?.manager_user_id;
        if (!manager || manager === user.user_id || !users.some((u) => u.user_id === manager && u.is_active)) continue;
        const seen = new Set([user.user_id]); let cursor = manager;
        while (cursor && !seen.has(cursor)) { seen.add(cursor); cursor = links.get(cursor); }
        if (cursor) continue;
        links.set(user.user_id, manager);
        await q.sequelize.query(`UPDATE ${quoted("users")} SET reports_to_user_id = :manager WHERE user_id = :id`, { replacements: { manager, id: user.user_id }, transaction });
      }
      }
      await q.sequelize.query(`UPDATE ${quoted("attendance_entries")} SET clock_out_source = 'manual' WHERE clock_out IS NOT NULL AND clock_out_source IS NULL`, { transaction });
      const geoColumns = Object.keys(await q.describeTable(table("users"), { transaction })).filter((key) => key.startsWith("browser_"));
      if (geoColumns.length) await q.sequelize.query(`UPDATE ${quoted("users")} SET ${geoColumns.map((key) => `${q.queryGenerator.quoteIdentifier(key)} = NULL`).join(", ")} WHERE location_sharing_enabled = false`, { transaction });
      await q.sequelize.query(`UPDATE ${quoted("attendance_entries")} SET latitude = NULL, longitude = NULL, location_accuracy = NULL WHERE user_id IN (SELECT user_id FROM ${quoted("users")} WHERE location_sharing_enabled = false)`, { transaction });
    });
  },
  async down(q) {
    const schema = q.sequelize.options.schema || process.env.DB_SCHEMA || "public";
    const table = (tableName) => ({ tableName, schema });
    await q.sequelize.transaction(async (transaction) => {
      await q.sequelize.query(`ALTER TABLE ${q.queryGenerator.quoteTable(table("users"))} DROP CONSTRAINT IF EXISTS users_auto_clock_out_consistent, DROP CONSTRAINT IF EXISTS users_reporting_manager_mode_valid`, { transaction });
      for (const [name, fields] of Object.entries({ users: ["location_consent_version", "deleted_at", "deleted_by_user_id", "session_version", "auto_clock_out_enabled", "auto_clock_out_time", "notification_sound_enabled", "reporting_manager_mode"], attendance_entries: ["auto_clock_out_at", "clock_out_source"], projects: ["created_by_user_id"], notifications: ["broadcast_id"] })) {
        const columns = await q.describeTable(table(name), { transaction });
        for (const field of fields) if (columns[field]) await q.removeColumn(table(name), field, { transaction });
      }
      await q.dropTable(table("notification_broadcasts"), { transaction });
      await q.dropTable(table("audit_logs"), { transaction });
      // Purged location data cannot be restored by a schema rollback.
    });
  },
};
