const {
  User,
  Engineer,
  ProjectManager,
  Job,
  Application,
  Project,
} = require("../models");
const { Op } = require("sequelize");

// Get user analytics
const getUserAnalytics = async (req, res) => {
  try {
    const { period = "month", start_date, end_date } = req.query;

    let dateFilter;
    const now = new Date();

    if (start_date && end_date) {
      dateFilter = {
        [Op.between]: [new Date(start_date), new Date(end_date)],
      };
    } else {
      switch (period) {
        case "day":
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          };
          break;
        case "week":
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          };
          break;
        case "month":
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
          };
          break;
        case "quarter":
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
          };
          break;
        case "year":
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
          };
          break;
        default:
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
          };
      }
    }

    // User statistics
    const totalUsers = await User.count();
    const newUsers = await User.count({
      where: { created_at: dateFilter },
    });
    const activeUsers = await User.count({
      where: { is_active: true },
    });

    // Role distribution
    const engineers = await Engineer.count();
    const projectManagers = await ProjectManager.count();
    const admins = await User.count({ where: { role: "admin" } });

    // User growth trends
    const registrationTrends = await User.findAll({
      attributes: [
        [User.sequelize.fn("DATE", User.sequelize.col("created_at")), "date"],
        [User.sequelize.fn("COUNT", User.sequelize.col("user_id")), "count"],
      ],
      where: { created_at: dateFilter },
      group: [User.sequelize.fn("DATE", User.sequelize.col("created_at"))],
      order: [
        [User.sequelize.fn("DATE", User.sequelize.col("created_at")), "ASC"],
      ],
      raw: true,
    });

    // Calculate growth percentage
    const previousPeriodStart = new Date(
      dateFilter[Op.gte].getTime() -
        (now.getTime() - dateFilter[Op.gte].getTime())
    );
    const previousPeriodUsers = await User.count({
      where: {
        created_at: {
          [Op.between]: [previousPeriodStart, dateFilter[Op.gte]],
        },
      },
    });

    const userGrowth =
      previousPeriodUsers > 0
        ? (
            ((newUsers - previousPeriodUsers) / previousPeriodUsers) *
            100
          ).toFixed(1)
        : 0;

    res.json({
      success: true,
      data: {
        period,
        total_users: totalUsers,
        new_users: newUsers,
        active_users: activeUsers,
        user_growth: parseFloat(userGrowth),
        role_distribution: {
          engineers,
          project_managers: projectManagers,
          admins,
        },
        registration_trends: registrationTrends,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get user analytics",
      error: error.message,
    });
  }
};

// Get job analytics
const getJobAnalytics = async (req, res) => {
  try {
    const { period = "month", start_date, end_date } = req.query;

    let dateFilter;
    const now = new Date();

    if (start_date && end_date) {
      dateFilter = {
        [Op.between]: [new Date(start_date), new Date(end_date)],
      };
    } else {
      switch (period) {
        case "day":
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          };
          break;
        case "week":
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          };
          break;
        case "month":
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
          };
          break;
        case "quarter":
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
          };
          break;
        case "year":
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
          };
          break;
        default:
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
          };
      }
    }

    // Job statistics
    const totalJobs = await Job.count();
    const activeJobs = await Job.count({ where: { status: "active" } });
    const closedJobs = await Job.count({ where: { status: "closed" } });
    const newJobs = await Job.count({ where: { created_at: dateFilter } });

    // Job types distribution
    const jobTypes = await Job.findAll({
      attributes: [
        "employment_type",
        [
          Job.sequelize.fn("COUNT", Job.sequelize.col("employment_type")),
          "count",
        ],
      ],
      group: ["employment_type"],
      raw: true,
    });

    // Popular skills
    const popularSkills = await Job.findAll({
      attributes: ["skills_required"],
      where: { skills_required: { [Op.not]: null } },
    });

    // Process skills data
    const skillsCount = {};
    popularSkills.forEach((job) => {
      if (job.skills_required && Array.isArray(job.skills_required)) {
        job.skills_required.forEach((skill) => {
          skillsCount[skill] = (skillsCount[skill] || 0) + 1;
        });
      }
    });

    const topSkills = Object.entries(skillsCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([skill, count]) => ({ skill, count }));

    // Job posting trends
    const jobTrends = await Job.findAll({
      attributes: [
        [Job.sequelize.fn("DATE", Job.sequelize.col("created_at")), "date"],
        [Job.sequelize.fn("COUNT", Job.sequelize.col("jobs_id")), "count"],
      ],
      where: { created_at: dateFilter },
      group: [Job.sequelize.fn("DATE", Job.sequelize.col("created_at"))],
      order: [
        [Job.sequelize.fn("DATE", Job.sequelize.col("created_at")), "ASC"],
      ],
      raw: true,
    });

    res.json({
      success: true,
      data: {
        period,
        total_jobs: totalJobs,
        active_jobs: activeJobs,
        closed_jobs: closedJobs,
        new_jobs: newJobs,
        job_types: jobTypes.reduce((acc, item) => {
          acc[item.employment_type] = parseInt(item.count);
          return acc;
        }, {}),
        popular_skills: topSkills,
        job_trends: jobTrends,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get job analytics",
      error: error.message,
    });
  }
};

