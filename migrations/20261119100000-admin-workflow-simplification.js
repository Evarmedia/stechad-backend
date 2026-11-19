"use strict";
module.exports = {
  async up(q) {
    const schema = q.sequelize.options.schema || process.env.DB_SCHEMA || "public";
    const table = (name) => q.queryGenerator.quoteTable({ tableName: name, schema });
    const admins = `SELECT u.user_id FROM ${table("users")} u JOIN ${table("roles")} r ON r.role_id = u.role_id WHERE r.role_key IN ('admin', 'super_admin')`;
    await q.sequelize.transaction(async (transaction) => {
      await q.sequelize.query(`UPDATE ${table("users")} SET auto_clock_out_enabled = false, auto_clock_out_time = NULL WHERE user_id IN (${admins})`, { transaction });
      await q.sequelize.query(`UPDATE ${table("attendance_entries")} SET auto_clock_out_at = NULL, status = CASE WHEN status IN ('absent', 'cancelled') THEN status ELSE 'cancelled' END, clock_out_source = NULL WHERE clock_out IS NULL AND user_id IN (${admins})`, { transaction });
    });
  },
  // Preference resets and cancelled sessions cannot be reconstructed safely.
  async down() {},
};
