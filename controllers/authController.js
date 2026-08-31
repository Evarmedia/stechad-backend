const { User, Engineer, ProjectManager, Admin, Invite, RolePermission } = require("../models");
const { generateTokens } = require("../utils/generateTokens");
const sendEmail = require("../utils/sendEmail");
const { generateOTP, generateOTPExpiry } = require("../utils/otpGenerator");
const path = require("path");
const Sequelize = require("sequelize");
const sequelize = require("../config/database");
const {
  createReferral,
  validateReferralCode,
} = require("../utils/referralUtil");

const { Op } = require("sequelize");

const { getV4ReadSignedUrl } = require("../config/gcpStorage");
const { generateUniqueEmployeeId } = require("../utils/employeeId");
const { ROLE_INCLUDE, getRoleKey, findRoleByKey } = require("../utils/roleUtils");

const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;


// Optionally control TTL via env (days). Default: 7 days
const SIGNED_URL_TTL_SECONDS =
  Number(process.env.GCS_SIGNED_URL_TTL_SECONDS) ||
  Number(process.env.GCS_SIGNED_URL_TTL_DAYS || 7) * 24 * 3600;

// Helper function to format user response with signed URLs
const formatUserResponse = async (user) => {
  const data = user.toJSON();
  if (data.admin) data.admin.is_super_admin = data.role === "super_admin";

  if (data.role === "super_admin") {
    data.effective_permissions = ["*"];
  } else if (["admin", "project_manager", "staff"].includes(data.role)) {
    const roleColumn = data.role === "project_manager" ? "project_manager" : data.role;
    const configured = await RolePermission.findAll({ order: [["permission_key", "ASC"]] });
    const defaults = {
      admin: ["view_dashboard", "manage_departments", "approve_leave", "approve_expenses", "verify_receipts", "submit_expenses", "create_projects", "manage_staff", "manage_kpis", "approve_invoices"],
      project_manager: ["view_dashboard", "approve_leave", "submit_expenses", "create_projects", "manage_kpis"],
      staff: ["view_dashboard", "submit_expenses"],
    };
    const rolePermissions = configured.length
      ? configured.filter((permission) => Boolean(permission[roleColumn])).map((permission) => permission.permission_key)
      : defaults[data.role];
    data.effective_permissions = [...new Set([...(rolePermissions || []), ...(data.workforce_permissions || [])])];
  } else {
    data.effective_permissions = [];
  }

  // Add avatar URL if exists
  if (data.avatar_object_name) {
    try {
      data.avatar_url = await getV4ReadSignedUrl(
        data.avatar_object_name,
        SIGNED_URL_TTL_SECONDS
      );
    } catch (e) {
      data.avatar_url = null;
    }
  }

  // Add Engineer CV URL if exists
  if (data.engineer) {
    data.engineer = { ...data.engineer.toJSON() };
    if (data.engineer.cv_object_name) {
      try {
        data.engineer.cv_url = await getV4ReadSignedUrl(
          data.engineer.cv_object_name,
          SIGNED_URL_TTL_SECONDS
        );
      } catch (e) {
        data.engineer.cv_url = null;
      }
    } else {
      data.engineer.cv_url = null;
    }
  }

  // Add ProjectManager docs URL if exists (future use)
  if (data.project_manager) {
    data.project_manager = { ...data.project_manager.toJSON() };
  }

  return data;
};