// Get application analytics
const getApplicationAnalytics = async (req, res) => {
  try {
    const { period = "month", start_date, end_date } = req.query;

    let dateFilter;
    const now = new Date();

    if (start_date && end_date) {
      dateFilter = {
        [Op.between]: [new Date(start_date), new Date(end_date)],
      };
    } else {
      switch (period) {
        case "day":
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          };
          break;
        case "week":
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          };
          break;
        case "month":
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
          };
          break;
        case "quarter":
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
          };
          break;
        case "year":
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
          };
          break;
        default:
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
          };
      }
    }

    // Application statistics
    const totalApplications = await Application.count();
    const pendingApplications = await Application.count({
      where: { status: "pending" },
    });
    const acceptedApplications = await Application.count({
      where: { status: "accepted" },
    });
    const rejectedApplications = await Application.count({
      where: { status: "rejected" },
    });
    const newApplications = await Application.count({
      where: { applied_at: dateFilter },
    });

    // Calculate rejection rate
    const reviewedApplications = acceptedApplications + rejectedApplications;
    const rejectionRate =
      reviewedApplications > 0
        ? ((rejectedApplications / reviewedApplications) * 100).toFixed(1)
        : 0;

    // Calculate average response time
    const reviewedApps = await Application.findAll({
      where: {
        reviewed_at: { [Op.not]: null },
        applied_at: dateFilter,
      },
      attributes: ["applied_at", "reviewed_at"],
    });

    let avgResponseTime = 0;
    if (reviewedApps.length > 0) {
      const totalResponseTime = reviewedApps.reduce((sum, app) => {
        const responseTime =
          new Date(app.reviewed_at) - new Date(app.applied_at);
        return sum + responseTime / (1000 * 60 * 60 * 24); // Convert to days
      }, 0);
      avgResponseTime = (totalResponseTime / reviewedApps.length).toFixed(1);
    }

    // Application trends
    const applicationTrends = await Application.findAll({
      attributes: [
        [
          Application.sequelize.fn(
            "DATE",
            Application.sequelize.col("applied_at")
          ),
          "date",
        ],
        [
          Application.sequelize.fn(
            "COUNT",
            Application.sequelize.col("applications_id")
          ),
          "count",
        ],
      ],
      where: { applied_at: dateFilter },
      group: [
        Application.sequelize.fn(
          "DATE",
          Application.sequelize.col("applied_at")
        ),
      ],
      order: [
        [
          Application.sequelize.fn(
            "DATE",
            Application.sequelize.col("applied_at")
          ),
          "ASC",
        ],
      ],
      raw: true,
    });

    res.json({
      success: true,
      data: {
        period,
        total_applications: totalApplications,
        pending_applications: pendingApplications,
        accepted_applications: acceptedApplications,
        rejected_applications: rejectedApplications,
        new_applications: newApplications,
        rejection_rate: parseFloat(rejectionRate),
        average_response_time: parseFloat(avgResponseTime),
        application_trends: applicationTrends,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get application analytics",
      error: error.message,
    });
  }
};

