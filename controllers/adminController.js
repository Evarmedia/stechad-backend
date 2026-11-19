const { emailWhere } = require("../utils/email");
const { normalizeBirthday } = require("../utils/birthday");
const {
  User,
  Talent,
  ProjectManager,
  Admin,
  Job,
  Application,
  Project,
  Setting,
  Invite,
  Department,
  Attendance,
  LeaveRequest,
  ExpenseClaim,
  Holiday,
  Kpi,
  KpiAppraisal,
  Invoice,
  RolePermission,
  Role,
  Notification,
} = require("../models");
const { Op, fn, col, where } = require("sequelize");
const sendEmail = require("../utils/sendEmail");
const path = require("path");
const { v4: uuidv4, validate: uuidValidate } = require("uuid");

const { uploadToGCP, deleteFromGCP } = require("../middleware/upload");
const { getV4ReadSignedUrl } = require("../config/gcpStorage");
const { toTextArray } = require("../utils/helpers");
const { formatUserResponse, generateTokens } = require("./authController");
const crypto = require("crypto");
const sequelize = require("../config/database");
const zohoService = require("../utils/zohoService");
const { notifyPermissionHolders } = require("../utils/workforceNotification");
const { getKpiCriteria, getKpiPeriod, formatKpiAppraisal } = require("../utils/kpiUtil");
const { buildLocationLabel } = require("../utils/geoapify");
const { generateUniqueEmployeeId, DEFAULT_EMPLOYEE_ID_PREFIX, EMPLOYEE_ID_PREFIX_PATTERN } = require("../utils/employeeId");
const { ROLE_INCLUDE, getRoleKey, findRoleByIdentifier, findRoleByKey, isWorkforceRole, directoryWhere, requireDirectoryTarget, personalFeaturePath } = require("../utils/roleUtils");

const sanitizeKpiCriteria = (criteria) => {
  if (!Array.isArray(criteria)) return [];
  const usedIds = new Set();
  return criteria
    .filter((criterion) => criterion && String(criterion.title || "").trim())
    .map((criterion) => {
      let id = String(criterion.id || crypto.randomUUID());
      if (usedIds.has(id)) id = crypto.randomUUID();
      usedIds.add(id);
      return { id, title: String(criterion.title).trim() };
    });
};