const backendUrl =
  process.env.NODE_ENV === "development"
    ? process.env.BACKEND_URL
    : process.env.BACKEND_PROD_URL;
    
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${backendUrl}/api/auth/google/callback`,
    },
    async (accessToken, refreshToken, profile, done) => {
      // profile contains user information from Google
      try {
        const { email, first_name, last_name, id } = profile._json;

        // Check if the user exists in the database
        let user = await User.findOne({ where: { email } });

        if (!user) {
          const engineerRole = await findRoleByKey("engineer");
          if (!engineerRole) throw new Error("Engineer system role is not seeded");
          // Create a new user if they don't exist
          user = await User.create({
            email,
            first_name,
            last_name,
            role_id: engineerRole.role_id,
          });

          // Create role-specific record (for engineers)
          await Engineer.create({ user_id: user.user_id });
          user = await User.findByPk(user.user_id);
        }

        // Returning user object
        done(null, user);
      } catch (error) {
        done(error, null);
      }
    },
  ),
);

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
      googleSignIn, // Add this field to differentiate normal signup vs Google login
    } = req.body;

    if (!googleSignIn && role === "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Super Admin accounts can only be created with the manual seed command",
      });
    }

    // If Google sign-in is used, skip password check (no password needed for Google sign-in)
    if (!googleSignIn) {
      // Check if passwords match
      if (password !== confirm_password) {
        return res.status(400).json({
          success: false,
          message: "Passwords do not match",
        });
      }
      if (!email || !password || !confirm_password) {
        return res.status(400).json({
          success: false,
          message: "Please fill required fields",
        });
      }
    }

    // If Google sign-in is being used, check if the user exists
    if (googleSignIn) {
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        // If the user exists, generate a token and return the user data
        const { token } = generateTokens({
          user_id: existingUser.user_id,
          role: getRoleKey(existingUser),
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

    const roleKey = googleSignIn ? "engineer" : role;
    const assignedRole = await findRoleByKey(roleKey);
    if (!assignedRole || !assignedRole.is_system) {
      return res.status(400).json({ success: false, message: "A valid system role is required" });
    }

    // Create a new user record if Google sign-in is not used, or new user for Google login
    const user = await User.create({
      email,
      password: googleSignIn ? null : password, // Skip password if Google sign-in
      confirm_password: googleSignIn ? null : confirm_password, // Skip confirm password if Google sign-in
      first_name,
      last_name,
      role_id: assignedRole.role_id,
    });

    // Create role-specific records based on the role provided (for normal signup or Google login)
    if (roleKey === "engineer") {
      await Engineer.create({ user_id: user.user_id });
    } else if (roleKey === "project_manager") {
      await ProjectManager.create({ user_id: user.user_id, status: "active" });
    } else if (roleKey === "admin") {
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
    const { token, refreshToken } = generateTokens({
      user_id: user.user_id,
      role: roleKey,
    });

    // Format user response with signed URLs
    const createdUser = await User.findByPk(user.user_id, {
      include: [
        { model: Engineer, as: "engineer" },
        { model: ProjectManager, as: "project_manager" },
        { model: Admin, as: "admin" },
      ],
    });
    const formattedUser = await formatUserResponse(createdUser);

    // Respond with success message and user data + token (matching login format)
    res.status(201).json({
      success: true,
      message: googleSignIn
        ? "User logged in successfully"
        : "User registered successfully",
      data: {
        user: formattedUser,
        token,
        refreshToken,
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
    const user = await User.unscoped().findOne({
      where: { email },
      include: [
        ROLE_INCLUDE,
        { model: Engineer, as: "engineer" },
        { model: ProjectManager, as: "project_manager" },
        { model: Admin, as: "admin" },
      ],
    });

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
      role: getRoleKey(user),
    });

    const inviteRecord = await Invite.findOne({
      where: { email: user.email, status: "accepted" },
    });

    if (inviteRecord) {
      await inviteRecord.destroy();
    }

    // Format user response with signed URLs
    const formattedUser = await formatUserResponse(user);

    res.json({
      success: true,
      message: "Login successful",
      data: {
        user: formattedUser,
        token,
        refreshToken,
      },
    });
  } catch (error) {
    console.log(error);
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
    const { otp, new_password, confirm_password } = req.body;

    // 1. Validate input
    if (!otp || !new_password || !confirm_password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    // 2. Find user by valid OTP
    const user = await User.findOne({
      where: {
        reset_password_token: otp,
        reset_password_expires: {
          [Op.gt]: new Date(),
        },
      },
      attributes: { include: ["password"] }, // override default scope
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    // 3. Prevent reusing the same password
    const isSamePassword = await user.comparePassword(new_password);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from the old password",
      });
    }

    // 4. Update password (auto-hashed by beforeUpdate hook)
    await user.update({
      password: new_password,
      reset_password_token: null,
      reset_password_expires: null,
    });

    return res.status(200).json({
      success: true,
      message: "Password reset successful",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Password reset failed",
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
const acceptInvite = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const {
      // temp_password,
      new_password,
      confirm_password,
      first_name,
      last_name,
    } = req.body;

    const { token } = req.params;

    // const hashedToken = crypto.createHash("sha256").update(token).digest("hex");


    // 1️⃣ Find invite (outside transaction is fine)
    const invitedUser = await Invite.findOne({
      where: { token, status: "pending" },
    });

    if (!invitedUser) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid or expired invite",
      });
    }

    const invitedRoleKey = getRoleKey(invitedUser);
    if (invitedRoleKey === "super_admin") {
      await transaction.rollback();
      return res.status(409).json({
        success: false,
        message: "Super Admin invitations are no longer accepted. Use the manual seed command.",
      });
    }

    if (new Date() > invitedUser.expires_at) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Invite has expired",
      });
    }

    // 2️⃣ Validate temp password
    // const isTempMatch = await invitedUser.compareTempPassword(temp_password);
    // if (!isTempMatch) {
    //   await transaction.rollback();
    //   return res.status(401).json({
    //     success: false,
    //     message: "Temporary password is incorrect",
    //   });
    // }

    // 3️⃣ Validate password confirmation
    if (new_password !== confirm_password) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    // 4️⃣ Prevent duplicate user creation
    const alreadyUser = await User.findOne({
      where: { email: invitedUser.email },
    });

    if (alreadyUser) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Account already created",
      });
    }

    // ================================
    // 🔐 TRANSACTIONAL OPERATIONS START
    // ================================

    // 5️⃣ Create user
    const employeeId = invitedUser.employee_id || await generateUniqueEmployeeId({ transaction });
    const user = await User.create(
      {
        email: invitedUser.email,
        password: new_password,
        first_name: first_name || invitedUser.first_name,
        last_name: last_name || invitedUser.last_name,
        role_id: invitedUser.role_id,
        department_id: invitedUser.department_id || null,
        job_title: invitedUser.job_title || null,
        employee_id: employeeId,
      },
      { transaction }
    );

    // 6️⃣ Create role-specific record
    if (invitedRoleKey === "project_manager") {
      await ProjectManager.create(
        { user_id: user.user_id, status: "active" },
        { transaction }
      );
    } else if (["admin", "super_admin"].includes(invitedRoleKey)) {
      await Admin.create(
        { user_id: user.user_id, is_super_admin: invitedRoleKey === "super_admin" },
        { transaction }
      );
    }

    // 7️⃣ Invalidate invite
    await invitedUser.update(
      {
        status: "accepted",
        token: null,
        // temp_password: null,
        responded_at: new Date(),
      },
      { transaction }
    );

    // 8️⃣ Commit transaction
    await transaction.commit();

    res.status(201).json({
      success: true,
      message:
        "Invite accepted and user registered successfully. Please login with your new password.",
    });
  } catch (error) {
    // ❌ Rollback EVERYTHING on failure
    await transaction.rollback();

    res.status(500).json({
      success: false,
      message: "Failed to accept invite",
      error: error.message,
    });
  }
};

// Get current user profile /auth/me
const getMe = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.user_id, {
      include: [
        { model: Engineer, as: "engineer" },
        { model: ProjectManager, as: "project_manager" },
        { model: Admin, as: "admin" },
      ],
    });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Format user response with signed URLs using shared helper
    const formattedUser = await formatUserResponse(user);

    return res.json({
      success: true,
      data: {
        user: formattedUser,
      },
      meta: {
        signed_url_ttl_seconds: SIGNED_URL_TTL_SECONDS,
      },
    });
  } catch (error) {
    return res.status(500).json({
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
  acceptInvite,
  getMe,
  formatUserResponse,
};
