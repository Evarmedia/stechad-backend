const jwt = require("jsonwebtoken");
const { User } = require("../models");
const { getRoleKey } = require("../utils/roleUtils");
const { generateTokens } = require("../utils/generateTokens");

const refreshAccessToken = async (req, res) => {
  const refreshToken = req.body.refresh_token;
  if (typeof refreshToken !== "string" || !refreshToken) {
    return res
      .status(400)
      .json({ success: false, message: "A refresh token is required" });
  }
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, {
      algorithms: ["HS256"],
    });
    const user = await User.findByPk(decoded.user_id);
    if (!user?.is_active || (decoded.session_version || 0) !== user.session_version)
      return res
        .status(401)
        .json({ success: false, message: "Session is no longer valid" });
    const tokens = generateTokens({
      user_id: user.user_id,
      role: getRoleKey(user),
      session_version: user.session_version,
    });
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data: tokens });
  } catch {
    return res
      .status(401)
      .json({ success: false, message: "Refresh token is not valid" });
  }
};

module.exports = { refreshAccessToken };
