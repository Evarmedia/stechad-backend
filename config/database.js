const { Sequelize } = require("sequelize");
const pg = require("pg");

const env = process.env.NODE_ENV || "development";
const config = require("./config")[env];

if (env === "production" && !config.url) {
  throw new Error("DATABASE_URL is required in production");
}

let sequelize;

if (config.url) {
  sequelize = new Sequelize(config.url, {
    dialect: config.dialect,
    dialectModule: pg,
    dialectOptions: config.dialectOptions,
    logging: config.logging || false,
    timezone: config.timezone,
    schema: config.schema,
    pool: {
      max: 2,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  });
} else {
  sequelize = new Sequelize(config.database, config.username, config.password, {
    host: config.host,
    dialect: config.dialect,
    dialectModule: pg,
    port: config.port || 5432,
    schema: config.schema,
    logging: false,
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

// Automatically apply schema to all models
sequelize.afterDefine((model) => {
  if (!model.options.schema) {
    model.options.schema = config.schema;
  }
});

module.exports = sequelize;
