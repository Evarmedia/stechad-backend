const { User, Talent, ProjectManager, Admin, Invite, RolePermission } = require("../models");
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

const { emailWhere } = require("../utils/email");
const { passwordError } = require("../utils/passwordPolicy");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;


// Optionally control TTL via env (days). Default: 7 days
const SIGNED_URL_TTL_SECONDS =
  Number(process.env.GCS_SIGNED_URL_TTL_SECONDS) ||
  Number(process.env.GCS_SIGNED_URL_TTL_DAYS || 7) * 24 * 3600;

const associationToPlainObject = (association) => (
  association && typeof association.toJSON === "function"
    ? association.toJSON()
    : { ...association }
);

// Helper function to format user response with signed URLs
const formatUserResponse = async (user) => {
  const data = typeof user.toJSON === "function" ? user.toJSON() : { ...user };
  if (data.role && typeof data.role === "object") { data.role_details = data.role; data.role = data.role.role_key; }
  delete data.password; delete data.reset_password_token; delete data.reset_password_expires;
  if (data.admin) data.admin.is_super_admin = data.role === "super_admin";

  data.effective_permissions = await require("../utils/permissions").effectivePermissions(user);
  if (user.password !== undefined) data.has_password = Boolean(user.password);

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

  // Add Talent CV URL if exists
  if (data.talent) {
    data.talent = associationToPlainObject(data.talent);
    if (data.talent.cv_object_name) {
      try {
        data.talent.cv_url = await getV4ReadSignedUrl(
          data.talent.cv_object_name,
          SIGNED_URL_TTL_SECONDS
        );
      } catch (e) {
        data.talent.cv_url = null;
      }
    } else {
      data.talent.cv_url = null;
    }
  }

  // Add ProjectManager docs URL if exists (future use)
  if (data.project_manager) {
    data.project_manager = associationToPlainObject(data.project_manager);
  }

  return data;
};

