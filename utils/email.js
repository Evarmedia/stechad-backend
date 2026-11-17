const { Op, fn, col, where } = require("sequelize");

// Preserve dots and plus tags: only whitespace and casing are normalized.
const normalizeEmail = (value) => typeof value === "string" ? value.trim().toLowerCase() : value;

const emailAttribute = (DataTypes, field = "email", options = {}) => ({
  type: DataTypes.TEXT,
  ...options,
  set(value) { this.setDataValue(field, normalizeEmail(value)); },
});

// Also matches legacy records while the normalization migration is rolling out.
const emailWhere = (email, model = "User", extra = {}) => ({
  ...extra,
  [Op.and]: where(fn("lower", fn("btrim", col(`${model}.email`))), normalizeEmail(email)),
});

module.exports = { normalizeEmail, emailAttribute, emailWhere };
