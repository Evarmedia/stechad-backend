const jwt = require("jsonwebtoken");

// Legacy fixture compatibility only. Runtime issuance uses authSessions.createSession.
function generateTokens({user_id, role, session_version = 0}) {
  if (process.env.AUTH_SESSIONS_ENFORCED === 'true' || process.env.NODE_ENV === 'production') throw new Error('Use managed session issuance');
  try {
    const token = jwt.sign(
      { user_id, role, session_version },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRATION || '7h' }
    );

    const refreshToken = jwt.sign(
      { user_id, role, session_version },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRATION || '1d' }
    );

    return { token, refreshToken };
  } catch (error) {
    throw new Error('Failed to generate tokens');
  }
}

module.exports = { generateTokens };