async function publicTalentRole() {
  const { Role, Organization } = require('../models');
  const { STECHAD_ORGANIZATION_ID } = require('../services/tenancyInventory');
  const organization = await Organization.findByPk(STECHAD_ORGANIZATION_ID);
  if (organization || process.env.TENANCY_ENFORCED === 'true') return Role.findOne({ where: { organization_id: STECHAD_ORGANIZATION_ID, role_key: 'talent', is_system: true } });
  return Role.findOne({ where: { role_key: 'talent', is_system: true } });
}

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
        const { email, given_name, family_name } = profile._json;
        if (!email || !(profile._json.email_verified === true || profile._json.verified_email === true)) throw new Error('Google must verify your email address');
        const first_name = profile._json.first_name || given_name;
        const last_name = profile._json.last_name || family_name;

        // Check if the user exists in the database
        let user = await User.unscoped().findOne({ where: emailWhere(email), paranoid: false });
        if (user && (!user.is_active || user.deleted_at)) throw new Error("Account is unavailable");

        if (!user) {
          const talentRole = await publicTalentRole();
          if (!talentRole) throw new Error("Talent system role is not seeded");
          // Create a new user if they don't exist
          user = await sequelize.transaction(async (transaction) => {
            const created = await User.unscoped().create({ email, first_name, last_name, role_id: talentRole.role_id, is_verified: true }, { transaction });
            await require('../services/legacyHRBootstrap').ensureStechadMembership(created, { transaction });
            await Talent.create({ user_id: created.user_id, organization_id: talentRole.organization_id }, { transaction });
            return created;
          });
        }

        await sequelize.transaction(async (transaction) => {
          await user.update({ is_verified: true, last_login: new Date() }, { transaction });
          await require("../utils/audit").recordAudit({ action: "auth.login", target_type: "User", target_id: user.user_id, actor: user }, transaction);
        });
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

    if (googleSignIn) return res.status(403).json({ success: false, message: "Use the Google authentication redirect to sign in" });
    if (role !== "talent") return res.status(403).json({ success: false, message: "Accounts for this role require an administrator invitation" });
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

    // If Google sign-in is not used, check if user already exists
    if (!googleSignIn) {
      const existingUser = await User.unscoped().findOne({ where: emailWhere(email), paranoid: false });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "User already exists with this email",
        });
      }
    }

    // Validate referral code if provided (only for normal signup)
    if (referral_code) {
      const { OrganizationMembership } = require('../models');
      const referrer = await User.unscoped().findOne({ where: { referral_code, is_active: true } });
      const isValidReferral = referrer && await OrganizationMembership.findOne({ where: { organization_id: require('../services/tenancyInventory').STECHAD_ORGANIZATION_ID, user_id: referrer.user_id, status: 'active' } });
      if (!isValidReferral) {
        return res.status(400).json({
          success: false,
          message: "Invalid referral code",
        });
      }
    }

    const roleKey = googleSignIn ? "talent" : role;
    const assignedRole = await publicTalentRole();
    if (!assignedRole || !assignedRole.is_system) {
      return res.status(400).json({ success: false, message: "A valid system role is required" });
    }

    // Create a new user record if Google sign-in is not used, or new user for Google login
    const user = await sequelize.transaction(async (transaction) => {
      const created = await User.unscoped().create({ email, password, first_name, last_name, role_id: assignedRole.role_id }, { transaction });
      await require('../services/legacyHRBootstrap').ensureStechadMembership(created, { transaction });
      await Talent.create({ user_id: created.user_id, organization_id: assignedRole.organization_id }, { transaction });
      return created;
    });

    // Create referral record if referral code was used
    if (referral_code) {
      try {
        const { resolveTenantContext, runWithTenant } = require('../services/tenantContext');
        const context = await resolveTenantContext({ userId: user.user_id, organizationId: require('../services/tenancyInventory').STECHAD_ORGANIZATION_ID });
        await runWithTenant(context, () => createReferral(referral_code, user.user_id));
      } catch (referralError) {
        console.error("Error processing referral:", referralError);
      }
    }

    const { token, refreshToken, session: managedSession } = await require('../services/authSessions').createSession(user, { request: req });

    const session = await require('../services/organizationMembership').sessionView(user);

    // Respond with success message and user data + token (matching login format)
    res.status(201).json({
      success: true,
      message: googleSignIn
        ? "User logged in successfully"
        : "User registered successfully",
      data: {
        ...session,
        session: managedSession,
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
    const user = await User.unscoped().findOne({ where: emailWhere(email) });

    if (!user) {
      await require("../utils/audit").recordAudit({ action: "auth.login", target_type: "User", outcome: "failure" });
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }
    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      await require("../utils/audit").recordAudit({ action: "auth.login", target_type: "User", target_id: user.user_id, outcome: "failure" });
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
    await sequelize.transaction(async (transaction) => {
      await user.update({ last_login: new Date() }, { transaction });
      await require("../utils/audit").recordAudit({ action: "auth.login", target_type: "User", target_id: user.user_id, actor: user }, transaction);
    });

    const { token, refreshToken, session: managedSession } = await require('../services/authSessions').createSession(user, { request: req });

    const session = await require('../services/organizationMembership').sessionView(user, req.get('X-Organization-ID'));

    res.json({
      success: true,
      message: "Login successful",
      data: {
        ...session,
        session: managedSession,
        token,
        refreshToken,
      },
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: "Login failed",
      error: error.message,
    });
  }
};

// User logout
const logout = async (req, res) => {
  try {
    const sessions = require('../services/authSessions');
    if (req.authSession) await sessions.revokeSession(req.identity.user_id, req.authSession.session_id);
    else await require('./sessionController').invalidateAll(req.identity.user_id, 'legacy_logout');
    await require("../utils/audit").recordAudit({ action: "auth.logout", target_type: "User", target_id: req.user.user_id });
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

    const user = await User.unscoped().findOne({ where: emailWhere(email) });
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

    const user = await User.unscoped().findOne({
      where: {
        ...emailWhere(email),
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

    const policyError = passwordError(new_password);
    if (policyError) return res.status(400).json({ success: false, message: policyError, errors: { new_password: policyError } });

    await sequelize.transaction(async transaction => {
      const user = await User.unscoped().findOne({
        where: { reset_password_token: otp, reset_password_expires: { [Op.gt]: new Date() }, is_active: true },
        attributes: { include: ['password'] }, transaction, lock: transaction.LOCK.UPDATE,
      });
      if (!user || user.reset_password_token !== otp || new Date(user.reset_password_expires) <= new Date()) throw Object.assign(new Error('Invalid or expired OTP'), { status: 400 });
      if (await user.comparePassword(new_password)) throw Object.assign(new Error('New password must be different from the old password'), { status: 400 });
      await user.update({ password: new_password, session_version: user.session_version + 1, reset_password_token: null, reset_password_expires: null }, { transaction });
      await require('../services/authSessions').revokeAllSessions(user.user_id, { transaction, reason: 'password_reset' });
      await require('../utils/audit').recordAudit({ action: 'auth.password_reset', target_type: 'User', target_id: user.user_id, actor: user }, transaction);
    });

    return res.status(200).json({
      success: true,
      message: "Password reset successful",
    });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Password reset failed' });
  }
};

// Reset password using old password if from temp_password or password field
const editPassword = async (req, res) => {
  const { old_password, new_password, confirm_password } = req.body;

  try {
    const policyError = passwordError(new_password);
    if (policyError) return res.status(400).json({ success: false, message: policyError, errors: { new_password: policyError } });
    const user = await User.unscoped().findByPk(req.user.user_id, { attributes: { include: ["password"] } });

    if (!user.password) return res.status(409).json({ success: false, message: "This account has no password. Use Forgot password to establish one first." });
    // Check if old password matches
    const isMatch = await user.comparePassword(old_password);
    if (!isMatch) {
      return res.status(400).json({
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

    if (await user.comparePassword(new_password)) return res.status(400).json({ success: false, message: "New password must be different from the current password" });
    const tokens = await sequelize.transaction(async (transaction) => {
      const current = await User.unscoped().findByPk(user.user_id, { attributes: { include: ["password"] }, transaction, lock: { level: transaction.LOCK.UPDATE, of: User } });
      if (!await current.comparePassword(old_password)) throw Object.assign(new Error("Current password changed. Please try again."), { status: 409 });
      await current.update({ password: new_password, session_version: current.session_version + 1, reset_password_token: null, reset_password_expires: null }, { transaction });
      await require("../utils/audit").recordAudit({ action: "auth.password_changed", target_type: "User", target_id: user.user_id, actor: user }, transaction);
      await require('../services/authSessions').revokeAllSessions(current.user_id, { transaction, reason: 'password_changed' });
      return require('../services/authSessions').createSession(current, { transaction, request: req, authMethod: 'password' });
    });
    res.json({ success: true, message: "Password updated successfully", data: tokens });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Failed to update password",
      error: error.message,
    });
  }
};

// Both existing and new invitees redeem through the same transactionally locked service.
const acceptInvite = async (req, res) => {
  try {
    const data = await require('../services/organizationInvitations').acceptInvitation({ token: req.params.token || req.body.token, input: req.body, identity: req.identity });
    return res.status(201).json({ success: true, message: 'Invitation accepted successfully', data });
  } catch (error) { return res.status(error.status || (error.name === 'SequelizeUniqueConstraintError' ? 409 : 500)).json({ success: false, message: error.message, code: error.code }); }
};

// Global session remains available after membership revocation.
const getMe = async (req, res) => {
  try {
    const data = await require('../services/organizationMembership').sessionView(req.identity || req.user, req.get('X-Organization-ID'));
    data.current_session_id = req.authSession?.session_id || null;
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, data });
  } catch (error) { return res.status(error.status || 500).json({ success: false, message: error.message, code: error.code }); }
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
