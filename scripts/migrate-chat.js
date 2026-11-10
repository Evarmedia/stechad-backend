require("dotenv").config();
const sequelize = require("../config/database");
const { migrateChatStorage } = require("../utils/chatMigration");
(async () => {
  try {
    await sequelize.authenticate();
    if (!(await migrateChatStorage()))
      throw new Error(
        "Base chat tables are missing. Initialize a fresh database with the application schema before disabling schema synchronization.",
      );
    console.log("Chat storage migration complete");
  } catch (error) {
    console.error("Chat storage migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
