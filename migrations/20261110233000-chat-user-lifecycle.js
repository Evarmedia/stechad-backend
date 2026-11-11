"use strict";

const tableFor = (queryInterface) => ({
  tableName: "chat_user_states",
  schema:
    process.env.DB_SCHEMA ||
    queryInterface.sequelize.options.schema ||
    "public",
});

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = tableFor(queryInterface);
    await queryInterface.sequelize.transaction(async (transaction) => {
      const columns = await queryInterface.describeTable(table, {
        transaction,
      });
      if (!columns.hidden_through_sequence)
        await queryInterface.addColumn(
          table,
          "hidden_through_sequence",
          { type: Sequelize.BIGINT, allowNull: true },
          { transaction },
        );
      if (!columns.left_through_sequence)
        await queryInterface.addColumn(
          table,
          "left_through_sequence",
          { type: Sequelize.BIGINT, allowNull: true },
          { transaction },
        );

      const indexes = await queryInterface.showIndex(table, { transaction });
      const names = new Set(indexes.map((index) => index.name));
      if (!names.has("chat_user_states_hidden_by_user"))
        await queryInterface.addIndex(
          table,
          ["user_id", "chat_id", "hidden_through_sequence"],
          {
            name: "chat_user_states_hidden_by_user",
            where: {
              hidden_through_sequence: { [Sequelize.Op.ne]: null },
            },
            transaction,
          },
        );
      if (!names.has("chat_user_states_left_by_user"))
        await queryInterface.addIndex(
          table,
          ["user_id", "chat_id", "left_through_sequence"],
          {
            name: "chat_user_states_left_by_user",
            where: { left_through_sequence: { [Sequelize.Op.ne]: null } },
            transaction,
          },
        );
    });
  },

  async down(queryInterface) {
    const table = tableFor(queryInterface);
    await queryInterface.sequelize.transaction(async (transaction) => {
      const indexes = await queryInterface.showIndex(table, { transaction });
      const names = new Set(indexes.map((index) => index.name));
      if (names.has("chat_user_states_left_by_user"))
        await queryInterface.removeIndex(
          table,
          "chat_user_states_left_by_user",
          { transaction },
        );
      if (names.has("chat_user_states_hidden_by_user"))
        await queryInterface.removeIndex(
          table,
          "chat_user_states_hidden_by_user",
          { transaction },
        );
      const columns = await queryInterface.describeTable(table, {
        transaction,
      });
      if (columns.left_through_sequence)
        await queryInterface.removeColumn(table, "left_through_sequence", {
          transaction,
        });
      if (columns.hidden_through_sequence)
        await queryInterface.removeColumn(table, "hidden_through_sequence", {
          transaction,
        });
    });
  },
};
