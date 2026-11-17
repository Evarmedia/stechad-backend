"use strict";

const { QueryTypes } = require("sequelize");
const columns = { users: ["email"], invites: ["email"], interviews: ["candidate_email", "interviewer_email"] };
const schemaFor = (qi) => qi.sequelize.options.schema || "public";
const tableFor = (qi, name) => qi.queryGenerator.quoteTable({ tableName: name, schema: schemaFor(qi) });

module.exports = {
  async up(qi) {
    await qi.sequelize.transaction(async (transaction) => {
      // Keep the collision check and rewrite atomic with respect to writers.
      await qi.sequelize.query(`LOCK TABLE ${Object.keys(columns).map((name) => tableFor(qi, name)).join(", ")} IN SHARE ROW EXCLUSIVE MODE`, { transaction });
      const users = tableFor(qi, "users");
      const collisions = await qi.sequelize.query(
        `SELECT lower(btrim(email)) AS email, array_agg(user_id) AS user_ids
         FROM ${users} GROUP BY lower(btrim(email)) HAVING count(*) > 1`,
        { transaction, type: QueryTypes.SELECT },
      );
      if (collisions.length) {
        throw new Error(`Email normalization blocked: ${collisions.length} duplicate account group(s). Resolve users with IDs: ${collisions.map((row) => row.user_ids.join(", ")).join("; ")}`);
      }
      for (const [table, fields] of Object.entries(columns)) {
        for (const field of fields) {
          const quoted = qi.queryGenerator.quoteIdentifier(field);
          await qi.sequelize.query(
            `UPDATE ${tableFor(qi, table)} SET ${quoted} = lower(btrim(${quoted})) WHERE ${quoted} IS DISTINCT FROM lower(btrim(${quoted}))`,
            { transaction },
          );
          await qi.addConstraint({ tableName: table, schema: schemaFor(qi) }, {
            fields: [field], type: "check", name: `${table}_${field}_normalized`,
            where: qi.sequelize.literal(`${quoted} = lower(btrim(${quoted}))`), transaction,
          });
        }
      }
      // This expression also supports lookups of legacy mixed-case addresses.
      await qi.sequelize.query(`CREATE UNIQUE INDEX users_email_normalized_unique ON ${users} (lower(btrim(email)))`, { transaction });
      await qi.sequelize.query(`CREATE INDEX invites_email_normalized ON ${tableFor(qi, "invites")} (lower(btrim(email)))`, { transaction });
    });
  },
  async down(qi) {
    await qi.sequelize.transaction(async (transaction) => {
      const schema = qi.queryGenerator.quoteIdentifier(schemaFor(qi));
      for (const index of ["users_email_normalized_unique", "invites_email_normalized"]) {
        await qi.sequelize.query(`DROP INDEX ${schema}.${index}`, { transaction });
      }
      for (const [table, fields] of Object.entries(columns)) {
        for (const field of fields) {
          await qi.removeConstraint({ tableName: table, schema: schemaFor(qi) }, `${table}_${field}_normalized`, { transaction });
        }
      }
      // Original casing cannot be recovered; account data and passwords are retained.
    });
  },
};
