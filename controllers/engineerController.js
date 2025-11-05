const { User, Engineer, Job, Application, Project } = require("../models");
const { Op } = require("sequelize");
const { uploadToGCP, deleteFromGCP } = require('../middleware/upload');
const { getV4ReadSignedUrl } = require('../config/gcpStorage');
const { toInt, toTextArray } = require('../utils/helpers')

// Complete engineer onboarding
const completeOnboarding = async (req, res) => {
  try {
    const {
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
      follows_linkedin,
      referee_info,
      newsletter,
      special_preferences,
      cv_url,
    } = req.body;

    const engineer = await Engineer.findOne({
      where: { user_id: req.user.user_id },
    });

    if (!engineer) {
      return res.status(404).json({
        success: false,
        message: "Engineer profile not found",
      });
    }

    await engineer.update({
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
      follows_linkedin,
      referee_info,
      newsletter,
      special_preferences,
      cv_url,
      is_onboarded: true,
      onboarded_at: new Date(),
    });

    res.json({
      success: true,
      message: "Onboarding completed successfully",
      data: engineer,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Onboarding failed",
      error: error.message,
    });
  }
};

// Get engineer dashboard
const getDashboard = async (req, res) => {
  try {
    const engineer = await Engineer.findOne({
      where: { user_id: req.user.user_id },
      include: [{ model: User, as: "user" }],
    });

    // Get statistics
    const totalApplications = await Application.count({
      where: { engineer_id: req.user.user_id },
    });

    const activeProjects = await Project.count({
      where: {
        engineer_id: req.user.user_id,
        status: ["planning", "in_progress"],
      },
    });

    const completedProjects = await Project.count({
      where: {
        engineer_id: req.user.user_id,
        status: "completed",
      },
    });

    // Get recent applications
    const recentApplications = await Application.findAll({
      where: { engineer_id: req.user.user_id },
      include: [{ model: Job, as: "job" }],
      limit: 5,
      order: [["created_at", "DESC"]],
    });

    const dashboardData = {
      engineer,
      statistics: {
        totalApplications,
        activeProjects,
        completedProjects,
      },
      recentApplications,
    };

    res.json({
      success: true,
      data: dashboardData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get dashboard data",
      error: error.message,
    });
  }
};

// Update engineer profile
const updateProfile = async (req, res) => {
  try {
    const engineer = await Engineer.findOne({
      where: { user_id: req.user.user_id },
      include: [{ model: User, as: 'user' }],
    });

    if (!engineer) {
      return res.status(404).json({ success: false, message: 'Engineer profile not found' });
    }

    // Keep old object names so we can delete after successful update
    const oldAvatarObjectName = engineer.user?.avatar_object_name || null;
    const oldCvObjectName     = engineer?.cv_object_name || null;

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

    const engineerUpdates = {};
    const userUpdates     = {};

    // ---- file uploads (optional) ----
    // Expecting route to use upload.fields([{name:'avatar'},{name:'cv'}])
    if (req.files?.avatar?.[0]) {
      const { objectName } = await uploadToGCP(req.files.avatar[0], req.user.user_id, 'profile-images');
      userUpdates.avatar_object_name = objectName; // store path only
    }
    if (req.files?.cv?.[0]) {
      const { objectName } = await uploadToGCP(req.files.cv[0], req.user.user_id, 'resumes');
      engineerUpdates.cv_object_name = objectName; // store path only
    }

    // ---- engineer fields ----
    if (date_of_birth !== undefined)       engineerUpdates.date_of_birth = date_of_birth; // keep as ISO/date string
    const yoe = toInt(years_of_experience);
    if (yoe !== undefined)                 engineerUpdates.years_of_experience = yoe;

    const projTypes = toTextArray(project_types);
    if (projTypes !== undefined)           engineerUpdates.project_types = projTypes;     // make sure model is ARRAY(TEXT) or JSONB

    if (availability !== undefined)        engineerUpdates.availability = availability;
    const specArr = toTextArray(specialization);
    if (specArr !== undefined)             engineerUpdates.specialization = specArr;      // ARRAY(TEXT) or JSONB
    if (skill_level !== undefined)         engineerUpdates.skill_level = skill_level;

    // ---- user fields ----
    if (first_name !== undefined)          userUpdates.first_name = first_name;
    if (last_name !== undefined)           userUpdates.last_name = last_name;
    if (phone_number !== undefined)        userUpdates.phone_number = phone_number;
    if (city !== undefined)                userUpdates.city = city;
    if (country !== undefined)             userUpdates.country = country;

    // Persist updates
    if (Object.keys(engineerUpdates).length) await engineer.update(engineerUpdates);
    if (Object.keys(userUpdates).length)      await engineer.user.update(userUpdates);

    // Cleanup old files **after** DB points to new ones
    if (req.files?.avatar?.[0] && oldAvatarObjectName && oldAvatarObjectName !== engineer.user.avatar_object_name) {
      try { await deleteFromGCP(oldAvatarObjectName); } catch (e) { console.warn('Old avatar delete failed:', e?.message || e); }
    }
    if (req.files?.cv?.[0] && oldCvObjectName && oldCvObjectName !== engineer.cv_object_name) {
      try { await deleteFromGCP(oldCvObjectName); } catch (e) { console.warn('Old CV delete failed:', e?.message || e); }
    }

    // Re-fetch and attach temporary signed URLs for immediate use
    const fresh = await Engineer.findOne({
      where: { user_id: req.user.user_id },
      include: [{ model: User, as: 'user' }],
    });

    const avatar_url = fresh?.user?.avatar_object_name
      ? await getV4ReadSignedUrl(fresh.user.avatar_object_name, 3600)
      : undefined;

    const cv_url = fresh?.cv_object_name
      ? await getV4ReadSignedUrl(fresh.cv_object_name, 3600)
      : undefined;

    return res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        engineer: fresh,
        avatar_url, // temporary (signed)
        cv_url,     // temporary (signed)
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Profile update failed', error: error.message });
  }
};

