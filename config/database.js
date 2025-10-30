const { Sequelize } = require("sequelize");
const env = process.env.NODE_ENV || "development";
const config = require("../config/config")[env];

let sequelize;

if (config.url) {
  sequelize = new Sequelize(config.url, {
    dialect: config.dialect,
    dialectOptions: config.dialectOptions,
    logging: false,
  });
  // console.log(`Using database URL: ${config.url}`);
} else {
  sequelize = new Sequelize({
    dialect: config.dialect,
    storage: config.storage,
    logging:
      env === "development"
        ? (msg) => {
            const logMessage = `${env}Mode:\n${new Date().toISOString()} - ${msg}\n\n`;
            try {
              console.log(logMessage);
            } catch (err) {
              console.error("Error logging to file:", err);
            }
          }
        : false,
  });
}

module.exports = sequelize;
