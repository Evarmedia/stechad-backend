const jwt = require("jsonwebtoken");

function generateTokens({user_id, role}) {
  try {
    const token = jwt.sign(
      { user_id, role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRATION || '7h' }
    );

    const refreshToken = jwt.sign(
      { user_id, role },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRATION || '1d' }
    );

    return { token, refreshToken };
  } catch (error) {
    throw new Error('Failed to generate tokens');
  }
}

module.exports = { generateTokens };
