const { normalizeBirthday } = require("../utils/birthday");
const {
  User,
  Talent,
  Job,
  Application,
  Project,
  Interview,
  ProjectManager,
} = require("../services/hrModels");
const { Op } = require("sequelize");
const { uploadToGCP, deleteFromGCP } = require("../middleware/upload");
const { getV4ReadSignedUrl } = require("../config/gcpStorage");
const { toInt, toTextArray, toBool } = require("../utils/helpers");
const { formatUserResponse } = require("./authController");
const { generateTokens } = require("../utils/generateTokens");
const { getRoleKey, ROLE_INCLUDE } = require("../utils/roleUtils");
const {
  notifyJobPosterOfApplication,
} = require("../utils/notificationUtil");

// Complete talent onboarding (multipart/form-data)
const completeOnboarding = async (req, res) => {
  try {
    if (req.body.date_of_birth !== undefined) {
      try { req.body.date_of_birth = normalizeBirthday(req.body.date_of_birth); }
      catch (error) { return res.status(400).json({ success: false, message: error.message }); }
    }
    // console.log('🟢 [BACKEND] ========== STEP 1: Fetching user and talent records ==========');
    const user = await User.findByPk(req.user.user_id);

    if (!user) {
      // console.error('🔴 [BACKEND] User not found:', req.user.user_id);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    // console.log('  ✓ User found:', user.user_id, user.email);

    const talent = await Talent.findOne({
      where: { user_id: req.user.user_id },
    });

    if (!talent) {
      // console.error('🔴 [BACKEND] Talent profile not found for user:', req.user.user_id);
      return res.status(404).json({
        success: false,
        message: "Talent profile not found",
      });
    }
    // console.log('  ✓ Talent profile found:', talent.talent_id);

    // --- 1. Track old CV for cleanup ---
    const oldCvObjectName = talent.cv_object_name;
    let newCvObjectName = null;

    // --- 2. Upload CV file if provided ---
    // console.log('🟢 [BACKEND] ========== STEP 2: Processing file upload ==========');
    if (req.file) {
      console.log(
        "  ℹ️  CV file received:",
        req.file.originalname,
        "(" + req.file.size + " bytes)"
      );
      const { objectName } = await uploadToGCP(
        req.file,
        req.user.user_id,
        "resumes"
      );
      newCvObjectName = objectName;
      console.log("  ✓ CV uploaded to GCP:", newCvObjectName);
    } else {
      console.log("  ℹ️  No CV file provided in request");
    }

    // --- 3. Extract form fields ---
    // console.log('🟢 [BACKEND] ========== STEP 3: Extracting and validating form fields ==========');
    const {
      first_name,
      last_name,
      phone_number,
      city,
      country,
      date_of_birth,
      open_to_nearby_cities,
      languages,
      language_proficiency,
      has_drivers_license,
      has_car,
      is_native,
      work_authorized,
      specialization,
      skill_level,
      years_of_experience,
      certifications,
      project_types,
      open_to_training,
      is_freelancer,
      follows_linkedin,
      referee_info,
      newsletter,
      special_preferences,
    } = req.body;

    // console.log('  📥 Received from FormData:');
    // console.log('    - language_proficiency (raw):', language_proficiency);
    // console.log('    - skill_level (raw):', skill_level);
    // console.log('    - languages:', languages);
    // console.log('    - specialization:', specialization);

    // --- 4. Update talent ---
    // console.log('🟢 [BACKEND] ========== STEP 4: Preparing talent updates ==========');
    try {
      // 🔴 CRITICAL: Convert ENUM values to lowercase for PostgreSQL
      const processedLanguageProficiency = language_proficiency
        ? language_proficiency.toLowerCase()
        : null;
      const processedSkillLevel = skill_level
        ? skill_level.toLowerCase()
        : null;

      // console.log('  🔄 ENUM Conversions:');
      // console.log('    - language_proficiency: "' + language_proficiency + '" → "' + processedLanguageProficiency + '"');
      // console.log('    - skill_level: "' + skill_level + '" → "' + processedSkillLevel + '"');

      const talentUpdates = {
        date_of_birth: date_of_birth || null,
        open_to_nearby_cities: toBool(open_to_nearby_cities),
        languages: toTextArray(languages) || [],
        language_proficiency: processedLanguageProficiency,
        has_drivers_license: toBool(has_drivers_license),
        has_car: toBool(has_car),
        is_native: toBool(is_native),
        work_authorized: toBool(work_authorized),
        specialization: toTextArray(specialization) || [],
        skill_level: processedSkillLevel,
        years_of_experience: toInt(years_of_experience),
        certifications: toTextArray(certifications) || [],
        project_types: toTextArray(project_types) || [],
        open_to_training: toBool(open_to_training),
        is_freelancer: toBool(is_freelancer),
        follows_linkedin: toBool(follows_linkedin),
        referee_info: referee_info || null,
        newsletter: toBool(newsletter),
        special_preferences: special_preferences || null,
        is_onboarded: true,
        onboarded_at: new Date(),
        ...(newCvObjectName && { cv_object_name: newCvObjectName }),
      };

      // console.log('  📤 Prepared updates for Talent:');
      // console.log('    - date_of_birth:', talentUpdates.date_of_birth);
      // console.log('    - languages:', talentUpdates.languages);
      // console.log('    - language_proficiency:', talentUpdates.language_proficiency);
      // console.log('    - specialization:', talentUpdates.specialization);
      // console.log('    - skill_level:', talentUpdates.skill_level);
      // console.log('    - years_of_experience:', talentUpdates.years_of_experience);

      // console.log('  🔵 Executing talent.update()...');
      await talent.update(talentUpdates);
      // console.log('  ✅ Talent update successful');
    } catch (talentUpdateError) {
      // console.error('🔴 [BACKEND] ❌ Talent update FAILED:');
      // console.error('  Error name:', talentUpdateError.name);
      // console.error('  Error message:', talentUpdateError.message);
      if (talentUpdateError.parent) {
        // console.error('  Parent error:', talentUpdateError.parent.message);
        console.error("  SQL:", talentUpdateError.sql);
      }
      // console.error('  Full error:', talentUpdateError);
      throw talentUpdateError;
    }

    // Update user with personal info (only if provided)
    // console.log('🟢 [BACKEND] ========== STEP 5: Updating user personal info ==========');
    try {
      const userUpdates = {};
      if (first_name) {
        userUpdates.first_name = first_name;
        // console.log('  ✓ Setting first_name:', first_name);
      }
      if (last_name) {
        userUpdates.last_name = last_name;
        // console.log('  ✓ Setting last_name:', last_name);
      }
      if (phone_number) {
        userUpdates.phone_number = phone_number;
        // console.log('  ✓ Setting phone_number:', phone_number);
      }
      if (city) {
        userUpdates.city = city;
        // console.log('  ✓ Setting city:', city);
      }
      if (country) {
        userUpdates.country = country;
        // console.log('  ✓ Setting country:', country);
      }

      if (Object.keys(userUpdates).length > 0) {
        // console.log('  🔵 Executing user.update()...');
        await user.update(userUpdates);
        console.log("  ✅ User update successful");
      } else {
        console.log("  ℹ️  No user updates needed");
      }
    } catch (userUpdateError) {
      // console.error('🔴 [BACKEND] ❌ User update FAILED:');
      // console.error('  Error name:', userUpdateError.name);
      // console.error('  Error message:', userUpdateError.message);
      // console.error('  Full error:', userUpdateError);
      throw userUpdateError;
    }

    // --- 5. Delete old CV in GCP (safe cleanup) ---
    // console.log('🟢 [BACKEND] ========== STEP 6: Cleaning up old CV files ==========');
    if (
      newCvObjectName &&
      oldCvObjectName &&
      oldCvObjectName !== newCvObjectName
    ) {
      try {
        // console.log('  🗑️  Deleting old CV from GCP:', oldCvObjectName);
        await deleteFromGCP(oldCvObjectName);
        // console.log('  ✓ Old CV deleted successfully');
      } catch (err) {
        console.warn("  ⚠️  Failed to delete old CV:", err?.message || err);
      }
    } else {
      console.log(
        "  ℹ️  No old CV to delete (old:",
        oldCvObjectName,
        ", new:",
        newCvObjectName + ")"
      );
    }

    // --- 6. Generate signed URL for response (optional) ---
    // console.log('🟢 [BACKEND] ========== STEP 7: Generating signed URL for CV ==========');
    const signedCvUrl = newCvObjectName
      ? await getV4ReadSignedUrl(newCvObjectName, 3600)
      : null;
    if (signedCvUrl) {
      // console.log('  ✓ Signed URL generated (3600s TTL)');
    }

    // console.log('🟢 [BACKEND] ========== STEP 8: Sending success response ==========');

    // Reload user with all associations for complete data
    const userWithAssociations = await User.findByPk(req.user.user_id, {
      include: [{ model: Talent, as: "talent" }],
    });

    // Format user response with signed URLs
    const formattedUser = await formatUserResponse(userWithAssociations);

    // Generate tokens
    const { token, refreshToken } = generateTokens({
      user_id: req.user.user_id,
      role: getRoleKey(userWithAssociations),
    });

    res.json({
      success: true,
      message: "Onboarding completed successfully",
      data: {
        user: formattedUser,
        token,
        refreshToken,
      },
    });
    // console.log('  ✅ Response sent successfully');
  } catch (error) {
    // console.error('🔴 [BACKEND] ❌ ========== ONBOARDING FAILED ==========');
    console.error("Error name:", error.name);
    console.error("Error message:", error.message);
    console.error("Error code:", error.code);

    if (error.parent) {
      // console.error('\n🔴 Database-level error:');
      console.error("  Parent message:", error.parent.message);
      console.error("  SQL:", error.sql);
      console.error("  Parameters:", error.parameters);
    }

    console.error("\nFull error object:", error);
    console.error("Stack trace:", error?.stack);

    res.status(500).json({
      success: false,
      message: "Onboarding failed",
      error: error.message,
    });
  }
};

// Get all talents with pagination - list
const getTalents = async (req, res) => {
  try {
    const { page, limit, is_onboarded, availability } = req.query;

    const where = {};
    if (is_onboarded !== undefined) {
      where.is_onboarded = is_onboarded === "true";
    }
    if (availability) {
      where.availability = availability;
    }

    const pagination = {
      limit: limit ? parseInt(limit) : undefined,
      offset:
        page && limit ? (parseInt(page) - 1) * parseInt(limit) : undefined,
    };

    // Fetch talents with pagination and filtering
    const talents = await Talent.findAndCountAll({
      where: Object.keys(where).length > 0 ? where : undefined,
      include: [{ model: User, as: "user", required: true, include: [{ ...ROLE_INCLUDE, where: { role_key: "talent" } }] }],
      ...pagination,
      order: [["created_at", "DESC"]],
    });

    // Get signed URLs for CVs
    const talentsWithCvUrl = await Promise.all(
      talents.rows.map(async (talent) => {
        // If there's a CV object name, generate the signed URL
        if (talent.cv_object_name) {
          const cvUrl = await getV4ReadSignedUrl(talent.cv_object_name);
          return { ...talent.dataValues, cv_url: cvUrl };
        }
        return talent;
      })
    );

    res.json({
      success: true,
      data: {
        talents: talentsWithCvUrl, // Add CV URL to the talent data
        pagination: {
          currentPage: page ? parseInt(page) : undefined,
          totalPages: limit
            ? Math.ceil(talents.count / parseInt(limit))
            : undefined,
          totalItems: talents.count,
          itemsPerPage: limit ? parseInt(limit) : undefined,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get talents",
      error: error.message,
    });
  }
};

// Get talent dashboard
const getDashboard = async (req, res) => {
  try {
    /* ===============================
       GET TALENT PROFILE
       =============================== */
    const talent = await Talent.findOne({
      where: { user_id: req.user.user_id },
      include: [{ model: User, as: "user" }],
    });

    if (!talent) {
      return res.status(404).json({
        success: false,
        message: "Talent profile not found",
      });
    }

    /* ===============================
       APPLICATION STATS
       =============================== */
    const totalApplicationsCount = await Application.count({
      where: { talent_id: talent.talent_id },
    });

    const recentApplications = await Application.findAll({
      where: { talent_id: talent.talent_id },
      include: [{ model: Job, as: "job" }],
      limit: 5,
      order: [["created_at", "DESC"]],
    });

    const recentApplicationsCount = recentApplications.length;

    /* ===============================
       PROJECT STATS (M2M FIX)
       =============================== */
    const allProjects = await talent.getTalent_projects({
      where: {},
    });

    const activeProjects = allProjects.filter((p) =>
      ["planning", "in_progress"].includes(p.status)
    );

    const completedProjectsCount = allProjects.filter(
      (p) => p.status === "completed"
    ).length;

    const totalProjectsCount = allProjects.length;
    const activeProjectsCount = activeProjects.length;

    /* ===============================
       INTERVIEW STATS
       =============================== */
    const interviewCount = await Interview.count({
      where: { candidate_id: talent.talent_id },
    });

    const scheduledInterviewCount = await Interview.count({
      where: {
        candidate_id: talent.talent_id,
        status: "scheduled",
      },
    });

    /* ===============================
       FORMAT USER
       =============================== */
    const formattedUser = await formatUserResponse(talent.user);

    /* ===============================
       RESPONSE
       =============================== */
    return res.json({
      success: true,
      data: {
        user: formattedUser,
        talent,
        statistics: {
          totalApplicationsCount,
          recentApplicationsCount,
          interviewCount,
          scheduledInterviewCount,
          totalProjectsCount,
          activeProjectsCount,
          completedProjectsCount,
        },
        recentApplications,
        activeProjects,
      },
    });
  } catch (error) {
    console.error("Talent dashboard error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get dashboard data",
      error: error.message,
    });
  }
};

// Update talent profile (multipart/form-data)
const updateProfile = async (req, res) => {
  try {
    if (req.body.date_of_birth !== undefined) {
      try { req.body.date_of_birth = normalizeBirthday(req.body.date_of_birth); }
      catch (error) { return res.status(400).json({ success: false, message: error.message }); }
    }
    // console.log("📝 [updateProfile] Starting profile update");
    // console.log("📝 [updateProfile] req.user:", { user_id: req.user.user_id, role: req.user.role });
    // console.log("📝 [updateProfile] req.body keys:", Object.keys(req.body));
    // console.log("📝 [updateProfile] req.files:", req.files ? Object.keys(req.files) : "none");
    // console.log("📝 [updateProfile] req.file:", req.file ? `${req.file.fieldname} - ${req.file.size} bytes` : "none");

    const talent = await Talent.findOne({
      where: { user_id: req.user.user_id },
      include: [{ model: User, as: "user" }],
    });

    if (!talent) {
      console.warn(
        "⚠️ [updateProfile] Talent profile not found for user:",
        req.user.user_id
      );
      return res
        .status(404)
        .json({ success: false, message: "Talent profile not found" });
    }

    // console.log("✅ [updateProfile] Talent found, id:", talent.talents_id);

    // Keep old object names so we can delete after successful update
    const oldAvatarObjectName = talent.user?.avatar_object_name || null;
    const oldCvObjectName = talent?.cv_object_name || null;

    // console.log("📝 [updateProfile] Old avatar:", oldAvatarObjectName);
    // console.log("📝 [updateProfile] Old CV:", oldCvObjectName);

    const {
      date_of_birth,
      years_of_experience,
      project_types,
      availability,
      specialization,
      skill_level,
      first_name,
      last_name,
      phone_number,
      city,
      country,
    } = req.body;

    const talentUpdates = {};
    const userUpdates = {};

    // ---- file uploads (optional) ----
    // Expecting route to use upload.fields([{name:'avatar'},{name:'cv_file'}])
    if (req.files?.avatar?.[0]) {
      // console.log("📁 [updateProfile] Avatar file detected, uploading to GCP...");
      const { objectName } = await uploadToGCP(
        req.files.avatar[0],
        req.user.user_id,
        "profile-images"
      );
      // console.log("✅ [updateProfile] Avatar uploaded:", objectName);
      userUpdates.avatar_object_name = objectName;
    } else if (req.file && req.file.fieldname === "avatar") {
      // console.log("📁 [updateProfile] Avatar file (single) detected, uploading to GCP...");
      const { objectName } = await uploadToGCP(
        req.file,
        req.user.user_id,
        "profile-images"
      );
      // console.log("✅ [updateProfile] Avatar uploaded:", objectName);
      userUpdates.avatar_object_name = objectName;
    }

    if (req.files?.cv_file?.[0]) {
      // console.log("📁 [updateProfile] CV file detected, uploading to GCP...");
      const { objectName } = await uploadToGCP(
        req.files.cv_file[0],
        req.user.user_id,
        "resumes"
      );
      // console.log("✅ [updateProfile] CV uploaded:", objectName);
      talentUpdates.cv_object_name = objectName;
    }

    // ---- talent fields ----
    if (date_of_birth !== undefined) {
      // console.log("📝 [updateProfile] Updating date_of_birth:", date_of_birth);
      talentUpdates.date_of_birth = date_of_birth;
    }
    const yoe = toInt(years_of_experience);
    if (yoe !== undefined) {
      // console.log("📝 [updateProfile] Updating years_of_experience:", yoe);
      talentUpdates.years_of_experience = yoe;
    }

    const projTypes = toTextArray(project_types);
    if (projTypes !== undefined) {
      // console.log("📝 [updateProfile] Updating project_types:", projTypes);
      talentUpdates.project_types = projTypes;
    }

    if (availability !== undefined) {
      // console.log("📝 [updateProfile] Updating availability:", availability);
      talentUpdates.availability = availability;
    }
    const specArr = toTextArray(specialization);
    if (specArr !== undefined) {
      // console.log("📝 [updateProfile] Updating specialization:", specArr);
      talentUpdates.specialization = specArr;
    }
    if (skill_level !== undefined) {
      // console.log("📝 [updateProfile] Updating skill_level:", skill_level);
      talentUpdates.skill_level = skill_level;
    }

    // ---- user fields ----
    if (first_name !== undefined) {
      // console.log("📝 [updateProfile] Updating first_name:", first_name);
      userUpdates.first_name = first_name;
    }
    if (last_name !== undefined) {
      // console.log("📝 [updateProfile] Updating last_name:", last_name);
      userUpdates.last_name = last_name;
    }
    if (phone_number !== undefined) {
      // console.log("📝 [updateProfile] Updating phone_number:", phone_number);
      userUpdates.phone_number = phone_number;
    }
    if (city !== undefined) {
      // console.log("📝 [updateProfile] Updating city:", city);
      userUpdates.city = city;
    }
    if (country !== undefined) {
      // console.log("📝 [updateProfile] Updating country:", country);
      userUpdates.country = country;
    }

    // Persist updates
    // console.log("📝 [updateProfile] Applying talent updates:", Object.keys(talentUpdates));
    if (Object.keys(talentUpdates).length)
      await talent.update(talentUpdates);

    // console.log("📝 [updateProfile] Applying user updates:", Object.keys(userUpdates));
    if (Object.keys(userUpdates).length)
      await talent.user.update(userUpdates);

    // Cleanup old files **after** DB points to new ones
    if (
      req.files?.avatar?.[0] &&
      oldAvatarObjectName &&
      oldAvatarObjectName !== talent.user.avatar_object_name
    ) {
      try {
        // console.log("🗑️ [updateProfile] Deleting old avatar:", oldAvatarObjectName);
        await deleteFromGCP(oldAvatarObjectName);
        // console.log("✅ [updateProfile] Old avatar deleted");
      } catch (e) {
        // console.warn("⚠️ [updateProfile] Old avatar delete failed:", e?.message || e);
      }
    } else if (req.file && req.file.fieldname === "avatar") {
      try {
        if (
          oldAvatarObjectName &&
          oldAvatarObjectName !== talent.user.avatar_object_name
        ) {
          // console.log("🗑️ [updateProfile] Deleting old avatar (single file):", oldAvatarObjectName);
          await deleteFromGCP(oldAvatarObjectName);
          // console.log("✅ [updateProfile] Old avatar deleted");
        }
      } catch (e) {
        // console.warn("⚠️ [updateProfile] Old avatar delete failed:", e?.message || e);
      }
    }

    if (
      req.files?.cv_file?.[0] &&
      oldCvObjectName &&
      oldCvObjectName !== talent.cv_object_name
    ) {
      try {
        // console.log("🗑️ [updateProfile] Deleting old CV:", oldCvObjectName);
        await deleteFromGCP(oldCvObjectName);
        // console.log("✅ [updateProfile] Old CV deleted");
      } catch (e) {
        console.warn(
          "⚠️ [updateProfile] Old CV delete failed:",
          e?.message || e
        );
      }
    }

    // Re-fetch and attach signed URLs for immediate use
    const fresh = await Talent.findOne({
      where: { user_id: req.user.user_id },
      include: [{ model: User, as: "user" }],
    });

    // console.log("📝 [updateProfile] Re-fetching fresh talent data");

    // Get full user with all associations
    const userWithAssociations = await User.findByPk(req.user.user_id, {
      include: [{ model: Talent, as: "talent" }],
    });

    // Format user response with signed URLs
    const formattedUser = await formatUserResponse(userWithAssociations);

    // Generate tokens
    const { token, refreshToken } = generateTokens({
      user_id: req.user.user_id,
      role: getRoleKey(userWithAssociations),
    });

    console.log("✅ [updateProfile] Profile updated successfully");

    return res.json({
      success: true,
      message: "Profile updated successfully",
      data: {
        user: formattedUser,
        token,
        refreshToken,
      },
    });
  } catch (error) {
    console.error("❌ [updateProfile] Error:", error.message);
    // console.error("❌ [updateProfile] Error stack:", error.stack);
    return res.status(500).json({
      success: false,
      message: "Profile update failed",
      error: error.message,
    });
  }
};

// Get specific job details XXX
const getJobDetails = async (req, res) => {
  try {
    const { jobs_id } = req.params;

    const job = await Job.findOne({
      where: { jobs_id, status: "active" },
      include: [
        { model: User, as: "poster", attributes: ["first_name", "last_name"] },
      ],
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    // Increment view count
    // await job.increment('views_count');

    res.json({
      success: true,
      data: job,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get job details",
      error: error.message,
    });
  }
};

// Apply for a job
const applyForJob = async (req, res) => {
  try {
    const { jobs_id } = req.params;

    /* ===============================
       CHECK JOB
       =============================== */
    const job = await Job.findOne({
      where: { jobs_id, status: "active" },
      include: [
        {
          model: User,
          as: "poster",
          attributes: ["user_id", "email", "first_name", "last_name"],
        },
      ],
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found or no longer available",
      });
    }

    /* ===============================
       GET TALENT PROFILE
       =============================== */
    const talent = await Talent.findOne({
      where: { user_id: req.user.user_id },
      include: [{ model: User, as: "user" }],
    });

    // console.log("Talent from job aplication bkend ==>", talent);

    if (!talent) {
      return res.status(403).json({
        success: false,
        message: "Only talents can apply for jobs",
      });
    }

    /* ===============================
       PREVENT DUPLICATE APPLICATION
       =============================== */
    const existingApplication = await Application.findOne({
      where: {
        job_id: jobs_id,
        talent_id: talent.talent_id,
      },
    });

    if (existingApplication) {
      return res.status(400).json({
        success: false,
        message: "You have already applied for this job",
      });
    }

    // console.log("talent ID ==>", talent.talent_id);
    /* ===============================
       CREATE APPLICATION
       =============================== */
    const application = await Application.create({
      job_id: jobs_id,
      talent_id: talent.talent_id, // ✅ correct FK
      job_title: job.title,
      talent_name: `${talent.user?.first_name} ${talent.user?.last_name}`,
      experience: talent.years_of_experience,
      skills: talent.specialization,
    });

    /* ===============================
       UPDATE JOB COUNTER
       =============================== */
    await job.increment("applications_count");

    // Notify the job poster via in-app notification + email
    await notifyJobPosterOfApplication({ job, application, talent });

    return res.status(201).json({
      success: true,
      message: "Application submitted successfully",
      data: application,
    });
  } catch (error) {
    console.error("Application failed:", error);

    return res.status(500).json({
      success: false,
      message: "Application failed",
      error: error.message,
    });
  }
};

// Get talent's applications - list
const getApplications = async (req, res) => {
  try {
    const { page, limit, status } = req.query;

    const talent = await Talent.findOne({
      where: { user_id: req.user.user_id },
    });

    // console.log("Talent Found ==>", talent);
    // console.log("Talent ID ==>", talent ? talent.talent_id : "N/A");
    // console.log("User ID", req.user.user_id)

    if (!talent) {
      return res.status(404).json({
        success: false,
        message: "Talent profile not found",
      });
    }

    const where = { talent_id: talent.talent_id };
    if (status) where.status = status;

    const pagination = {
      limit: limit ? parseInt(limit) : undefined,
      offset: page && limit ? (parseInt(page) - 1) * parseInt(limit) : undefined,
    };

    const applications = await Application.findAndCountAll({
      where,
      include: [
        {
          model: Job,
          as: "job",
        },
        {
          model: Talent,
          as: "applicant", // ✅ correct association
          include: [
            {
              model: User,
              as: "user",
              attributes: ["first_name", "last_name", "email"],
            },
          ],
        },
      ],
      ...pagination,
      order: [["created_at", "DESC"]],
      distinct: true,
    });

    // console.log("Applications Retrieved ==>", applications);

    return res.json({
      success: true,
      data: {
        applications: applications.rows,
        pagination: {
          currentPage: page ? parseInt(page) : undefined,
          totalPages: limit
            ? Math.ceil(applications.count / parseInt(limit))
            : undefined,
          totalItems: applications.count,
          itemsPerPage: limit ? parseInt(limit) : undefined,
        },
      },
    });
  } catch (error) {
    console.error("Failed to get talent applications:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get applications",
      error: error.message,
    });
  }
};

// Get talent's projects - list
const getProjects = async (req, res) => {
  try {
    const { page, limit, status } = req.query;

    /* ===============================
       GET TALENT
       =============================== */
    const talent = await Talent.findOne({
      where: { user_id: req.user.user_id },
    });

    if (!talent) {
      return res.status(404).json({
        success: false,
        message: "Talent profile not found",
      });
    }

    /* ===============================
       FETCH PROJECTS VIA M2M
       =============================== */
    let projects = await Project.findAll({
      include: [{ model: Talent, as: 'talents', attributes: [], required: true, where: { talent_id: talent.talent_id }, through: { attributes: [] } }],
      order: [["created_at", "DESC"]],
    });

    /* ===============================
       OPTIONAL STATUS FILTER
       =============================== */
    if (status) {
      projects = projects.filter((p) => p.status === status);
    }

    /* ===============================
       PAGINATION (MANUAL)
       =============================== */
    const totalItems = projects.length;

    let paginatedProjects = projects;
    if (page && limit) {
      const start = (parseInt(page) - 1) * parseInt(limit);
      const end = start + parseInt(limit);
      paginatedProjects = projects.slice(start, end);
    }

    /* ===============================
       RESPONSE
       =============================== */
    return res.json({
      success: true,
      data: {
        projects: paginatedProjects,
        pagination: page && limit
          ? {
              currentPage: parseInt(page),
              totalPages: Math.ceil(totalItems / parseInt(limit)),
              totalItems,
              itemsPerPage: parseInt(limit),
            }
          : undefined,
      },
    });
  } catch (error) {
    console.error("Failed to get talent projects:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get projects",
      error: error.message,
    });
  }
};

// Get specific project details
const getProjectDetails = async (req, res) => {
  try {
    const projects_id = req.params.projects_id || req.params.id;
    const talent = await Talent.findOne({ where: { user_id: req.user.user_id } });
    if (!talent) return res.status(404).json({ success: false, message: 'Talent profile not found' });
    const project = await Project.findOne({
      where: { projects_id },
      include: [
        { model: Talent, as: 'talents', attributes: [], required: true, where: { talent_id: talent.talent_id }, through: { attributes: [] } },
        { model: ProjectManager, as: 'project_manager', required: false, include: [{ model: User, as: 'user', attributes: ['first_name', 'last_name'] }] },
      ],
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    res.json({
      success: true,
      data: project,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get project details",
      error: error.message,
    });
  }
};

module.exports = {
  getTalents,
  completeOnboarding,
  getDashboard,
  updateProfile,
  // getJobs,
  getJobDetails,
  applyForJob,
  getApplications,
  getProjects,
  getProjectDetails,
};
