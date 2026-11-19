"use strict";

const unlinkableColumns = {
  applications: ["talent_id"],
  attendance_entries: ["user_id"],
  chats: ["created_by"],
  expense_claims: ["user_id"],
  holidays: ["created_by"],
  interviews: ["candidate_id", "interviewer_id"],
  invoices: ["submitted_by"],
  invites: ["invited_by_user_id"],
  kpi_appraisals: ["recorded_by"],
  kpis: ["assigned_to_user_id", "created_by"],
  leave_requests: ["user_id"],
  messages: ["sender_id"],
  notification_broadcasts: ["created_by"],
  referrals: ["referee_id", "referrer_id"],
  user_rewards: ["user_id"],
};

function getTable(queryInterface, tableName) {
  return {
    tableName,
    schema: queryInterface.sequelize.options.schema || process.env.DB_SCHEMA || "public",
  };
}

async function setNullability(queryInterface, tableName, columnName, nullable, transaction) {
  const table = getTable(queryInterface, tableName);
  const columns = await queryInterface.describeTable(table, { transaction });
  if (!columns[columnName]) {
    throw new Error(`Missing ${tableName}.${columnName} required by permanent user deletion`);
  }
  if (columns[columnName].allowNull === nullable) return;

  const quotedTable = queryInterface.queryGenerator.quoteTable(table);
  const quotedColumn = queryInterface.queryGenerator.quoteIdentifier(columnName);
  if (!nullable) {
    const [rows] = await queryInterface.sequelize.query(
      `SELECT 1 FROM ${quotedTable} WHERE ${quotedColumn} IS NULL LIMIT 1`,
      { transaction },
    );
    if (rows.length) {
      throw new Error(`Cannot restore NOT NULL on ${tableName}.${columnName} while unlinked history remains`);
    }
  }
  const action = nullable ? "DROP NOT NULL" : "SET NOT NULL";
  await queryInterface.sequelize.query(
    `ALTER TABLE ${quotedTable} ALTER COLUMN ${quotedColumn} ${action}`,
    { transaction },
  );
}

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const [tableName, columns] of Object.entries(unlinkableColumns)) {
        for (const columnName of columns) {
          await setNullability(queryInterface, tableName, columnName, true, transaction);
        }
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const [tableName, columns] of Object.entries(unlinkableColumns)) {
        for (const columnName of columns) {
          await setNullability(queryInterface, tableName, columnName, false, transaction);
        }
      }
    });
  },
};