// Get admin dashboard overview
const getDashboard = async (req, res) => {
  try {
    // Get overall platform statistics
    const totalUsers = await User.count();
    const softDeletedUsers = await User.count({ paranoid: false, where: { deleted_at: { [Op.ne]: null } } });
    const totalTalents = await Talent.count({ include: [{ model: User, as: "user", required: true }] });
    const totalProjectManagers = await ProjectManager.count({ include: [{ model: User, as: "user", required: true }] });
    const totalJobs = await Job.count();
    const totalApplications = await Application.count();
    const totalProjects = await Project.count();

    // Get recent activity
    const recentTalents = await Talent.findAll({
      limit: 5,
      order: [["created_at", "DESC"]],
      // attributes: [
      //   "user_id",
      //   "first_name",
      //   "last_name",
      //   "email",
      //   "role",
      //   "created_at",
      // ],
      include: [
        {
          model: User,
          as: "user", required: true,
          include: [{ ...ROLE_INCLUDE, where: { role_key: "talent" } }],
          attributes: ["first_name", "last_name", "country"],
        },
      ],
    });

    const recentJobs = await Job.findAll({
      limit: 5,
      order: [["created_at", "DESC"]],
      include: [
        {
          model: User,
          as: "poster",
          attributes: ["first_name", "last_name"],
        },
      ],
    });

    const recentProjects = await Project.findAll({
      limit: 3,
      order: [["created_at", "DESC"]],
    });

    // Get growth metrics (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const newUsersThisMonth = await User.count({
      where: { created_at: { [Op.gte]: thirtyDaysAgo } },
    });

    const newJobsThisMonth = await Job.count({
      where: { created_at: { [Op.gte]: thirtyDaysAgo } },
    });

    const dashboardData = {
      statistics: {
        totalUsers,
        softDeletedUsers,
        totalTalents,
        totalProjectManagers,
        totalJobs,
        totalApplications,
        totalProjects,
        newUsersThisMonth,
        newJobsThisMonth,
      },
      recentActivity: {
        recentTalents,
        recentJobs,
        recentProjects,
      },
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

// Get platform statistics
const getStats = async (req, res) => {
  try {
    const { period = "month" } = req.query;

    let dateFilter;
    const now = new Date();

    switch (period) {
      case "week":
        dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "month":
        dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "quarter":
        dateFilter = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case "year":
        dateFilter = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // User statistics
    const userStats = {
      total: await User.count(),
      new: await User.count({
        where: { created_at: { [Op.gte]: dateFilter } },
      }),
      talents: await Talent.count(),
      projectManagers: await ProjectManager.count(),
      admins: await Admin.count(),
    };

    // Job statistics
    const jobStats = {
      total: await Job.count(),
      open: await Job.count({ where: { status: "active" } }),
      closed: await Job.count({ where: { status: "closed" } }),
      // completed: await Job.count({ where: { status: 'completed' } }),
      new: await Job.count({ where: { created_at: { [Op.gte]: dateFilter } } }),
    };

    // Application statistics
    const applicationStats = {
      total: await Application.count(),
      pending: await Application.count({ where: { status: "pending" } }),
      hired: await Application.count({ where: { status: "accepted" } }),
      rejected: await Application.count({ where: { status: "rejected" } }),
      new: await Application.count({
        where: { created_at: { [Op.gte]: dateFilter } },
      }),
    };

    // Project statistics
    const projectStats = {
      total: await Project.count(),
      active: await Project.count({
        where: { status: ["planning", "in_progress"] },
      }),
      completed: await Project.count({ where: { status: "completed" } }),
      // cancelled: await Project.count({ where: { status: 'cancelled' } })
    };

    res.json({
      success: true,
      data: {
        period,
        users: userStats,
        jobs: jobStats,
        applications: applicationStats,
        projects: projectStats,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get statistics",
      error: error.message,
    });
  }
};

const getWorkforce = async (req, res) => {
  try {
    const [allUsers, departments, leaveRequests, expenseClaims, invoices, holidays, kpis, permissions, roles] = await Promise.all([
      User.findAll({
        order: [["created_at", "DESC"]],
        where: directoryWhere(true),
        attributes: ["user_id", "first_name", "last_name", "email", "role_id", "is_active", "employee_id", "department_id", "job_title", "reports_to_user_id", "reporting_manager_mode", "employment_type", "workforce_permissions", "phone_number", "country", "city", "location_sharing_enabled", "location_permission_status", "browser_latitude", "browser_longitude", "browser_location_accuracy", "browser_location_updated_at", "browser_location_address", "browser_location_city", "browser_location_state", "browser_location_country", "browser_location_country_code", "created_at"],
        include: [
          ROLE_INCLUDE,
          { model: Department, as: "department", attributes: ["department_id", "name", "code"] },
          { model: User, as: "reporting_manager", attributes: ["user_id", "first_name", "last_name", "email"] },
        ],
      }),
      Department.findAll({
        include: [
          { model: User, as: "manager", attributes: ["user_id", "first_name", "last_name", "email"] },
          { model: User, as: "members", attributes: ["user_id"] },
        ],
        order: [["name", "ASC"]],
      }),
      LeaveRequest.findAll({
        where: { status: "pending" },
        include: [{ model: User, as: "requester", paranoid: false, attributes: ["user_id", "first_name", "last_name", "email"] }],
        order: [["created_at", "ASC"]],
      }),
      ExpenseClaim.findAll({
        where: { status: { [Op.in]: ["pending", "approved"] } },
        include: [{ model: User, as: "claimant", paranoid: false, attributes: ["user_id", "first_name", "last_name", "email"] }],
        order: [["created_at", "ASC"]],
      }),
      Invoice.findAll({
        where: { status: { [Op.in]: ["pending", "approved", "accounts_approved"] } },
        include: [{ model: User, as: "submitter", paranoid: false, attributes: ["user_id", "first_name", "last_name", "email"] }],
        order: [["created_at", "ASC"]],
      }),
      Holiday.findAll({ order: [["date", "ASC"]] }),
      Kpi.findAll({
        include: [
          { model: User, as: "assignee", paranoid: false, attributes: ["user_id", "first_name", "last_name", "email"] },
          { model: KpiAppraisal, as: "appraisals", separate: true, order: [["created_at", "DESC"]] },
        ],
        order: [["created_at", "DESC"]],
      }),
      RolePermission.findAll({ order: [["name", "ASC"]] }),
      Role.findAll({ where: { role_key: { [Op.notIn]: ["talent", "super_admin"] } }, order: [["name", "ASC"]] }),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const attendanceToday = await Attendance.findAll({ where: { work_date: today, status: { [Op.notIn]: ["absent", "cancelled"] } }, attributes: ["user_id"] });
    const presentUserIds = new Set(attendanceToday.map((entry) => entry.user_id));
    const staffDirectory = allUsers.map((user) => {
      const roleKey = getRoleKey(user);
      const browserLocation = user.location_sharing_enabled
        && user.location_permission_status === "granted"
        && user.browser_latitude !== null
        && user.browser_longitude !== null
        ? {
          label: buildLocationLabel({ state: user.browser_location_state, country: user.browser_location_country }),
          formattedAddress: user.browser_location_address || null,
          city: user.browser_location_city || null,
          state: user.browser_location_state || null,
          country: user.browser_location_country || null,
          updatedAt: user.browser_location_updated_at,
        }
        : null;
      return ({
        id: user.user_id,
        employment: Object.fromEntries(["user_id", "first_name", "last_name", "email", "is_active", "employee_id", "department_id", "job_title", "reports_to_user_id", "reporting_manager_mode", "employment_type"].map((field) => [field, user.get(field)])),
        reportingManager: user.reporting_manager,
        name: `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.email,
        email: user.email,
        employeeId: user.employee_id,
        departmentId: user.department_id,
        department: user.department?.name || "Unassigned",
        jobTitle: user.job_title || "Not set",
        roleId: user.role_id,
        roleKey,
        role: user.role?.name || roleKey,
        manager: user.reporting_manager ? `${user.reporting_manager.first_name || ""} ${user.reporting_manager.last_name || ""}`.trim() || user.reporting_manager.email : "Unassigned",
        managerId: user.reports_to_user_id,
        status: user.is_active ? "Active" : "Inactive",
        employmentType: user.employment_type,
        permissions: user.workforce_permissions || [],
        location: browserLocation?.label || (browserLocation ? "Location consent" : user.state || user.country || "Not shared"),
        browserLocation,
        attendance: ["admin", "super_admin"].includes(roleKey) ? "Not applicable" : presentUserIds.has(user.user_id) ? "Present" : "Not clocked in",
        joinedAt: user.created_at,
      });
    });

    const personName = (person) => person ? `${person.first_name || ""} ${person.last_name || ""}`.trim() || person.email : "Unknown";
    // Build approvals queue with optional receipt URL and description/notes
    const leaveItems = leaveRequests.map((request) => ({
      id: request.leave_request_id,
      item: `${request.leave_type}: ${request.start_date} – ${request.end_date}`,
      owner: personName(request.requester),
      type: "leave",
      status: "Pending",
    }));

    const expenseItems = await Promise.all(expenseClaims.map(async (claim) => {
      let receiptUrl = null;
      if (claim.receipt_object_name) {
        try {
          receiptUrl = await getV4ReadSignedUrl(claim.receipt_object_name, 3600);
        } catch (error) {
          // swallow signing errors and continue without URL
          console.error("Failed to sign expense receipt URL:", error.message);
        }
      }
      return {
        id: claim.expense_claim_id,
        item: `${claim.category}: ${claim.currency} ${Number(claim.amount).toFixed(2)}`,
        owner: personName(claim.claimant),
        type: "expense",
        status: claim.status === "approved" ? "Approved – receipt verification" : "Pending",
        receipt_url: receiptUrl,
        description: claim.description || null,
        receipt_name: claim.receipt_original_name || null,
      };
    }));

    const invoiceItems = invoices.map((invoice) => ({
      id: invoice.invoice_id,
      item: `${invoice.invoice_number}: ${invoice.currency} ${Number(invoice.amount).toFixed(2)}`,
      owner: personName(invoice.submitter),
      type: "invoice",
      status: invoice.status.split("_").map((word) => word.charAt(0).toUpperCase() + word?.slice(1)).join(" "),
      description: invoice.notes || null,
    }));

    const approvalsQueue = [
      ...leaveItems,
      ...expenseItems,
      ...invoiceItems,
    ];

    const activeStaff = staffDirectory.filter((member) => member.status === "Active").length;
    const latestKpiScores = kpis.map((kpi) => kpi.appraisals?.[0]?.overall_score).filter((score) => score !== undefined && score !== null).map(Number);
    const avgKpi = latestKpiScores.length ? Math.round(latestKpiScores.reduce((sum, score) => sum + score, 0) / latestKpiScores.length) : 0;
    const trackedStaff = staffDirectory.filter((member) => member.status === "Active" && !["admin", "super_admin"].includes(member.roleKey));
    const presentWorkforce = trackedStaff.filter((member) => presentUserIds.has(member.id)).length;
    const attendanceRate = trackedStaff.length ? Math.min(100, Math.round((presentWorkforce / trackedStaff.length) * 100)) : 0;
    let zoho = { configured: false, organization: null };
    if (zohoService.isConfigured()) {
      try {
        zoho = await zohoService.getOrganizationMetrics();
      } catch (error) {
        zoho = { configured: true, organization: null, error: error.message };
      }
    }
    const zohoMetrics = zoho.organization ? [
      { label: "Zoho organization", value: zoho.organization.name, delta: zoho.organization.currency_code || "Connected" },
      { label: "Zoho invoices", value: String(zoho.invoiceCount || 0), delta: "First 200 current records" },
      { label: "Zoho invoiced total", value: `${zoho.organization.currency_code || ""} ${Number(zoho.invoicedTotal || 0).toLocaleString()}`.trim(), delta: "Synced from Zoho Books" },
      { label: "Zoho receivables", value: `${zoho.organization.currency_code || ""} ${Number(zoho.outstandingReceivables || 0).toLocaleString()}`.trim(), delta: "Outstanding balance" },
    ] : [
      { label: "Active workforce", value: String(activeStaff), delta: "Live platform data" },
      { label: "Attendance today", value: `${attendanceRate}%`, delta: `${presentWorkforce} clocked in` },
      { label: "Open approvals", value: String(approvalsQueue.length), delta: "Live workflow data" },
      { label: "Average KPI score", value: `${avgKpi}%`, delta: `${latestKpiScores.length} scored assignments` },
    ];

    return res.json({
      success: true,
      data: {
        staff: staffDirectory,
        roles,
        departments,
        approvalsQueue,
        holidays,
        kpiLibrary: kpis.map((kpi) => {
          const appraisals = (kpi.appraisals || []).map(formatKpiAppraisal);
          const currentPeriod = getKpiPeriod(kpi.review_cycle);
          return {
            id: kpi.kpi_id,
            title: kpi.title,
            description: kpi.description || "",
            owner: personName(kpi.assignee),
            assignedToUserId: kpi.assigned_to_user_id,
            review: kpi.review_cycle,
            criteria: getKpiCriteria(kpi),
            currentPeriod,
            currentAppraisal: appraisals.find((appraisal) => appraisal.periodKey === currentPeriod.key) || null,
            appraisals,
            latestScore: appraisals[0]?.overallScore ?? null,
            status: kpi.status,
          };
        }),
        zohoMetrics,
        zoho,
        permissions: permissions.map((permission) => ({
          id: permission.role_permission_id,
          key: permission.permission_key,
          name: permission.name,
          super_admin: true,
          admin: permission.admin,
          project_manager: permission.project_manager,
          staff: permission.staff,
        })),
        stats: {
          activeStaff: staffDirectory.length,
          departments: departments.length,
          approvals: approvalsQueue.filter((item) => item.status === "Pending").length,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to get workforce data",
      error: error.message,
    });
  }
};

const getDepartments = async (req, res) => {
  try {
    const departments = await Department.findAll({
      include: [{
        model: User,
        as: "manager",
        attributes: ["user_id", "first_name", "last_name", "email"],
      }],
      order: [["name", "ASC"]],
    });

    return res.json({
      success: true,
      data: departments,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to get departments",
      error: error.message,
    });
  }
};

const createDepartment = async (req, res) => {
  try {
    const { name, code, description, manager_user_id, location } = req.body;
    if (typeof name !== "string" || !name.trim() || typeof code !== "string" || !code.trim()) return res.status(400).json({ success: false, message: "Department name and code are required" });
    const department = await sequelize.transaction(async (transaction) => {
      const { lockHierarchy, updateDepartmentMembers } = require("../utils/reporting");
      await lockHierarchy(transaction);
      if (manager_user_id) requireDirectoryTarget(await User.findByPk(manager_user_id, { transaction }));
      const row = await Department.create({ name: name.trim(), code: code.trim(), description: description || null, manager_user_id: manager_user_id || null, location: location || null }, { transaction });
      await updateDepartmentMembers(row, row.manager_user_id, transaction);
      return row;
    });
    return res.status(201).json({ success: true, data: department });
  } catch (error) { return res.status(error.status || (error.name === "SequelizeUniqueConstraintError" ? 409 : 500)).json({ success: false, message: error.message }); }
};
const updateDepartment = async (req, res) => {
  try {
    const department = await sequelize.transaction(async (transaction) => {
      const { lockHierarchy, updateDepartmentMembers } = require("../utils/reporting");
      await lockHierarchy(transaction);
      const row = await Department.findByPk(req.params.department_id, { transaction });
      if (!row) throw Object.assign(new Error("Department not found"), { status: 404 });
      const fields = ["name", "code", "description", "manager_user_id", "location", "status"];
      const updates = Object.fromEntries(fields.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]]));
      if (updates.manager_user_id && updates.manager_user_id !== row.manager_user_id) requireDirectoryTarget(await User.findByPk(updates.manager_user_id, { transaction }));
      for (const key of ["name", "code"]) if (updates[key] !== undefined && (typeof updates[key] !== "string" || !updates[key].trim())) throw Object.assign(new Error("Department name and code cannot be empty"), { status: 400 });
      if (Object.hasOwn(updates, "manager_user_id")) await updateDepartmentMembers(row, updates.manager_user_id || null, transaction);
      await row.update({ ...updates, ...(Object.hasOwn(updates, "manager_user_id") ? { manager_user_id: updates.manager_user_id || null } : {}) }, { transaction });
      return row;
    });
    return res.json({ success: true, data: department });
  } catch (error) { return res.status(error.status || (error.name === "SequelizeUniqueConstraintError" ? 409 : 500)).json({ success: false, message: error.message }); }
};
const deleteDepartment = async (req, res) => {
  try {
    await sequelize.transaction(async (transaction) => {
      const { lockHierarchy } = require("../utils/reporting");
      await lockHierarchy(transaction);
      const row = await Department.findByPk(req.params.department_id, { transaction });
      if (!row) throw Object.assign(new Error("Department not found"), { status: 404 });
      await User.update({ reports_to_user_id: null }, { where: { department_id: row.department_id, reporting_manager_mode: "department" }, transaction });
      await User.update({ department_id: null }, { where: { department_id: row.department_id }, transaction });
      await row.destroy({ transaction });
    });
    return res.json({ success: true, message: "Department deleted" });
  } catch (error) { return res.status(error.status || 500).json({ success: false, message: error.message }); }
};

const updateWorkforceUser = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { lockHierarchy, reportingUpdates } = require("../utils/reporting");
    await lockHierarchy(transaction);
    const user = await User.findByPk(req.params.user_id, { transaction });
    if (!user) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: "Workforce user not found" });
    }
    requireDirectoryTarget(user);
    if (!isWorkforceRole(user)) throw Object.assign(new Error("Workforce user not found"), { status: 404 });
    const currentRoleKey = getRoleKey(user);
    const requestedRoleIdentifier = req.body.role_id ?? req.body.role ?? user.role_id;
    const nextRole = await findRoleByIdentifier(requestedRoleIdentifier, { transaction });
    const nextRoleKey = nextRole?.role_key;
    if (!nextRole || (!isWorkforceRole(nextRole) && nextRoleKey !== "super_admin")) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: "Select an eligible workforce role" });
    }
    if ((nextRoleKey === "super_admin" || currentRoleKey === "super_admin") && getRoleKey(req.user) !== "super_admin") {
      await transaction.rollback();
      return res.status(403).json({ success: false, message: "Only a super admin can manage super admin access" });
    }
    if (nextRoleKey === "super_admin" && currentRoleKey !== "super_admin") {
      await transaction.rollback();
      return res.status(409).json({ success: false, message: "Only one Super Admin may exist. Create the account with the manual Super Admin seed command." });
    }
    if (currentRoleKey === "super_admin" && nextRoleKey !== "super_admin") {
      await transaction.rollback();
      return res.status(409).json({ success: false, message: "The sole Super Admin cannot be assigned a different role" });
    }
    if (currentRoleKey === "super_admin" && req.body.is_active !== undefined && !Boolean(req.body.is_active)) {
      await transaction.rollback();
      return res.status(409).json({ success: false, message: "The sole Super Admin cannot be deactivated" });
    }
    const fields = ["first_name", "last_name", "phone_number", "employee_id", "department_id", "job_title", "reports_to_user_id", "employment_type", "hire_date", "leave_allowance_days", "country", "city", "current_assignment", "work_region"];
    const updates = Object.fromEntries(fields.filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field] || null]));
    if (["department_id", "reports_to_user_id", "reporting_manager_mode"].some((key) => Object.hasOwn(req.body, key))) Object.assign(updates, await reportingUpdates(user, req.body, transaction));
    if (req.body.employee_id !== undefined) updates.employee_id = await require("../utils/employeeId").validateEmployeeId(req.body.employee_id, user.user_id, transaction);
    if (req.body.workforce_permissions !== undefined) updates.workforce_permissions = require("../utils/permissions").normalizeGrants(req.body.workforce_permissions);
    if (req.body.is_active !== undefined && typeof req.body.is_active !== "boolean") throw Object.assign(new Error("is_active must be a boolean"), { status: 400 });
    updates.role_id = nextRole.role_id;
    if (req.body.is_active !== undefined) updates.is_active = Boolean(req.body.is_active);
    await user.update(updates, { transaction });
    if (nextRoleKey === "project_manager") {
      await ProjectManager.findOrCreate({ where: { user_id: user.user_id }, defaults: { user_id: user.user_id, status: "active" }, transaction });
    }
    if (["admin", "super_admin"].includes(nextRoleKey)) {
      const [admin] = await Admin.findOrCreate({ where: { user_id: user.user_id }, defaults: { user_id: user.user_id, is_super_admin: nextRoleKey === "super_admin" }, transaction });
      await admin.update({ is_super_admin: nextRoleKey === "super_admin" }, { transaction });
    }
    await user.reload({ transaction, include: [ROLE_INCLUDE] });
    await transaction.commit();
    return res.json({ success: true, message: "Workforce user updated successfully", data: user });
  } catch (error) {
    await transaction.rollback();
    return res.status(error.status || (error.name === "SequelizeUniqueConstraintError" ? 409 : 500)).json({ success: false, message: error.status ? error.message : "Failed to update workforce user", error: error.message });
  }
};

const reviewWorkforceApproval = async (req, res) => {
  try {
    const { type, request_id } = req.params;
    const { action, notes = "" } = req.body;
    const models = { leave: LeaveRequest, expense: ExpenseClaim, invoice: Invoice };
    const idFields = { leave: "leave_request_id", expense: "expense_claim_id", invoice: "invoice_id" };
    const allowedActions = {
      leave: ["approved", "rejected"],
      expense: ["approved", "rejected", "receipt_verified", "paid"],
      invoice: ["approved", "disputed", "accounts_approved", "paid"],
    };
    if (!models[type] || !allowedActions[type].includes(action)) return res.status(400).json({ success: false, message: "Invalid approval type or action" });
    const record = await models[type].findOne({ where: { [idFields[type]]: request_id } });
    if (!record) return res.status(404).json({ success: false, message: "Approval request not found" });
    if (type === "invoice" && (record.status === "paid" || (record.status === "accounts_approved" && action !== "paid"))) {
      return res.status(409).json({ success: false, message: "This invoice has already completed accounts approval" });
    }
    if (type === "invoice" && action === "accounts_approved" && record.status !== "approved") {
      return res.status(409).json({ success: false, message: "An invoice must be approved before accounts approval" });
    }
    const updates = { status: action };
    if (type === "invoice" && action === "accounts_approved" && record.invoice_type === "project") {
      try {
        const zohoInvoice = await zohoService.syncProjectInvoice(record);
        updates.zoho_invoice_id = String(zohoInvoice.invoice_id);
        updates.zoho_synced_at = new Date();
      } catch (zohoError) {
        const status = zohoError.code === "ZOHO_NOT_CONFIGURED" ? 409 : 502;
        return res.status(status).json({ success: false, message: "Zoho invoice sync failed; the accounts approval was not finalized", error: zohoError.message });
      }
    }
    if (["approved", "rejected", "disputed"].includes(action)) Object.assign(updates, { reviewed_by: req.user.user_id, reviewed_at: new Date(), review_notes: notes || null });
    if (type === "expense" && action === "receipt_verified") Object.assign(updates, { accounts_verified_by: req.user.user_id, accounts_verified_at: new Date() });
    await record.update(updates);
    if (type === "expense" && action === "approved") {
      await notifyPermissionHolders({
        permissionKey: "verify_receipts",
        title: "Expense approved for receipt verification",
        message: `Expense claim ${record.expense_claim_id} is ready for accounts verification.`,
        actionUrl: "/approvals",
        metadata: { type, id: request_id, action },
      });
    }
    const ownerId = type === "invoice" ? record.submitted_by : record.user_id;
    await Notification.create({
      user_id: ownerId,
      title: `${type?.charAt(0).toUpperCase() + type?.slice(1)} update`,
      message: `Your ${type} request is now ${action.replace("_", " ")}.${notes ? ` ${notes}` : ""}`,
      type: ["approved", "receipt_verified", "accounts_approved", "paid"].includes(action) ? "success" : "warning",
      action_url: type === "leave" ? "/dashboard/staff/leave" : type === "expense" ? "/dashboard/staff/expenses" : "/dashboard/staff/invoices",
      metadata: { type, id: request_id, action },
    });
    return res.json({ success: true, message: "Approval updated successfully", data: record });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to update approval", error: error.message });
  }
};

const createHoliday = async (req, res) => {
  try {
    const { name, date, type = "Public holiday", region, description } = req.body;
    if (!name || !date) return res.status(400).json({ success: false, message: "Holiday name and date are required" });
    const holiday = await Holiday.create({ name, date, type, region: region || null, description: description || null, created_by: req.user.user_id });
    const recipients = await User.findAll({ where: { is_active: true }, attributes: ["user_id", "role_id"], include: [ROLE_INCLUDE] });
    await Notification.bulkCreate(recipients.map((user) => ({ user_id: user.user_id, title: "Holiday calendar updated", message: `${name} has been added for ${date}.`, type: "info", action_url: personalFeaturePath(user, "holidays"), metadata: { holiday_id: holiday.holiday_id } })));
    return res.status(201).json({ success: true, message: "Holiday created successfully", data: holiday });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to create holiday", error: error.message });
  }
};

const updateHoliday = async (req, res) => {
  try {
    const holiday = await Holiday.findByPk(req.params.holiday_id);
    if (!holiday) return res.status(404).json({ success: false, message: "Holiday not found" });
    const fields = ["name", "date", "type", "region", "description"];
    const updates = Object.fromEntries(fields.filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field] || null]));
    await holiday.update(updates);
    return res.json({ success: true, message: "Holiday updated successfully", data: holiday });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to update holiday", error: error.message });
  }
};

const deleteHoliday = async (req, res) => {
  try {
    const holiday = await Holiday.findByPk(req.params.holiday_id);
    if (!holiday) return res.status(404).json({ success: false, message: "Holiday not found" });
    await holiday.destroy();
    return res.json({ success: true, message: "Holiday deleted successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to delete holiday", error: error.message });
  }
};

const createKpi = async (req, res) => {
  try {
    const { assigned_to_user_id, title, description, review_cycle = "Monthly", status = "active" } = req.body;
    const criteria = sanitizeKpiCriteria(req.body.criteria);
    if (!assigned_to_user_id || !title || !criteria.length) return res.status(400).json({ success: false, message: "Assignee, title, and at least one success criterion are required" });
    const assignee = await User.findByPk(assigned_to_user_id);
    if (!assignee || !assignee.is_active || !isWorkforceRole(assignee)) return res.status(404).json({ success: false, message: "Staff assignee not found" });
    if (!["Monthly", "Quarterly", "Annual"].includes(review_cycle)) return res.status(400).json({ success: false, message: "Review cycle must be Monthly, Quarterly, or Annual" });
    const kpi = await Kpi.create({
      assigned_to_user_id,
      title: String(title).trim(),
      target: criteria.map((criterion) => criterion.title).join("\n"),
      criteria,
      description: description || null,
      review_cycle,
      status,
      created_by: req.user.user_id,
    });
    await Notification.create({ user_id: assigned_to_user_id, title: "New KPI assigned", message: `${title} has been assigned to you.`, type: "info", action_url: personalFeaturePath(await User.findByPk(kpi.assigned_to_user_id), "kpis"), metadata: { kpi_id: kpi.kpi_id } });
    return res.status(201).json({ success: true, message: "KPI created successfully", data: kpi });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to create KPI", error: error.message });
  }
};

const updateKpi = async (req, res) => {
  try {
    const kpi = await Kpi.findByPk(req.params.kpi_id);
    if (!kpi) return res.status(404).json({ success: false, message: "KPI not found" });
    const fields = ["assigned_to_user_id", "title", "description", "review_cycle", "status"];
    const updates = Object.fromEntries(fields.filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field]]));
    if (updates.assigned_to_user_id !== undefined && updates.assigned_to_user_id !== kpi.assigned_to_user_id) {
      const assignee = await User.findByPk(updates.assigned_to_user_id);
      if (!assignee?.is_active || !isWorkforceRole(assignee)) return res.status(404).json({ success: false, message: "Staff assignee not found" });
    }
    if (req.body.criteria !== undefined) {
      const criteria = sanitizeKpiCriteria(req.body.criteria);
      if (!criteria.length) return res.status(400).json({ success: false, message: "At least one success criterion is required" });
      updates.criteria = criteria;
      updates.target = criteria.map((criterion) => criterion.title).join("\n");
    }
    if (updates.review_cycle && !["Monthly", "Quarterly", "Annual"].includes(updates.review_cycle)) return res.status(400).json({ success: false, message: "Review cycle must be Monthly, Quarterly, or Annual" });
    await kpi.update(updates);
    await Notification.create({ user_id: kpi.assigned_to_user_id, title: "KPI updated", message: `${kpi.title} has been updated.`, type: "info", action_url: personalFeaturePath(await User.findByPk(kpi.assigned_to_user_id), "kpis"), metadata: { kpi_id: kpi.kpi_id } });
    return res.json({ success: true, message: "KPI updated successfully", data: kpi });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to update KPI", error: error.message });
  }
};

const recordKpiAppraisal = async (req, res) => {
  try {
    const kpi = await Kpi.findByPk(req.params.kpi_id);
    if (!kpi) return res.status(404).json({ success: false, message: "KPI not found" });

    const criteria = getKpiCriteria(kpi);
    if (!criteria.length) return res.status(409).json({ success: false, message: "Add success criteria before recording an appraisal" });
    const submittedScores = Array.isArray(req.body.criteria_scores) ? req.body.criteria_scores : [];
    const scoreMap = new Map(submittedScores.map((item) => [String(item.criterion_id || item.criterionId), Number(item.score)]));
    const invalid = criteria.some((criterion) => !scoreMap.has(criterion.id) || !Number.isFinite(scoreMap.get(criterion.id)) || scoreMap.get(criterion.id) < 0 || scoreMap.get(criterion.id) > 100);
    if (invalid) return res.status(400).json({ success: false, message: "Every success criterion needs a score from 0 to 100" });

    const criteriaScores = criteria.map((criterion) => ({
      criterionId: criterion.id,
      title: criterion.title,
      score: scoreMap.get(criterion.id),
    }));
    const overallScore = Number((criteriaScores.reduce((sum, item) => sum + item.score, 0) / criteriaScores.length).toFixed(2));
    const period = getKpiPeriod(kpi.review_cycle);
    const payload = {
      period_label: period.label,
      criteria_scores: criteriaScores,
      overall_score: overallScore,
      notes: String(req.body.notes || "").trim() || null,
      recorded_by: req.user.user_id,
    };
    const [appraisal, created] = await KpiAppraisal.findOrCreate({
      where: { kpi_id: kpi.kpi_id, period_key: period.key },
      defaults: { ...payload, kpi_id: kpi.kpi_id, period_key: period.key },
    });
    if (!created) await appraisal.update(payload);

    await Notification.create({
      user_id: kpi.assigned_to_user_id,
      title: `${period.label} KPI appraisal recorded`,
      message: `${kpi.title} was scored ${overallScore}%.`,
      type: "info",
      action_url: personalFeaturePath(await User.findByPk(kpi.assigned_to_user_id), "kpis"),
      metadata: { kpi_id: kpi.kpi_id, kpi_appraisal_id: appraisal.kpi_appraisal_id, period_key: period.key },
    });
    return res.status(created ? 201 : 200).json({ success: true, message: created ? "KPI appraisal recorded" : "KPI appraisal updated", data: formatKpiAppraisal(appraisal) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to record KPI appraisal", error: error.message });
  }
};

const deleteKpi = async (req, res) => {
  try {
    const kpi = await Kpi.findByPk(req.params.kpi_id);
    if (!kpi) return res.status(404).json({ success: false, message: "KPI not found" });
    await kpi.destroy();
    return res.json({ success: true, message: "KPI deleted successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to delete KPI", error: error.message });
  }
};

const updateRolePermission = async (req, res) => {
  try {
    const permission = await RolePermission.findByPk(req.params.role_permission_id);
    if (!permission) return res.status(404).json({ success: false, message: "Permission not found" });
    const updates = { super_admin: true };
    ["admin", "project_manager", "staff"].forEach((role) => { if (typeof req.body[role] === "boolean") updates[role] = req.body[role]; });
    await permission.update(updates);
    return res.json({ success: true, message: "Role permission updated successfully", data: permission });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to update role permission", error: error.message });
  }
};

const normalizeRoleKey = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

const isValidRoleKey = (value) => /^[a-z][a-z0-9_]*$/.test(value);

const getRoles = async (req, res) => {
  try {
    const roles = await Role.findAll({
      order: [["is_system", "DESC"], ["name", "ASC"]],
      attributes: ["role_id", "role_key", "name", "description", "is_system", "permission_keys", "created_at", "updated_at"],
    });
    return res.json({ success: true, data: roles, permission_catalog: require("../utils/permissions").catalog });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to get roles", error: error.message });
  }
};

const createRole = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const roleKey = normalizeRoleKey(req.body.role_key || name);
    const description = String(req.body.description || "").trim() || null;
    if (!name || !roleKey) return res.status(400).json({ success: false, message: "Role name and role key are required" });
    if (!isValidRoleKey(roleKey)) return res.status(400).json({ success: false, message: "Role key must start with a letter and contain only lowercase letters, numbers, and underscores" });

    const duplicate = await Role.findOne({
      where: {
        [Op.or]: [
          where(fn("lower", col("role_key")), roleKey.toLowerCase()),
          where(fn("lower", col("name")), name.toLowerCase()),
        ],
      },
    });
    if (duplicate) return res.status(409).json({ success: false, message: "A role with this name or key already exists" });

    const permission_keys = require("../utils/permissions").normalizeGrants(req.body.permission_keys ?? []);
    const role = await Role.create({ role_key: roleKey, name, description, is_system: false, permission_keys });
    return res.status(201).json({ success: true, message: "Role created successfully", data: role });
  } catch (error) {
    const status = error.status || (error.name === "SequelizeUniqueConstraintError" ? 409 : error.name === "SequelizeValidationError" ? 400 : 500);
    const message = error.status ? error.message : status === 409 ? "A role with this name or key already exists" : status === 400 ? "Role payload is invalid" : "Failed to create role";
    return res.status(status).json({ success: false, message, error: error.message });
  }
};

const updateRole = async (req, res) => {
  try {
    const role = await Role.findByPk(req.params.role_id);
    if (!role) return res.status(404).json({ success: false, message: "Role not found" });
    if (role.is_system) return res.status(409).json({ success: false, message: "System roles cannot be edited" });

    const updates = {};
    if (req.body.permission_keys !== undefined) updates.permission_keys = require("../utils/permissions").normalizeGrants(req.body.permission_keys);
    if (req.body.name !== undefined) updates.name = String(req.body.name || "").trim();
    if (req.body.role_key !== undefined) updates.role_key = normalizeRoleKey(req.body.role_key);
    if (req.body.description !== undefined) updates.description = String(req.body.description || "").trim() || null;
    if (!Object.keys(updates).length) {
      return res.status(400).json({ success: false, message: "At least one role field or permission set is required" });
    }
    if ((updates.name !== undefined && !updates.name) || (updates.role_key !== undefined && !updates.role_key)) {
      return res.status(400).json({ success: false, message: "Role name and role key cannot be empty" });
    }
    if (updates.role_key !== undefined && !isValidRoleKey(updates.role_key)) {
      return res.status(400).json({ success: false, message: "Role key must start with a letter and contain only lowercase letters, numbers, and underscores" });
    }

    if (updates.name !== undefined || updates.role_key !== undefined) {
      const duplicateConditions = [];
      if (updates.role_key !== undefined) duplicateConditions.push(where(fn("lower", col("role_key")), updates.role_key.toLowerCase()));
      if (updates.name !== undefined) duplicateConditions.push(where(fn("lower", col("name")), updates.name.toLowerCase()));
      const duplicate = await Role.findOne({ where: { role_id: { [Op.ne]: role.role_id }, [Op.or]: duplicateConditions } });
      if (duplicate) return res.status(409).json({ success: false, message: "A role with this name or key already exists" });
    }

    await role.update(updates);
    return res.json({ success: true, message: "Role updated successfully", data: role });
  } catch (error) {
    const status = error.status || (error.name === "SequelizeUniqueConstraintError" ? 409 : error.name === "SequelizeValidationError" ? 400 : 500);
    const message = error.status ? error.message : status === 409 ? "A role with this name or key already exists" : status === 400 ? "Role payload is invalid" : "Failed to update role";
    return res.status(status).json({ success: false, message, error: error.message });
  }
};

const deleteRole = async (req, res) => {
  try {
    const role = await Role.findByPk(req.params.role_id);
    if (!role) return res.status(404).json({ success: false, message: "Role not found" });
    if (role.is_system) return res.status(409).json({ success: false, message: "System roles cannot be deleted" });

    const [userCount, inviteCount] = await Promise.all([
      User.unscoped().count({ where: { role_id: role.role_id }, paranoid: false }),
      Invite.unscoped().count({ where: { role_id: role.role_id } }),
    ]);
    if (userCount || inviteCount) {
      return res.status(409).json({ success: false, message: "Role cannot be deleted while assigned to users or invitations", data: { users: userCount, invitations: inviteCount } });
    }

    await role.destroy();
    return res.json({ success: true, message: "Role deleted successfully" });
  } catch (error) {
    if (error.name === "SequelizeForeignKeyConstraintError") {
      return res.status(409).json({ success: false, message: "Role cannot be deleted while it is in use" });
    }
    return res.status(500).json({ success: false, message: "Failed to delete role", error: error.message });
  }
};

// update admin profile
const updateProfile = async (req, res) => {
  try {
    if (req.body.date_of_birth !== undefined) {
      try { req.body.date_of_birth = normalizeBirthday(req.body.date_of_birth); }
      catch (error) { return res.status(400).json({ success: false, message: error.message }); }
    }
    const admin = await Admin.findOne({
      where: { user_id: req.user.user_id },
      include: [
        {
          model: User,
          as: "user",
          // attributes: {
          //   exclude: [
          //     "password",
          //     "reset_password_token",
          //     "reset_password_expires",
          //   ],
          // },
        },
      ],
    });
    if (!admin) {
      return res
        .status(404)
        .json({ success: false, message: "Admin profile not found" });
    }

    const {
      permissions,
      first_name,
      last_name,
      phone_number,
      city,
      country,
    } = req.body;

    const adminUpdates = {};
    const userUpdates = {};

    // keep the old object so we can delete it after a successful update
    const oldAvatarObjectName = admin.user?.avatar_object_name;

    // 1) If an avatar file is provided, upload it first
    let newAvatarObjectName = null;
    if (req.file) {
      const { objectName } = await uploadToGCP(
        req.file,
        req.user.user_id,
        "profile-images"
      );
      newAvatarObjectName = objectName;
      userUpdates.avatar_object_name = objectName; // store ONLY the object path
    }

    // 2) Coerce/assign other fields
    // Personal profile endpoints cannot change authorization data.

    if (req.body.date_of_birth !== undefined) userUpdates.date_of_birth = req.body.date_of_birth;
    if (first_name !== undefined) userUpdates.first_name = first_name;
    if (last_name !== undefined) userUpdates.last_name = last_name;
    if (phone_number !== undefined) userUpdates.phone_number = phone_number;
    if (city !== undefined) userUpdates.city = city;
    if (country !== undefined) userUpdates.country = country;

    // 3) Persist updates
    if (Object.keys(adminUpdates).length) await admin.update(adminUpdates);
    if (Object.keys(userUpdates).length) await admin.user.update(userUpdates);

    // 4) Only now that DB points to the new object, delete the old file (if different)
    if (
      req.file &&
      oldAvatarObjectName &&
      oldAvatarObjectName !== newAvatarObjectName
    ) {
      try {
        await deleteFromGCP(oldAvatarObjectName);
      } catch (e) {
        // don't fail the whole request if cleanup fails
        console.warn("Failed to delete old avatar:", e?.message || e);
      }
    }

    // 5) Re-fetch and return a fresh signed URL (temporary)
    const updated = await Admin.findOne({
      where: { user_id: req.user.user_id },
      include: [
        {
          model: User,
          as: "user",
        },
      ],
    });

    // Get full user with all associations
    const userWithAssociations = await User.findByPk(req.user.user_id, {
      include: [{ model: Admin, as: "admin" }],
    });

    // Format user response with signed URLs
    const formattedUser = await formatUserResponse(userWithAssociations);

    // Generate tokens
    // const { token, refreshToken } = generateTokens({
    //   user_id: req.user.user_id,
    //   role: userWithAssociations.role,
    // });

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: {
        user: formattedUser,
        // token,
        // refreshToken,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Profile update failed",
      error: error.message,
    });
  }
};

// Get specific talent details
const getTalentDetails = async (req, res) => {
  try {
    const { talent_id } = req.params;

    const identity = await Talent.findByPk(talent_id, { include: [{ model: User, as: "user", paranoid: false, attributes: ["user_id"] }] });
    if (!identity || getRoleKey(identity.user) === "super_admin") return res.status(404).json({ success: false, message: "Talent not found" });

    const talent = await Talent.findOne({
      where: { talent_id },
      include: [
        { model: User, paranoid: false, as: "user" },
        {
          model: Application,
          as: "applications",
          include: [{ model: Job, as: "job" }],
        },
        { model: Project, as: "talent_projects", include: [{ model: User }] },
      ],
    });

    if (!talent || getRoleKey(talent.user || await User.findByPk(talent.user_id, { paranoid: false })) === "super_admin") {
      return res.status(404).json({
        success: false,
        message: "Talent not found",
      });
    }

    res.json({
      success: true,
      data: talent,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get talent details",
      error: error.message,
    });
  }
};

// Vet / Unvet a talent
const updateTalentVetting = async (req, res) => {
  try {
    const { talent_id, is_vetted, remark } = req.body;

    const talent = await Talent.findByPk(talent_id);

    if (!talent || getRoleKey(talent.user || await User.findByPk(talent.user_id, { paranoid: false })) === "super_admin") {
      return res.status(404).json({
        success: false,
        message: "Talent not found",
      });
    }

    await talent.update({
      is_vetted,
      vetted_at: is_vetted ? new Date() : null,
      vetted_by: is_vetted ? req.user.user_id : null,
      remark: is_vetted ? remark : null,
    });

    // 🔧 Re-fetch with correct includes
    const updatedTalent = await Talent.findByPk(talent_id, {
      include: [
        {
          model: User,
          as: "user", // ✅ talent's own user profile
          attributes: ["first_name", "last_name", "email", "phone_number", "country"],
        },
        {
          model: User,
          as: "vettedBy", // ✅ admin / PM who vetted
          attributes: ["first_name", "last_name", "email"],
        },
      ],
    });

    return res.status(200).json({
      success: true,
      message: is_vetted
        ? "Talent vetted successfully"
        : "Talent vetting removed",
      data: updatedTalent,
    });
  } catch (error) {
    console.error("Failed to update talent vetting:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update talent vetting status",
      error: error.message,
    });
  }
};

// Delete talent account
const deleteTalent = async (req, res) => {
  try {
    const profile = await Talent.findByPk(req.params.talent_id);
    if (!profile) return res.status(404).json({ success: false, message: "User profile not found" });
    await require("../utils/userLifecycle").deleteUser(profile.user_id, req.user);
    return res.json({ success: true, message: "Account deleted; history preserved" });
  } catch (error) { return res.status(error.status || 500).json({ success: false, message: error.message, blockers: error.blockers }); }
};

// Get all project managers - list
const getProjectManagers = async (req, res) => {
  try {
    const { page, limit, is_verified } = req.query;

    const where = {};
    if (is_verified !== undefined) {
      where.is_verified = is_verified === "true";
    }

    const pagination = {
      limit: limit ? parseInt(limit) : undefined,
      offset:
        page && limit ? (parseInt(page) - 1) * parseInt(limit) : undefined,
    };

    const projectManagers = await ProjectManager.findAndCountAll({
      where: Object.keys(where).length ? where : undefined,

      include: [
        {
          model: User,
          as: "user",
          required: true,
          include: [{ ...ROLE_INCLUDE, where: { role_key: "project_manager" } }],
        },
        {
          model: Project,
          as: "pm_projects",
          required: false, // LEFT JOIN stays intact
          on: {
            [Op.or]: [
              // PM-owned projects
              {
                project_managers_id: {
                  [Op.col]: "ProjectManager.project_managers_id",
                },
              },
              // Unassigned projects
              { project_managers_id: null },
            ],
          },
        },
      ],

      ...pagination,
      distinct: true,
      order: [["created_at", "DESC"]],
    });

    const transformedPMs = projectManagers.rows.map((pm) => {
      const pmJson = pm.toJSON();

      pmJson.pm_projects = (pmJson.pm_projects || []).map((p) => ({
        ...p,
        is_unassigned: p.project_managers_id === null,
      }));

      return pmJson;
    });

    return res.json({
      success: true,
      data: {
        projectManagers: transformedPMs,
        pagination: {
          totalItems: projectManagers.count,
        },
      },
    });
  } catch (error) {
    console.error("Failed to get project managers:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get project managers",
      error: error.message,
    });
  }
};

// Invite a project manager, staff member, or admin. Super Admin is seeded manually.
const inviteProjectManager = async (req, res) => {
  let transaction;
  try {
    const { email, first_name, last_name, department_id, job_title, role = "project_manager", role_id } = req.body;
    const assignedRole = await findRoleByIdentifier(role_id || role);
    const roleKey = assignedRole?.role_key;
    if (!email || !assignedRole || !isWorkforceRole(assignedRole)) {
      return res.status(400).json({ success: false, message: "A valid email and workforce role are required" });
    }
    if (department_id && !(await Department.findByPk(department_id))) {
      return res.status(404).json({ success: false, message: "Department not found" });
    }

    // 1️⃣ Check if user already exists
    const existingUser = await User.findOne({ where: emailWhere(email), paranoid: false });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists with this email. Please ask them to login.",
      });
    }

    // 2️⃣ Check for existing pending invite
    const existingInvite = await Invite.findOne({
      where: emailWhere(email, "Invite", { status: "pending" }),
      order: [["created_at", "DESC"]],
    });

    // 3️⃣ If pending invite exists AND is NOT expired → block
    if (existingInvite && new Date() < existingInvite.expires_at) {
      return res.status(400).json({
        success: false,
        message: "An active invitation has already been sent to this email.",
      });
    }

    // Use a transaction so the invite is persisted ONLY if the email is sent
    transaction = await sequelize.transaction();

    // 4️⃣ If pending invite exists BUT is expired → invalidate it
    if (existingInvite && new Date() >= existingInvite.expires_at) {
      await existingInvite.update({
        status: "expired",
        token: null,
        // temp_password: null,
      }, { transaction });
    }
    
    // const tempPassword = Math.random().toString(36).slice(-8);
    const token = uuidv4();

    // const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const expires_at = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour
    const employee_id = await generateUniqueEmployeeId({ transaction });

    const invitedUser = await Invite.create({
      email,
      first_name: first_name || null,
      last_name: last_name || null,
      department_id: department_id || null,
      job_title: job_title || null,
      employee_id,
      // temp_password: tempPassword,
      role_id: assignedRole.role_id,
      token,
      invited_by_user_id: req.user.user_id,
      sent_at: new Date(),
      expires_at,
      status: "pending",
    }, { transaction });

    // 5️⃣ Send email
    const htmlFilePath = path.join(
      __dirname,
      "../templates/projectManagerInvitation.html"
    );

    const replacements = {
      firstname: first_name,
      // tempPassword,
      role: assignedRole.name,
      employeeId: employee_id,
      year: new Date().getFullYear(),
      // url: `${process.env.FRONTEND_PROD_URL}/accept-invite?token=${token}`,
      url: `${process.env.NODE_ENV === "production"
        ? process.env.FRONTEND_PROD_URL
        : process.env.FRONTEND_URL
      }/accept-invite?token=${token}`,
    };

    await sendEmail({
      to: invitedUser.email,
      subject: "Invitation to STECHAD Hub",
      htmlFilePath,
      replacements,
    });

    // Commit only after email succeeds
    await transaction.commit();
    const invitationResponse = await Invite.findByPk(invitedUser.invite_id);

    res.status(201).json({
      success: true,
      message: `${assignedRole.name} invited successfully.`,
      data: invitationResponse,
    });
  } catch (error) {
    // If we created a transaction but didn't commit, roll back
    if (typeof transaction !== "undefined") {
      try {
        await transaction.rollback();
      } catch (_) {}
    }
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Failed to send workforce invitation",
      error: error.message,
    });
  }
};

// Get specific project manager details
const getProjectManagerDetails = async (req, res) => {
  try {
    let { project_managers_id } = req.params;

    // Log the project_manager_id to check the value passed
    console.log(`Received project_manager_id: '${project_managers_id}'`);

    // Trim any leading or trailing whitespace
    project_managers_id = project_managers_id.trim();

    // Validate that the project_managers_id is a valid UUID
    if (!uuidValidate(project_managers_id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid project manager ID format. It must be a valid UUID.",
      });
    }

    const identity = await ProjectManager.findByPk(project_managers_id, { include: [{ model: User, as: "user", paranoid: false, attributes: ["user_id"] }] });
    if (!identity || getRoleKey(identity.user) === "super_admin") return res.status(404).json({ success: false, message: "Project manager not found" });

    // Use the correct aliases in the include section
    const projectManager = await ProjectManager.findOne({
      where: { project_managers_id: project_managers_id },
      include: [
        { model: User, paranoid: false, as: "user" }, // ProjectManager's associated user
        { model: Job, as: "posted_jobs" },
        {
          model: Project,
          as: "pm_projects", // Projects associated with the ProjectManager
          include: [
            {
              model: User, paranoid: false,
              as: "talent", // Talent associated with the Project
            },
          ],
        },
      ],
    });

    if (!projectManager || getRoleKey(projectManager.user) === "super_admin") {
      return res.status(404).json({
        success: false,
        message: "Project manager not found",
      });
    }

    res.json({
      success: true,
      data: projectManager,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get project manager details",
      error: error.message,
    });
  }
};

// Delete project manager account
const deleteProjectManager = async (req, res) => {
  try {
    const profile = await ProjectManager.findByPk(req.params.project_managers_id);
    if (!profile) return res.status(404).json({ success: false, message: "User profile not found" });
    await require("../utils/userLifecycle").deleteUser(profile.user_id, req.user);
    return res.json({ success: true, message: "Account deleted; history preserved" });
  } catch (error) { return res.status(error.status || 500).json({ success: false, message: error.message, blockers: error.blockers }); }
};

// Get talents pending vetting
const getTalentVetting = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const talents = await Talent.findAndCountAll({
      where: { is_vetted: false, is_onboarded: true },
      include: [
        {
          model: User,
          as: "user",
          required: true,
          include: [{ ...ROLE_INCLUDE, where: { role_key: "talent" } }],
          // attributes: {
          //   exclude: [
          //     "password",
          //     "reset_password_token",
          //     "reset_password_expires",
          //   ],
          // },
        },
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "ASC"]],
    });

    res.json({
      success: true,
      data: {
        talents: talents.rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(talents.count / limit),
          totalItems: talents.count,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get talents pending vetting",
      error: error.message,
    });
  }
};

// Get platform settings
const getSettings = async (req, res) => {
  try {
    const settings = await Setting.findAll();

    const settingsObject = { EMPLOYEE_ID_PREFIX: DEFAULT_EMPLOYEE_ID_PREFIX };
    settings.forEach((setting) => {
      let value = setting.value;

      // Parse value based on type
      switch (setting.type) {
        case "number":
          value = parseFloat(value);
          break;
        case "boolean":
          value = value === "true";
          break;
        case "json":
          value = JSON.parse(value);
          break;
        default:
          // string - no parsing needed
          break;
      }

      settingsObject[setting.key] = value;
    });

    res.json({
      success: true,
      data: settingsObject,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get settings",
      error: error.message,
    });
  }
};

// Update platform settings
const updateSettings = async (req, res) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      return res.status(400).json({ success: false, message: "settings must be an object" });
    }
    if (settings.EMPLOYEE_ID_PREFIX !== undefined &&
        (typeof settings.EMPLOYEE_ID_PREFIX !== "string" || !EMPLOYEE_ID_PREFIX_PATTERN.test(settings.EMPLOYEE_ID_PREFIX))) {
      return res.status(400).json({ success: false, message: "Employee ID prefix must contain 1–10 uppercase letters or digits, starting with a letter" });
    }

    for (const [key, value] of Object.entries(settings)) {
      let type = "string";
      let stringValue = value;

      // Determine type and convert to string
      if (typeof value === "number") {
        type = "number";
        stringValue = value.toString();
      } else if (typeof value === "boolean") {
        type = "boolean";
        stringValue = value.toString();
      } else if (typeof value === "object") {
        type = "json";
        stringValue = JSON.stringify(value);
      }

      await Setting.upsert({
        key,
        value: stringValue,
        type,
      });
    }

    res.json({
      success: true,
      message: "Settings updated successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update settings",
      error: error.message,
    });
  }
};

module.exports = {
  getDashboard,
  getStats,
  getWorkforce,
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  updateWorkforceUser,
  reviewWorkforceApproval,
  createHoliday,
  updateHoliday,
  deleteHoliday,
  createKpi,
  updateKpi,
  recordKpiAppraisal,
  deleteKpi,
  updateRolePermission,
  getRoles,
  createRole,
  updateRole,
  deleteRole,
  updateProfile,
  getTalentDetails,
  updateTalentVetting,
  deleteTalent,
  getProjectManagers,
  inviteProjectManager,
  getProjectManagerDetails,
  deleteProjectManager,
  getTalentVetting,
  getSettings,
  updateSettings,
  // getPmsProjectById,
};
