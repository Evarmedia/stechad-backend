const sequelize = require("../config/database");

// Run before sync for existing installations, and after sync for a fresh database.
// This migration deliberately does not depend on sync({ alter: true }).
async function migrateChatStorage() {
  const q = sequelize.getQueryInterface().queryGenerator;
  const schema = sequelize.schema || sequelize.options.schema || "public";
  const table = (name) => q.quoteTable({ schema, tableName: name });
  return sequelize.transaction(async (transaction) => {
    const run = (sql, options = {}) =>
      sequelize.query(sql, { transaction, ...options });
    await run("SELECT pg_advisory_xact_lock(hashtext(:key))", {
      replacements: { key: `${schema}:chat-storage-v1` },
    });
    const existing = await run(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = :schema AND table_name IN ('chats', 'messages', 'notifications')",
      {
        replacements: { schema },
        type: require("sequelize").QueryTypes.SELECT,
      },
    );
    if (existing.length !== 3) return false;
    await run(`ALTER TABLE ${table("chats")}
      ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS avatar_object_name TEXT,
      ADD COLUMN IF NOT EXISTS posting_policy VARCHAR(20) NOT NULL DEFAULT 'all_members'`);
    // A database sequence assigns a durable order to legacy rows and future sends.
    await run(
      `CREATE SEQUENCE IF NOT EXISTS ${table("chat_message_sequence")}`,
    );
    await run(
      `ALTER TABLE ${table("messages")} ADD COLUMN IF NOT EXISTS message_sequence BIGINT`,
    );
    await run(`CREATE TABLE IF NOT EXISTS ${table("chat_user_states")} (
      chat_id UUID NOT NULL REFERENCES ${table("chats")}(chats_id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES ${table("users")}(user_id) ON DELETE CASCADE,
      cleared_through_sequence BIGINT NOT NULL DEFAULT 0,
      unread_since_sequence BIGINT NOT NULL DEFAULT 0,
      hidden_through_sequence BIGINT,
      PRIMARY KEY (chat_id, user_id))`);
    await run(
      `ALTER TABLE ${table("chat_user_states")} ADD COLUMN IF NOT EXISTS hidden_through_sequence BIGINT`,
    );
    // Restores or an older sequence/default can leave the counter behind rows
    // already in the table. Align it before backfilling NULLs or accepting sends.
    // ALTER TABLE above holds the message write lock until this transaction ends.
    // Include personal watermarks so even a deleted high-sequence message cannot
    // make future messages fall behind a user's clear or membership boundary.
    const [floor] = await run(
      `SELECT GREATEST(
      COALESCE((SELECT MAX(message_sequence) FROM ${table("messages")}), 0),
      COALESCE((SELECT MAX(GREATEST(cleared_through_sequence, unread_since_sequence, COALESCE(hidden_through_sequence, 0))) FROM ${table("chat_user_states")}), 0)
    )::text AS value`,
      { type: require("sequelize").QueryTypes.SELECT },
    );
    const [counter] = await run(
      `SELECT last_value::text, is_called FROM ${table("chat_message_sequence")}`,
      {
        type: require("sequelize").QueryTypes.SELECT,
      },
    );
    const next = BigInt(counter.last_value) + (counter.is_called ? 1n : 0n);
    const required = BigInt(floor.value) + 1n;
    // Even an already-advanced counter may have old allocations cached on other
    // connections. RESTART invalidates those caches without moving it backwards.
    // Unlike setval, it also rolls back if a later migration statement fails.
    const restart = required > next ? required : next;
    await run(
      `ALTER SEQUENCE ${table("chat_message_sequence")} RESTART WITH ${restart}`,
    );
    const sequenceName = table("chat_message_sequence").replace(/'/g, "''");
    await run(
      `ALTER TABLE ${table("messages")} ALTER COLUMN message_sequence SET DEFAULT nextval('${sequenceName}'::regclass)`,
    );
    await run(
      `UPDATE ${table("messages")} SET message_sequence = nextval('${sequenceName}'::regclass) WHERE message_sequence IS NULL`,
    );
    await run(
      `ALTER TABLE ${table("messages")} ALTER COLUMN message_sequence SET NOT NULL`,
    );
    await run(
      `CREATE UNIQUE INDEX IF NOT EXISTS messages_sequence_unique ON ${table("messages")} (message_sequence)`,
    );
    await run(
      `CREATE INDEX IF NOT EXISTS messages_chat_sequence ON ${table("messages")} (chat_id, message_sequence)`,
    );
    await run(
      `CREATE INDEX IF NOT EXISTS chat_user_states_hidden_by_user ON ${table("chat_user_states")} (user_id, chat_id, hidden_through_sequence) WHERE hidden_through_sequence IS NOT NULL`,
    );
    await run(
      `ALTER TABLE ${table("notifications")} ADD COLUMN IF NOT EXISTS chat_message_id UUID REFERENCES ${table("messages")}(messages_id) ON DELETE CASCADE`,
    );
    await run(
      `CREATE UNIQUE INDEX IF NOT EXISTS notifications_recipient_message_unique ON ${table("notifications")} (user_id, chat_message_id)`,
    );
    await run(
      `CREATE INDEX IF NOT EXISTS notifications_message_lookup ON ${table("notifications")} (chat_message_id) WHERE chat_message_id IS NOT NULL`,
    );
    return true;
  });
}
module.exports = { migrateChatStorage };
