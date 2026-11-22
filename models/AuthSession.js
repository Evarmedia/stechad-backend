const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const definitions = require('../services/authSessionSchema')(DataTypes);
const names = { auth_sessions: 'AuthSession', auth_refresh_tokens: 'AuthRefreshToken', auth_legacy_exchanges: 'AuthLegacyExchange', auth_security_state: 'AuthSecurityState', auth_oauth_attempts: 'AuthOAuthAttempt' };
for (const [tableName, attributes] of Object.entries(definitions)) {
  const primaryKey = Object.keys(attributes).find(key => attributes[key].primaryKey);
  attributes[primaryKey].defaultValue = primaryKey.endsWith('_id') ? DataTypes.UUIDV4 : undefined;
  sequelize.define(names[tableName], attributes, { tableName, timestamps: false, indexes: Object.keys(attributes).filter(key => attributes[key].references).map(key => ({ fields: [key], name: `${tableName}_${key}_idx` })) });
}
module.exports = sequelize.models.AuthSession;
