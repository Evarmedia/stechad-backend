module.exports = {
  development: {
    dialect: "sqlite",
    storage: "./stechad.db"
  },
  test: {
    dialect: "sqlite",
    storage: "./stechad.db"
  },
  production: {
    url: process.env.DATABASE_URL,
    dialect: "postgres",
    timezone: '+01:00',
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      }
    }
  }
};