const { Sequelize } = require("sequelize");
const env = process.env.NODE_ENV || "development";
const config = require("./config")[env];

let sequelize;

if (config.url) {
  sequelize = new Sequelize(config.url, {
    dialect: config.dialect,
    dialectOptions: config.dialectOptions,
    logging: config.logging || false,
    timezone: config.timezone,
    schema: config.schema, // Schema from config
  });
} else {
  sequelize = new Sequelize(config.database, config.username, config.password, {
    host: config.host,
    dialect: config.dialect,
    port: config.port || 5432,
    schema: config.schema, // Schema from config
    logging: false,
    // logging: env === "development" ? console.log : false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  });
}

// Make schema available globally
sequelize.schema = config.schema;

// Automatically apply schema to all models after they're defined
sequelize.afterDefine((model) => {
  if (!model.options.schema) {
    model.options.schema = config.schema;
  }
});

module.exports = sequelize;