// Get available jobs
// const getJobs = async (req, res) => {
//   try {
//     const {
//       page = 1,
//       limit = 10,
//       skills,
//       experience_level,
//       job_type,
//     } = req.query;
//     const offset = (page - 1) * limit;

//     let where = {
//       status: "active",
//     };

//     if (skills) {
//       const skillsArray = skills.split(",");
//       where = {
//         ...where,
//         [Op.and]: skillsArray.map((skill) => ({
//           skills_required: { [Op.like]: `%${skill.trim()}%` },
//         })),
//       };
//     } // comment this out, causes error when filtering using skills

//     if (experience_level) {
//       where.experience_level = experience_level;
//     }

//     if (job_type) {
//       where.job_type = job_type;
//     }

//     const jobs = await Job.findAndCountAll({
//       where,
//       include: [
//         { model: User, as: "poster", attributes: ["first_name", "last_name"] },
//       ],
//       limit: parseInt(limit),
//       offset: parseInt(offset),
//       order: [["created_at", "DESC"]],
//     });

//     res.json({
//       success: true,
//       data: {
//         jobs: jobs.rows,
//         pagination: {
//           currentPage: parseInt(page),
//           totalPages: Math.ceil(jobs.count / limit),
//           totalItems: jobs.count,
//           itemsPerPage: parseInt(limit),
//         },
//       },
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: "Failed to get jobs",
//       error: error.message,
//     });
//   }
// };

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
    // const { cover_letter, proposed_rate, availability } = req.body;

    // Check if job exists and is open
    const job = await Job.findOne({
      where: { jobs_id, status: "active" },
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found or no longer available",
      });
    }

    // Check if engineer already applied
    const existingApplication = await Application.findOne({
      where: { job_id: jobs_id, engineer_id: req.user.user_id },
    });

    if (existingApplication) {
      return res.status(400).json({
        success: false,
        message: "You have already applied for this job",
      });
    }

    // Create application
    const application = await Application.create({
      job_id: jobs_id,
      engineer_id: req.user.user_id,
      job_title: job.title,
      engineer_name: `${req.user.first_name} ${req.user.last_name}`,
    });

    // Update job applications count
    await job.increment("applications_count");

    res.status(201).json({
      success: true,
      message: "Application submitted successfully",
      data: application,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Application failed",
      error: error.message,
    });
  }
};

// Get engineer's applications
const getApplications = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;

    const where = { engineer_id: req.user.user_id };
    if (status) {
      where.status = status;
    }

    const applications = await Application.findAndCountAll({
      where,
      include: [
        {
          model: Job,
          as: "job",
        },
        {
          model: User,
          as: "applicant",
          include: [
            {
              model: Engineer,
              as: "engineer",
            },
          ],
        },
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
    });

    res.json({
      success: true,
      data: {
        applications: applications.rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(applications.count / limit),
          totalItems: applications.count,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get applications",
      error: error.message,
    });
  }
};

// Get engineer's projects
const getProjects = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;

    const where = { engineer_user_id: req.user.user_id };
    if (status) {
      where.status = status;
    }

    const projects = await Project.findAndCountAll({
      where,
      include: [
        { model: User, as: "engineer", attributes: ["first_name", "last_name"] },
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
    });

    res.json({
      success: true,
      data: {
        projects: projects.rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(projects.count / limit),
          totalItems: projects.count,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get projects",
      error: error.message,
    });
  }
};

// Get specific project details
const getProjectDetails = async (req, res) => {
  try {
    const { projects_id } = req.params;

    const project = await Project.findOne({
      where: { projects_id, engineer_user_id: req.user.user_id },
      include: [
        { model: User, as: "poster", attributes: ["first_name", "last_name"] },
        { model: Job, as: "job" },
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
