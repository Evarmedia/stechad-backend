const { User, Engineer, ProjectManager, Admin, Invite } = require("../models");
const { generateTokens } = require("../utils/generateTokens");
const sendEmail = require("../utils/sendEmail");
const { generateOTP, generateOTPExpiry } = require("../utils/otpGenerator");
const path = require("path");
const Sequelize = require("sequelize");
const {
  createReferral,
  validateReferralCode,
} = require("../utils/referralUtil");

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: 'http://localhost:5000/api/auth/google/callback'
  },
  async (accessToken, refreshToken, profile, done) => {
    // profile contains user information from Google
    try {
      const { email, first_name, last_name, id } = profile._json;

      // Check if the user exists in the database
      let user = await User.findOne({ where: { email } });
      
      if (!user) {
        // Create a new user if they don't exist
        user = await User.create({
          email,
          first_name,
          last_name,
          role: 'engineer',  // default role or make it dynamic if needed
        });

        // Create role-specific record (for engineers)
        await Engineer.create({ user_id: user.user_id });
      }

      // Returning user object
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  }
));

// Serialize user
passport.serializeUser((user, done) => {
  done(null, user.user_id);
});

// Deserialize user
passport.deserializeUser(async (id, done) => {
  const user = await User.findOne({ where: { user_id: id } });
  done(null, user);
});

const signup = async (req, res) => {
  try {
    const {
      email,
      password,
      confirm_password,
      first_name,
      last_name,
      role,
      referral_code,
      googleSignIn,  // Add this field to differentiate normal signup vs Google login
    } = req.body;

    // If Google sign-in is used, skip password check (no password needed for Google sign-in)
    if (!googleSignIn) {
      // Check if passwords match
      if (password !== confirm_password) {
        return res.status(400).json({
          success: false,
          message: "Passwords do not match",
        });
      }
      if (!email || !password || !confirm_password || !first_name || !last_name){
        return res.status(400).json({
          success: false,
          message: "Please fill all required fields"
        })
      }
    }

    // If Google sign-in is being used, check if the user exists
    if (googleSignIn) {
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        // If the user exists, generate a token and return the user data
        const { token } = generateTokens({
          user_id: existingUser.user_id,
          role: existingUser.role,
        });
        return res.status(200).json({
          success: true,
          message: "User logged in successfully",
          data: {
            user: existingUser,
            token,
          },
        });
      }
    }

    // If Google sign-in is not used, check if user already exists
    if (!googleSignIn) {
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "User already exists with this email",
        });
      }
    }

    // Validate referral code if provided (only for normal signup)
    if (referral_code) {
      const isValidReferral = await validateReferralCode(referral_code);
      if (!isValidReferral) {
        return res.status(400).json({
          success: false,
          message: "Invalid referral code",
        });
      }
    }

    // Create a new user record if Google sign-in is not used, or new user for Google login
    const user = await User.create({
      email,
      password: googleSignIn ? null : password,  // Skip password if Google sign-in
      confirm_password: googleSignIn ? null : confirm_password,  // Skip confirm password if Google sign-in
      first_name,
      last_name,
      role: googleSignIn ? 'engineer' : role,  // Default to 'engineer' role for Google users
    });

    // Create role-specific records based on the role provided (for normal signup or Google login)
    if (role === "engineer" || googleSignIn) {
      await Engineer.create({ user_id: user.user_id });
    } else if (role === "project_manager") {
      await ProjectManager.create({ user_id: user.user_id });
    } else if (role === "admin") {
      await Admin.create({ user_id: user.user_id });
    }

    // Create referral record if referral code was used
    if (referral_code) {
      try {
        await createReferral(referral_code, user.user_id);
      } catch (referralError) {
        console.error("Error processing referral:", referralError);
      }
    }

    // Generate token for user login (both for normal signup and Google sign-in)
    const { token } = generateTokens({
      user_id: user.user_id,
      role: user.role,
    });

    // Respond with success message and user data + token
    res.status(201).json({
      success: true,
      message: googleSignIn ? "User logged in successfully" : "User registered successfully",
      data: {
        user: user.toJSON(),
        token,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Registration failed",
      error: error.message,
    });
  }
};

// User login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }
    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Check if account is active
    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        message: "Account has been deactivated",
      });
    }

    // Update last login
    await user.update({ last_login: new Date() });

    // Generate token
    const { token, refreshToken } = generateTokens({
      user_id: user.user_id,
      role: user.role,
    });

    const inviteRecord = await Invite.findOne({
      where: { email: user.email, status: "accepted" },
    });

    if (inviteRecord) {
      await inviteRecord.destroy();
    }

    res.json({
      success: true,
      message: "Login successful",
      data: {
        user: user.toJSON(),
        token,
        refreshToken,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Login failed",
      error: error.message,
    });
  }
};