// Get platform analytics
const getPlatformAnalytics = async (req, res) => {
  try {
    const { period = "month", start_date, end_date } = req.query;

    let dateFilter;
    const now = new Date();

    if (start_date && end_date) {
      dateFilter = {
        [Op.between]: [new Date(start_date), new Date(end_date)],
      };
    } else {
      switch (period) {
        case "day":
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          };
          break;
        case "week":
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          };
          break;
        case "month":
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
          };
          break;
        case "quarter":
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
          };
          break;
        case "year":
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
          };
          break;
        default:
          dateFilter = {
            [Op.gte]: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
          };
      }
    }

    // Successful matches (accepted applications)
    const successfulMatches = await Application.count({
      where: { status: "accepted", reviewed_at: dateFilter },
    });

    // Platform growth metrics
    const totalUsers = await User.count();
    const newUsers = await User.count({ where: { created_at: dateFilter } });
    const previousPeriodStart = new Date(
      dateFilter[Op.gte].getTime() -
        (now.getTime() - dateFilter[Op.gte].getTime())
    );
    const previousPeriodUsers = await User.count({
      where: {
        created_at: {
          [Op.between]: [previousPeriodStart, dateFilter[Op.gte]],
        },
      },
    });

    const platformGrowth =
      previousPeriodUsers > 0
        ? (
            ((newUsers - previousPeriodUsers) / previousPeriodUsers) *
            100
          ).toFixed(1)
        : 0;

    // Top performing engineers (by completed projects)
    const topEngineers = await Project.findAll({
      attributes: [
        "engineer_user_id",
        [
          Project.sequelize.fn("COUNT", Project.sequelize.col("projects_id")),
          "projects_completed",
        ],
      ],
      where: {
        status: "completed",
        engineer_user_id: { [Op.not]: null },
      },
      group: ["engineer_user_id"],
      order: [
        [
          Project.sequelize.fn("COUNT", Project.sequelize.col("projects_id")),
          "DESC",
        ],
      ],
      limit: 5,
      raw: true,
    });

    const engineerIds = topEngineers.map(
      (engineer) => engineer.engineer_user_id
    );

    const engineers = await User.findAll({
      where: { user_id: { [Op.in]: engineerIds } },
      include: [
        {
          model: Engineer,
          as: "engineer",
          attributes: ["years_of_experience"],
        },
      ],
      raw: false,
    });

    const topEngineersWithDetails = topEngineers.map((engineer) => {
      const engineerDetails = engineers.find(
        (e) => e.user_id === engineer.engineer_user_id
      );
      return {
        engineer_id: engineer.engineer_user_id,
        name: `${engineerDetails.first_name} ${engineerDetails.last_name}`,
        projects_completed: engineer.projects_completed,
        experience_years: engineerDetails.engineer?.years_of_experience || 0,
      };
    });

    // Active projects
    const activeProjects = await Project.count({
      where: { status: ["planning", "in_progress"] },
    });

    // Completed projects
    const completedProjects = await Project.count({
      where: { status: "completed" },
    });

    res.json({
      success: true,
      data: {
        period,
        successful_matches: successfulMatches,
        platform_growth: parseFloat(platformGrowth),
        active_projects: activeProjects,
        completed_projects: completedProjects,
        total_users: totalUsers,
        new_users: newUsers,
        top_performing_engineers: topEngineersWithDetails,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get platform analytics",
      error: error.message,
    });
  }
};

module.exports = {
  getUserAnalytics,
  getJobAnalytics,
  getApplicationAnalytics,
  getPlatformAnalytics,
};
