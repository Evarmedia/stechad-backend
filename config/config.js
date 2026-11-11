// config/config.js
require("dotenv").config(); // Load environment variables

module.exports = {
  development: {
    username: "mosi",
    password: "mishakmosi",
    database: "stechad_db",
    host: "localhost",
    dialect: "postgres",
    schema: "public", // Development schema
    migrationStorageTableSchema: "public",
    port: 5432,
  },
  test: {
    username: "mosi",
    password: "mishakmosi",
    database: "stechad_test_db",
    host: "localhost",
    dialect: "postgres",
    schema: "mosi_schema", // Test schema
    migrationStorageTableSchema: "mosi_schema",
    port: 5432,
  },
  production: {
    url: process.env.DATABASE_URL,
    dialect: "postgres",
    timezone: "+01:00",
    schema: process.env.DB_SCHEMA || "public", // Production schema
    migrationStorageTableSchema: process.env.DB_SCHEMA || "public",
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
  },
};
