const {
  User,
  Engineer,
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
  Notification,
} = require("../models");
const { Op } = require("sequelize");
const sendEmail = require("../utils/sendEmail");
const path = require("path");
const { v4: uuidv4, validate: uuidValidate } = require("uuid");

const { uploadToGCP, deleteFromGCP } = require("../middleware/upload");
const { getV4ReadSignedUrl } = require("../config/gcpStorage");
const { toBool, toTextArray } = require("../utils/helpers");
const { formatUserResponse, generateTokens } = require("./authController");
const crypto = require("crypto");
const sequelize = require("../config/database");
const zohoService = require("../utils/zohoService");
const { notifyPermissionHolders } = require("../utils/workforceNotification");
const { getKpiCriteria, getKpiPeriod, formatKpiAppraisal } = require("../utils/kpiUtil");

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
    const totalEngineers = await Engineer.count();
    const totalProjectManagers = await ProjectManager.count();
    const totalJobs = await Job.count();
    const totalApplications = await Application.count();
    const totalProjects = await Project.count();

    // Get recent activity
    const recentEngineers = await Engineer.findAll({
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
          as: "user",
          attributes: ["first_name", "last_name", "role", "country"],
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
          attributes: ["first_name", "last_name", "role"],
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
        totalEngineers,
        totalProjectManagers,
        totalJobs,
        totalApplications,
        totalProjects,
        newUsersThisMonth,
        newJobsThisMonth,
      },
      recentActivity: {
        recentEngineers,
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
      engineers: await Engineer.count(),
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
    const defaultPermissions = [
      { permission_key: "view_dashboard", name: "View dashboard", admin: true, project_manager: true, staff: true },
      { permission_key: "manage_departments", name: "Manage departments", admin: true, project_manager: false, staff: false },
      { permission_key: "approve_leave", name: "Approve leave", admin: true, project_manager: true, staff: false },
      { permission_key: "approve_expenses", name: "Approve expenses", admin: true, project_manager: false, staff: false },
      { permission_key: "verify_receipts", name: "Verify expense receipts", admin: true, project_manager: false, staff: false },
      { permission_key: "submit_expenses", name: "Submit expenses", admin: true, project_manager: true, staff: true },
      { permission_key: "create_projects", name: "Create projects", admin: true, project_manager: true, staff: false },
      { permission_key: "manage_staff", name: "Manage staff", admin: true, project_manager: false, staff: false },
      { permission_key: "manage_kpis", name: "Manage KPIs and appraisals", admin: true, project_manager: true, staff: false },
      { permission_key: "approve_invoices", name: "Approve invoices", admin: true, project_manager: false, staff: false },
    ];
    await Promise.all(defaultPermissions.map((permission) => RolePermission.findOrCreate({
      where: { permission_key: permission.permission_key },
      defaults: { ...permission, super_admin: true },
    })));

    const [allUsers, departments, leaveRequests, expenseClaims, invoices, holidays, kpis, permissions] = await Promise.all([
      User.findAll({
        order: [["created_at", "DESC"]],
        where: { role: { [Op.in]: ["staff", "admin", "project_manager", "super_admin"] } },
        attributes: ["user_id", "first_name", "last_name", "email", "role", "is_active", "employee_id", "department_id", "job_title", "reports_to_user_id", "employment_type", "workforce_permissions", "phone_number", "country", "city", "created_at"],
        include: [
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
        include: [{ model: User, as: "requester", attributes: ["user_id", "first_name", "last_name", "email"] }],
        order: [["created_at", "ASC"]],
      }),
      ExpenseClaim.findAll({
        where: { status: { [Op.in]: ["pending", "approved"] } },
        include: [{ model: User, as: "claimant", attributes: ["user_id", "first_name", "last_name", "email"] }],
        order: [["created_at", "ASC"]],
      }),
      Invoice.findAll({
        where: { status: { [Op.in]: ["pending", "approved", "accounts_approved"] } },
        include: [{ model: User, as: "submitter", attributes: ["user_id", "first_name", "last_name", "email"] }],
        order: [["created_at", "ASC"]],
      }),
      Holiday.findAll({ order: [["date", "ASC"]] }),
      Kpi.findAll({
        include: [
          { model: User, as: "assignee", attributes: ["user_id", "first_name", "last_name", "email"] },
          { model: KpiAppraisal, as: "appraisals", separate: true, order: [["created_at", "DESC"]] },
        ],
        order: [["created_at", "DESC"]],
      }),
      RolePermission.findAll({ order: [["name", "ASC"]] }),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const attendanceToday = await Attendance.findAll({ where: { work_date: today }, attributes: ["user_id"] });
    const presentUserIds = new Set(attendanceToday.map((entry) => entry.user_id));
    const staffDirectory = allUsers.map((user) => ({
        id: user.user_id,
        name: `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.email,
        email: user.email,
        employeeId: user.employee_id,
        departmentId: user.department_id,
        department: user.department?.name || "Unassigned",
        jobTitle: user.job_title || "Not set",
        roleKey: user.role,
        role: user.role === "project_manager" ? "Project Manager" : user.role === "super_admin" ? "Super Admin" : user.role === "admin" ? "Admin" : user.role === "staff" ? "Staff" : user.role,
        manager: user.reporting_manager ? `${user.reporting_manager.first_name || ""} ${user.reporting_manager.last_name || ""}`.trim() || user.reporting_manager.email : "Unassigned",
        managerId: user.reports_to_user_id,
        status: user.is_active ? "Active" : "Inactive",
        employmentType: user.employment_type,
        permissions: user.workforce_permissions || [],
        location: user.city || user.country || "Remote",
        attendance: presentUserIds.has(user.user_id) ? "Present" : "Not clocked in",
        joinedAt: user.created_at,
      }));

    const personName = (person) => person ? `${person.first_name || ""} ${person.last_name || ""}`.trim() || person.email : "Unknown";
    const approvalsQueue = [
      ...leaveRequests.map((request) => ({
        id: request.leave_request_id,
        item: `${request.leave_type}: ${request.start_date} – ${request.end_date}`,
        owner: personName(request.requester),
        type: "leave",
        status: "Pending",
      })),
      ...expenseClaims.map((claim) => ({
        id: claim.expense_claim_id,
        item: `${claim.category}: ${claim.currency} ${Number(claim.amount).toFixed(2)}`,
        owner: personName(claim.claimant),
        type: "expense",
        status: claim.status === "approved" ? "Approved – receipt verification" : "Pending",
      })),
      ...invoices.map((invoice) => ({
        id: invoice.invoice_id,
        item: `${invoice.invoice_number}: ${invoice.currency} ${Number(invoice.amount).toFixed(2)}`,
        owner: personName(invoice.submitter),
        type: "invoice",
        status: invoice.status.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" "),
      })),
    ];

    const activeStaff = staffDirectory.filter((member) => member.status === "Active").length;
    const latestKpiScores = kpis.map((kpi) => kpi.appraisals?.[0]?.overall_score).filter((score) => score !== undefined && score !== null).map(Number);
    const avgKpi = latestKpiScores.length ? Math.round(latestKpiScores.reduce((sum, score) => sum + score, 0) / latestKpiScores.length) : 0;
    const presentWorkforce = staffDirectory.filter((member) => presentUserIds.has(member.id)).length;
    const attendanceRate = activeStaff ? Math.min(100, Math.round((presentWorkforce / activeStaff) * 100)) : 0;
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

    if (!name || !code) {
      return res.status(400).json({
        success: false,
        message: "Department name and code are required",
      });
    }

    const existingDepartment = await Department.findOne({
      where: {
        [Op.or]: [{ name }, { code }],
      },
    });

    if (existingDepartment) {
      return res.status(400).json({
        success: false,
        message: "A department with this name or code already exists",
      });
    }

    if (manager_user_id) {
      const manager = await User.findByPk(manager_user_id);
      if (!manager) {
        return res.status(404).json({
          success: false,
          message: "Assigned manager user not found",
        });
      }
    }

    const department = await Department.create({
      name,
      code,
      description,
      manager_user_id: manager_user_id || null,
      location,
      status: "active",
    });

    return res.status(201).json({
      success: true,
      message: "Department created successfully",
      data: department,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to create department",
      error: error.message,
    });
  }
};

const updateDepartment = async (req, res) => {
  try {
    const { department_id } = req.params;
    const updates = req.body;

    const department = await Department.findByPk(department_id);
    if (!department) {
      return res.status(404).json({
        success: false,
        message: "Department not found",
      });
    }

    if (updates.manager_user_id) {
      const manager = await User.findByPk(updates.manager_user_id);
      if (!manager) {
        return res.status(404).json({
          success: false,
          message: "Assigned manager user not found",
        });
      }
    }

    await department.update(updates);

    return res.json({
      success: true,
      message: "Department updated successfully",
      data: department,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to update department",
      error: error.message,
    });
  }
};

const deleteDepartment = async (req, res) => {
  try {
    const { department_id } = req.params;
    const department = await Department.findByPk(department_id);

    if (!department) {
      return res.status(404).json({
        success: false,
        message: "Department not found",
      });
    }

    await department.destroy();

    return res.json({
      success: true,
      message: "Department deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete department",
      error: error.message,
    });
  }
};

const updateWorkforceUser = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const user = await User.findByPk(req.params.user_id, { transaction });
    if (!user) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: "Workforce user not found" });
    }
    const allowedRoles = ["super_admin", "admin", "project_manager", "staff"];
    const nextRole = req.body.role || user.role;
    if (!allowedRoles.includes(nextRole)) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: "Role must be super_admin, admin, project_manager, or staff" });
    }
    if ((nextRole === "super_admin" || user.role === "super_admin") && req.user.role !== "super_admin") {
      await transaction.rollback();
      return res.status(403).json({ success: false, message: "Only a super admin can manage super admin access" });
    }
    if (req.body.department_id && !(await Department.findByPk(req.body.department_id, { transaction }))) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: "Department not found" });
    }
    if (req.body.reports_to_user_id) {
      const manager = await User.findByPk(req.body.reports_to_user_id, { transaction });
      if (!manager || !allowedRoles.includes(manager.role)) {
        await transaction.rollback();
        return res.status(404).json({ success: false, message: "Reporting manager not found" });
      }
    }

    const fields = ["first_name", "last_name", "phone_number", "employee_id", "department_id", "job_title", "reports_to_user_id", "employment_type", "hire_date", "leave_allowance_days", "country", "city", "current_assignment", "work_region"];
    const updates = Object.fromEntries(fields.filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field] || null]));
    if (req.body.workforce_permissions !== undefined) {
      const knownPermissions = await RolePermission.findAll({ attributes: ["permission_key"], transaction });
      const knownKeys = new Set(knownPermissions.map((permission) => permission.permission_key));
      const requested = Array.isArray(req.body.workforce_permissions) ? req.body.workforce_permissions : [];
      updates.workforce_permissions = requested.filter((permission) => knownKeys.has(permission));
    }
    updates.role = nextRole;
    if (req.body.is_active !== undefined) updates.is_active = Boolean(req.body.is_active);
    await user.update(updates, { transaction });
    if (nextRole === "project_manager") {
      await ProjectManager.findOrCreate({ where: { user_id: user.user_id }, defaults: { user_id: user.user_id, status: "active" }, transaction });
    }
    if (["admin", "super_admin"].includes(nextRole)) {
      const [admin] = await Admin.findOrCreate({ where: { user_id: user.user_id }, defaults: { user_id: user.user_id, is_super_admin: nextRole === "super_admin" }, transaction });
      await admin.update({ is_super_admin: nextRole === "super_admin" }, { transaction });
    }
    await transaction.commit();
    return res.json({ success: true, message: "Workforce user updated successfully", data: user });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ success: false, message: "Failed to update workforce user", error: error.message });
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
        actionUrl: "/dashboard/staff/approvals",
        metadata: { type, id: request_id, action },
      });
    }
    const ownerId = type === "invoice" ? record.submitted_by : record.user_id;
    await Notification.create({
      user_id: ownerId,
      title: `${type.charAt(0).toUpperCase() + type.slice(1)} update`,
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
    const recipients = await User.findAll({ where: { role: { [Op.in]: ["staff", "project_manager", "engineer", "admin", "super_admin"] }, is_active: true }, attributes: ["user_id"] });
    await Notification.bulkCreate(recipients.map((user) => ({ user_id: user.user_id, title: "Holiday calendar updated", message: `${name} has been added for ${date}.`, type: "info", action_url: "/dashboard/staff/holidays", metadata: { holiday_id: holiday.holiday_id } })));
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
    if (!assignee || !["staff", "project_manager", "admin", "super_admin"].includes(assignee.role)) return res.status(404).json({ success: false, message: "Staff assignee not found" });
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
    await Notification.create({ user_id: assigned_to_user_id, title: "New KPI assigned", message: `${title} has been assigned to you.`, type: "info", action_url: "/dashboard/staff/kpis", metadata: { kpi_id: kpi.kpi_id } });
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
    if (req.body.criteria !== undefined) {
      const criteria = sanitizeKpiCriteria(req.body.criteria);
      if (!criteria.length) return res.status(400).json({ success: false, message: "At least one success criterion is required" });
      updates.criteria = criteria;
      updates.target = criteria.map((criterion) => criterion.title).join("\n");
    }
    if (updates.review_cycle && !["Monthly", "Quarterly", "Annual"].includes(updates.review_cycle)) return res.status(400).json({ success: false, message: "Review cycle must be Monthly, Quarterly, or Annual" });
    await kpi.update(updates);
    await Notification.create({ user_id: kpi.assigned_to_user_id, title: "KPI updated", message: `${kpi.title} has been updated.`, type: "info", action_url: "/dashboard/staff/kpis", metadata: { kpi_id: kpi.kpi_id } });
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
      action_url: "/dashboard/staff/kpis",
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

// update admin profile
const updateProfile = async (req, res) => {
  try {
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
      is_super_admin,
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
    const permArray = toTextArray(permissions);
    if (permArray !== undefined) adminUpdates.permissions = permArray;

    const superAdmin = toBool(is_super_admin);
    if (superAdmin !== undefined) adminUpdates.is_super_admin = superAdmin;

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

// Get specific engineer details
const getEngineerDetails = async (req, res) => {
  try {
    const { engineer_id } = req.params;

    const engineer = await Engineer.findOne({
      where: { engineer_id },
      include: [
        { model: User, as: "user" },
        {
          model: Application,
          as: "applications",
          include: [{ model: Job, as: "job" }],
        },
        { model: Project, as: "engineer_projects", include: [{ model: User }] },
      ],
    });

    if (!engineer) {
      return res.status(404).json({
        success: false,
        message: "Engineer not found",
      });
    }

    res.json({
      success: true,
      data: engineer,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get engineer details",
      error: error.message,
    });
  }
};

// Vet / Unvet an engineer
const updateEngineerVetting = async (req, res) => {
  try {
    const { engineer_id, is_vetted, remark } = req.body;

    const engineer = await Engineer.findByPk(engineer_id);

    if (!engineer) {
      return res.status(404).json({
        success: false,
        message: "Engineer not found",
      });
    }

    await engineer.update({
      is_vetted,
      vetted_at: is_vetted ? new Date() : null,
      vetted_by: is_vetted ? req.user.user_id : null,
      remark: is_vetted ? remark : null,
    });

    // 🔧 Re-fetch with correct includes
    const updatedEngineer = await Engineer.findByPk(engineer_id, {
      include: [
        {
          model: User,
          as: "user", // ✅ engineer's own user profile
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
        ? "Engineer vetted successfully"
        : "Engineer vetting removed",
      data: updatedEngineer,
    });
  } catch (error) {
    console.error("Failed to update engineer vetting:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update engineer vetting status",
      error: error.message,
    });
  }
};

// Delete engineer account
const deleteEngineer = async (req, res) => {
  try {
    const { engineer_id } = req.params;

    const engineer = await Engineer.findByPk(engineer_id, {
      include: [{ model: User, as: "user" }],
    });

    if (!engineer) {
      return res.status(404).json({
        success: false,
        message: "Engineer not found",
      });
    }

    // Check for active projects
    const activeProjects = await Project.count({
      where: {
        engineer_id: engineer.user_id,
        status: ["planning", "in_progress"],
      },
    });

    if (activeProjects > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete engineer with active projects",
      });
    }

    // Delete engineer and user
    await engineer.destroy();
    await engineer.user.destroy();

    res.json({
      success: true,
      message: "Engineer deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete engineer",
      error: error.message,
    });
  }
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

// Invite a project manager, staff member, admin, or super admin.
const inviteProjectManager = async (req, res) => {
  let transaction;
  try {
    const { email, first_name, last_name, department_id, job_title, role = "project_manager" } = req.body;
    const allowedRoles = ["super_admin", "admin", "project_manager", "staff"];
    if (!email || !allowedRoles.includes(role)) {
      return res.status(400).json({ success: false, message: "A valid email and workforce role are required" });
    }
    if (role === "super_admin" && req.user.role !== "super_admin") {
      return res.status(403).json({ success: false, message: "Only a super admin can invite another super admin" });
    }
    if (department_id && !(await Department.findByPk(department_id))) {
      return res.status(404).json({ success: false, message: "Department not found" });
    }

    // 1️⃣ Check if user already exists
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists with this email. Please ask them to login.",
      });
    }

    // 2️⃣ Check for existing pending invite
    const existingInvite = await Invite.findOne({
      where: { email, status: "pending" },
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

    const invitedUser = await Invite.create({
      email,
      first_name: first_name || null,
      last_name: last_name || null,
      department_id: department_id || null,
      job_title: job_title || null,
      // temp_password: tempPassword,
      role,
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

    res.status(201).json({
      success: true,
      message: `${role.replace("_", " ")} invited successfully.`,
      data: invitedUser,
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

    // Use the correct aliases in the include section
    const projectManager = await ProjectManager.findOne({
      where: { project_managers_id: project_managers_id },
      include: [
        { model: User, as: "user" }, // ProjectManager's associated user
        { model: Job, as: "posted_jobs" },
        {
          model: Project,
          as: "pm_projects", // Projects associated with the ProjectManager
          include: [
            {
              model: User,
              as: "engineer", // Engineer associated with the Project
            },
          ],
        },
      ],
    });

    if (!projectManager) {
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
    const { project_managers_id } = req.params;

    const projectManager = await ProjectManager.findByPk(project_managers_id, {
      include: [{ model: User, as: "user" }],
    });

    if (!projectManager) {
      return res.status(404).json({
        success: false,
        message: "Project manager not found",
      });
    }

    // Check for active projects
    const activeProjects = await Project.count({
      where: {
        project_managers_user_id: projectManager.user_id,
        status: ["in_progress"],
      },
    });

    if (activeProjects > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete project manager with active projects",
      });
    }

    // Delete project manager and user
    await projectManager.destroy();
    await projectManager.user.destroy();

    res.json({
      success: true,
      message: "Project manager deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete project manager",
      error: error.message,
    });
  }
};

// Get engineers pending vetting
const getEngineerVetting = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const engineers = await Engineer.findAndCountAll({
      where: { is_vetted: false, is_onboarded: true },
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
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "ASC"]],
    });

    res.json({
      success: true,
      data: {
        engineers: engineers.rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(engineers.count / limit),
          totalItems: engineers.count,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get engineers pending vetting",
      error: error.message,
    });
  }
};

// Get platform settings
const getSettings = async (req, res) => {
  try {
    const settings = await Setting.findAll();

    const settingsObject = {};
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
  updateProfile,
  getEngineerDetails,
  updateEngineerVetting,
  deleteEngineer,
  getProjectManagers,
  inviteProjectManager,
  getProjectManagerDetails,
  deleteProjectManager,
  getEngineerVetting,
  getSettings,
  updateSettings,
  // getPmsProjectById,
};