// User logout
const logout = async (req, res) => {
  try {
    // blacklist the token here
    res.json({
      success: true,
      message: "Logout successful",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Logout failed",
      error: error.message,
    });
  }
};

// for Forgot password and email verification
const sendOtp = async (req, res) => {
  try {
    const { email, purpose } = req.body;

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found with this email",
      });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = generateOTPExpiry();

    // Save OTP to user
    await user.update({
      reset_password_token: otp,
      reset_password_expires: otpExpiry,
    });

    const htmlFilePath = path.join(
      __dirname,
      "../templates/resetOtpEmail.html"
    );
    const header =
      purpose === "password_reset"
        ? "Password Reset Request"
        : "Email Verification";
    const subject =
      purpose === "password_reset"
        ? "Password Reset OTP"
        : "Email Verification OTP";
    const replacements = {
      header,
      firstname: user.first_name,
      lastname: user.last_name,
      resetCode: otp,
    };
    await sendEmail({
      to: user.email,
      subject,
      htmlFilePath,
      replacements,
    });

    res.json({
      success: true,
      message: "OTP sent to your email",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to send OTP",
      error: error.message,
    });
  }
};

// Verify OTP
const verifyEmail = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({
      where: {
        email,
        reset_password_token: otp,
        reset_password_expires: {
          [Sequelize.Op.gt]: new Date(),
        },
      },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    if (user.is_verified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified",
      });
    }

    // Remove the token after verification
    await user.update({
      is_verified: true,
      reset_password_token: null,
      reset_password_expires: null,
    });

    res.json({
      success: true,
      message: "Email verified successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Email verification failed",
      error: error.message,
    });
  }
};

// Reset password
const resetPassword = async (req, res) => {
  try {
    const { email, otp, new_password, confirm_password } = req.body;

    if (new_password !== confirm_password) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    const user = await User.findOne({
      where: {
        email,
        reset_password_token: otp,
        reset_password_expires: {
          [require("sequelize").Op.gt]: new Date(),
        },
      },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    // Update password and clear reset token
    await user.update({
      password: new_password,
      reset_password_token: null,
      reset_password_expires: null,
    });

    res.json({
      success: true,
      message: "Password reset successful",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Password reset failed",
      error: error.message,
    });
  }
};

// Reset password using old password if from temp_password or password field
const editPassword = async (req, res) => {
  const { old_password, new_password, confirm_password } = req.body;

  try {
    const user = await User.findByPk(req.user.user_id);

    // Check if old password matches
    const isMatch = await user.comparePassword(old_password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Old password is incorrect",
      });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({
        success: false,
        message: "New passwords do not match",
      });
    }

    // Update password
    await user.update({
      password: new_password,
    });

    res.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update password",
      error: error.message,
    });
  }
};

// accept invite
const acceptInvites = async (req, res) => {
  try {
    const {
      temp_password,
      new_password,
      confirm_password,
      first_name,
      last_name,
    } = req.body;

    const { token } = req.params;

    // Find invite
    const invitedUser = await Invite.findOne({
      where: { token, status: "pending" },
    });
    if (!invitedUser) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired invite",
      });
    }

    // compare temp password
    const isTempMatch = await invitedUser.compareTempPassword(temp_password);
    if (!isTempMatch) {
      return res.status(401).json({
        success: false,
        message: "Temporary password is incorrect",
      });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    // Create user
    const user = await User.create({
      email: invitedUser.email,
      password: new_password,
      first_name: first_name || invitedUser.first_name,
      last_name: last_name || invitedUser.last_name,
      role: invitedUser.role,
    });

    // Create role-specific record
    if (invitedUser.role === "engineer") {
      await Engineer.create({ user_id: user.user_id });
    } else if (invitedUser.role === "project_manager") {
      await ProjectManager.create({ user_id: user.user_id });
    }
    // Update invite status
    await invitedUser.update({
      status: "accepted",
      responded_at: new Date(),
    });

    res.status(201).json({
      success: true,
      message: "Invite accepted and user registered successfully, Please Login",
      data: {
        user: user.toJSON(),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to accept invite",
      error: error.message,
    });
  }
};

// Get current user profile
const getMe = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.user_id, {
      include: [
        { model: Engineer, as: "engineer" },
        { model: ProjectManager, as: "project_manager" },
        { model: Admin, as: "admin" },
      ],
    });

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get user profile",
      error: error.message,
    });
  }
};

module.exports = {
  signup,
  login,
  logout,
  sendOtp,
  verifyEmail,
  resetPassword,
  editPassword,
  acceptInvites,
  getMe,
};
