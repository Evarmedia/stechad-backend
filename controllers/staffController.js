const moment = require("moment");
const { Op } = require("sequelize");
const {
  User,
  Department,
  Attendance,
  LeaveRequest,
  ExpenseClaim,
  Holiday,
  Kpi,
  Invoice,
  Project,
  ProjectManager,
  RolePermission,
  Notification,
} = require("../models");
const { uploadToGCP } = require("../middleware/upload");
const { getV4ReadSignedUrl } = require("../config/gcpStorage");
const { hasPermission } = require("../middleware/auth");
const { notifyPermissionHolders } = require("../utils/workforceNotification");

const titleCase = (value = "") => value
  .split("_")
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(" ");

const formatTime = (value) => value ? moment(value).format("hh:mm A") : null;

const formatAttendance = (entry) => ({
  id: entry.attendance_id,
  date: entry.work_date,
  clockIn: formatTime(entry.clock_in),
  clockOut: formatTime(entry.clock_out),
  workLog: entry.work_log || "",
  status: titleCase(entry.status),
  isOpen: !entry.clock_out,
  location: entry.latitude && entry.longitude
    ? { latitude: Number(entry.latitude), longitude: Number(entry.longitude), accuracy: Number(entry.location_accuracy || 0) }
    : null,
});

const formatLeave = (request) => ({
  id: request.leave_request_id,
  type: request.leave_type,
  startDate: request.start_date,
  endDate: request.end_date,
  dates: request.start_date === request.end_date ? request.start_date : `${request.start_date} – ${request.end_date}`,
  reason: request.reason || "",
  status: titleCase(request.status),
  feedback: request.review_notes || "",
  createdAt: request.created_at,
});

const formatExpense = async (claim) => {
  let receiptUrl = null;
  if (claim.receipt_object_name) {
    try {
      receiptUrl = await getV4ReadSignedUrl(claim.receipt_object_name, 3600);
    } catch (error) {
      console.error("Failed to sign expense receipt URL:", error.message);
    }
  }

  return {
    id: claim.expense_claim_id,
    category: claim.category,
    amount: Number(claim.amount),
    currency: claim.currency,
    description: claim.description || "",
    date: claim.expense_date,
    status: titleCase(claim.status),
    feedback: claim.review_notes || "",
    receiptName: claim.receipt_original_name,
    receiptUrl,
  };
};

const formatInvoice = (invoice) => ({
  id: invoice.invoice_id,
  invoiceNumber: invoice.invoice_number,
  period: invoice.period,
  amount: Number(invoice.amount),
  currency: invoice.currency,
  notes: invoice.notes || "",
  type: invoice.invoice_type,
  status: titleCase(invoice.status),
  feedback: invoice.review_notes || "",
  zohoInvoiceId: invoice.zoho_invoice_id,
  createdAt: invoice.created_at,
});

const notifyAdmins = async ({ title, message, action_url, metadata }) => {
  const permissionKey = metadata?.type === "leave" ? "approve_leave" : metadata?.type === "expense" ? "approve_expenses" : "approve_invoices";
  await notifyPermissionHolders({ permissionKey, title, message, actionUrl: action_url, metadata });
};

const getAttendanceData = async (userId) => {
  const monthStart = moment().startOf("month").format("YYYY-MM-DD");
  const monthEnd = moment().endOf("month").format("YYYY-MM-DD");
  const entries = await Attendance.findAll({
    where: { user_id: userId },
    order: [["work_date", "DESC"]],
    limit: 60,
  });
  const monthEntries = entries.filter((entry) => entry.work_date >= monthStart && entry.work_date <= monthEnd);
  const completed = monthEntries.filter((entry) => entry.clock_out).length;
  const expectedDaysToDate = Array.from({ length: moment().date() }, (_, index) => moment().startOf("month").add(index, "days"))
    .filter((day) => day.isoWeekday() <= 5).length;
  const today = entries.find((entry) => entry.work_date === moment().format("YYYY-MM-DD")) || null;

  return {
    entries: entries.map(formatAttendance),
    summary: {
      currentStatus: today ? (today.clock_out ? "Clocked out" : "Clocked in") : "Not clocked in",
      attendanceRate: expectedDaysToDate ? Math.min(100, Math.round((monthEntries.length / expectedDaysToDate) * 100)) : 0,
      daysLogged: monthEntries.length,
      completedDays: completed,
      expectedDays: expectedDaysToDate,
      today: today ? formatAttendance(today) : null,
    },
  };
};

const getLeaveBalance = async (user) => {
  const yearStart = moment().startOf("year").format("YYYY-MM-DD");
  const yearEnd = moment().endOf("year").format("YYYY-MM-DD");
  const approved = await LeaveRequest.findAll({
    where: { user_id: user.user_id, status: "approved", start_date: { [Op.between]: [yearStart, yearEnd] } },
  });
  const used = approved.reduce((total, request) => total + moment(request.end_date).diff(moment(request.start_date), "days") + 1, 0);
  const allowance = Number(user.leave_allowance_days || 20);
  return { allowance, used, remaining: Math.max(0, allowance - used) };
};

const getDashboard = async (req, res) => {
  try {
    const [attendance, leaveRows, expenseRows, invoiceRows, kpis, holidays, permissions, leaveBalance] = await Promise.all([
      getAttendanceData(req.user.user_id),
      LeaveRequest.findAll({ where: { user_id: req.user.user_id }, order: [["created_at", "DESC"]], limit: 5 }),
      ExpenseClaim.findAll({ where: { user_id: req.user.user_id }, order: [["created_at", "DESC"]], limit: 5 }),
      Invoice.findAll({ where: { submitted_by: req.user.user_id }, order: [["created_at", "DESC"]], limit: 5 }),
      Kpi.findAll({ where: { assigned_to_user_id: req.user.user_id, status: { [Op.ne]: "archived" } }, order: [["created_at", "DESC"]], limit: 5 }),
      Holiday.findAll({ where: { date: { [Op.gte]: moment().format("YYYY-MM-DD") } }, order: [["date", "ASC"]], limit: 5 }),
      RolePermission.findAll({ order: [["name", "ASC"]] }),
      getLeaveBalance(req.user),
    ]);
    const expenses = await Promise.all(expenseRows.map(formatExpense));
    const expenseTotal = expenses.reduce((sum, claim) => sum + claim.amount, 0);
    const kpiProgress = kpis.length ? Math.round(kpis.reduce((sum, kpi) => sum + kpi.progress, 0) / kpis.length) : 0;

    return res.json({
      success: true,
      data: {
        summary: {
          attendance: `${attendance.summary.attendanceRate}%`,
          leaveBalance: `${leaveBalance.remaining} days`,
          expenseTotal,
          kpiProgress: `${kpiProgress}%`,
        },
        attendance: attendance.entries.slice(0, 5),
        attendanceSummary: attendance.summary,
        leave: leaveRows.map(formatLeave),
        leaveBalance,
        expenses,
        invoices: invoiceRows.map(formatInvoice),
        kpis: kpis.map((kpi) => ({
          id: kpi.kpi_id,
          title: kpi.title,
          target: kpi.target,
          description: kpi.description,
          review: kpi.review_cycle,
          progress: kpi.progress,
          score: kpi.appraisal_score ? Number(kpi.appraisal_score) : null,
          notes: kpi.appraisal_notes,
          status: titleCase(kpi.status),
        })),
        holidays,
        permissions: permissions.map((permission) => ({
          key: permission.permission_key,
          name: permission.name,
          allowed: req.user.role === "super_admin" || Boolean(permission[req.user.role]),
        })),
        user: {
          id: req.user.user_id,
          name: `${req.user.first_name || ""} ${req.user.last_name || ""}`.trim() || req.user.email,
          email: req.user.email,
          role: req.user.role,
          locationSharingEnabled: req.user.location_sharing_enabled,
          today: moment().format("YYYY-MM-DD"),
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load staff dashboard", error: error.message });
  }
};

const getApprovalQueue = async (req, res) => {
  try {
    const [canLeave, canExpenses, canVerifyReceipts, canInvoices] = await Promise.all([
      hasPermission(req.user, "approve_leave"),
      hasPermission(req.user, "approve_expenses"),
      hasPermission(req.user, "verify_receipts"),
      hasPermission(req.user, "approve_invoices"),
    ]);
    const queries = [];
    if (canLeave) queries.push(LeaveRequest.findAll({ where: { status: "pending" }, include: [{ model: User, as: "requester", attributes: ["first_name", "last_name", "email"] }], order: [["created_at", "ASC"]] }).then((rows) => rows.map((row) => ({ id: row.leave_request_id, type: "leave", owner: `${row.requester?.first_name || ""} ${row.requester?.last_name || ""}`.trim() || row.requester?.email, item: `${row.leave_type}: ${row.start_date} – ${row.end_date}`, status: titleCase(row.status), actions: ["approved", "rejected"] }))));
    if (canExpenses || canVerifyReceipts) queries.push(ExpenseClaim.findAll({ where: { status: { [Op.in]: canExpenses && canVerifyReceipts ? ["pending", "approved"] : canExpenses ? ["pending"] : ["approved"] } }, include: [{ model: User, as: "claimant", attributes: ["first_name", "last_name", "email"] }], order: [["created_at", "ASC"]] }).then((rows) => rows.map((row) => ({ id: row.expense_claim_id, type: "expense", owner: `${row.claimant?.first_name || ""} ${row.claimant?.last_name || ""}`.trim() || row.claimant?.email, item: `${row.category}: ${row.currency} ${Number(row.amount).toFixed(2)}`, status: titleCase(row.status), actions: row.status === "approved" ? ["receipt_verified"] : ["approved", "rejected"] }))));
    if (canInvoices) queries.push(Invoice.findAll({ where: { status: { [Op.in]: ["pending", "approved"] } }, include: [{ model: User, as: "submitter", attributes: ["first_name", "last_name", "email"] }], order: [["created_at", "ASC"]] }).then((rows) => rows.map((row) => ({ id: row.invoice_id, type: "invoice", owner: `${row.submitter?.first_name || ""} ${row.submitter?.last_name || ""}`.trim() || row.submitter?.email, item: `${row.invoice_number}: ${row.currency} ${Number(row.amount).toFixed(2)}`, status: titleCase(row.status), actions: row.status === "approved" ? ["accounts_approved"] : ["approved", "disputed"] }))));
    const groups = await Promise.all(queries);
    return res.json({ success: true, data: groups.flat() });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load approval queue", error: error.message });
  }
};

const getAttendance = async (req, res) => {
  try {
    return res.json({ success: true, data: await getAttendanceData(req.user.user_id) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load attendance", error: error.message });
  }
};

const clockIn = async (req, res) => {
  try {
    const workDate = moment().format("YYYY-MM-DD");
    const existing = await Attendance.findOne({ where: { user_id: req.user.user_id, work_date: workDate } });
    if (existing) return res.status(409).json({ success: false, message: "Attendance has already been started for today" });
    const { latitude, longitude, accuracy } = req.body;
    const entry = await Attendance.create({
      user_id: req.user.user_id,
      work_date: workDate,
      clock_in: new Date(),
      status: moment().hour() >= 9 ? "late" : "present",
      latitude: req.user.location_sharing_enabled ? latitude || null : null,
      longitude: req.user.location_sharing_enabled ? longitude || null : null,
      location_accuracy: req.user.location_sharing_enabled ? accuracy || null : null,
    });
    return res.status(201).json({ success: true, message: "Clocked in successfully", data: formatAttendance(entry) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to clock in", error: error.message });
  }
};

const clockOut = async (req, res) => {
  try {
    const { work_log, latitude, longitude, accuracy } = req.body;
    if (!work_log || !work_log.trim()) return res.status(400).json({ success: false, message: "A daily work summary is required before clocking out" });
    const entry = await Attendance.findOne({ where: { user_id: req.user.user_id, work_date: moment().format("YYYY-MM-DD") } });
    if (!entry) return res.status(404).json({ success: false, message: "Clock in before attempting to clock out" });
    if (entry.clock_out) return res.status(409).json({ success: false, message: "You have already clocked out today" });
    await entry.update({
      clock_out: new Date(),
      work_log: work_log.trim(),
      status: "completed",
      latitude: req.user.location_sharing_enabled ? latitude || entry.latitude : entry.latitude,
      longitude: req.user.location_sharing_enabled ? longitude || entry.longitude : entry.longitude,
      location_accuracy: req.user.location_sharing_enabled ? accuracy || entry.location_accuracy : entry.location_accuracy,
    });
    return res.json({ success: true, message: "Clocked out successfully", data: formatAttendance(entry) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to clock out", error: error.message });
  }
};

const getLeaveRequests = async (req, res) => {
  try {
    const requests = await LeaveRequest.findAll({ where: { user_id: req.user.user_id }, order: [["created_at", "DESC"]] });
    return res.json({ success: true, data: { requests: requests.map(formatLeave), balance: await getLeaveBalance(req.user) } });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load leave requests", error: error.message });
  }
};

const submitLeave = async (req, res) => {
  try {
    const { type, leave_type, start_date, end_date, dates, reason } = req.body;
    const startDate = start_date || dates;
    const endDate = end_date || startDate;
    const leaveType = leave_type || type;
    if (!leaveType || !startDate || !endDate) return res.status(400).json({ success: false, message: "Leave type, start date, and end date are required" });
    if (!moment(startDate, "YYYY-MM-DD", true).isValid() || !moment(endDate, "YYYY-MM-DD", true).isValid()) return res.status(400).json({ success: false, message: "Leave dates must use YYYY-MM-DD format" });
    if (moment(endDate).isBefore(moment(startDate))) return res.status(400).json({ success: false, message: "End date cannot be before start date" });
    const request = await LeaveRequest.create({ user_id: req.user.user_id, leave_type: leaveType, start_date: startDate, end_date: endDate, reason: reason || null });
    const requesterName = `${req.user.first_name || ""} ${req.user.last_name || ""}`.trim() || req.user.email;
    await notifyAdmins({ title: "New leave request", message: `${requesterName} submitted a ${leaveType} request.`, action_url: "/admin/workforce", metadata: { type: "leave", id: request.leave_request_id } });
    return res.status(201).json({ success: true, message: "Leave request submitted successfully", data: formatLeave(request) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to submit leave request", error: error.message });
  }
};

const getExpenses = async (req, res) => {
  try {
    const claims = await ExpenseClaim.findAll({ where: { user_id: req.user.user_id }, order: [["created_at", "DESC"]] });
    return res.json({ success: true, data: await Promise.all(claims.map(formatExpense)) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load expense claims", error: error.message });
  }
};

const submitExpense = async (req, res) => {
  try {
    const { category, amount, currency = "USD", description, expense_date } = req.body;
    if (!category || !amount || Number(amount) <= 0) return res.status(400).json({ success: false, message: "Expense category and a positive amount are required" });
    if (!req.file) return res.status(400).json({ success: false, message: "A receipt image or PDF is required" });
    const { objectName } = await uploadToGCP(req.file, req.user.user_id, "expense-receipts");
    const claim = await ExpenseClaim.create({
      user_id: req.user.user_id,
      category,
      amount: Number(amount),
      currency: String(currency).toUpperCase(),
      description: description || null,
      expense_date: expense_date || moment().format("YYYY-MM-DD"),
      receipt_object_name: objectName,
      receipt_original_name: req.file.originalname,
    });
    const requesterName = `${req.user.first_name || ""} ${req.user.last_name || ""}`.trim() || req.user.email;
    await notifyAdmins({ title: "New expense claim", message: `${requesterName} submitted a ${currency} ${Number(amount).toFixed(2)} expense claim.`, action_url: "/admin/workforce", metadata: { type: "expense", id: claim.expense_claim_id } });
    return res.status(201).json({ success: true, message: "Expense claim submitted successfully", data: await formatExpense(claim) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to submit expense claim", error: error.message });
  }
};

const getInvoices = async (req, res) => {
  try {
    const invoices = await Invoice.findAll({ where: { submitted_by: req.user.user_id }, order: [["created_at", "DESC"]] });
    return res.json({ success: true, data: invoices.map(formatInvoice) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load invoices", error: error.message });
  }
};

const submitInvoice = async (req, res) => {
  try {
    const { period, amount, currency = "USD", notes, line_items = [] } = req.body;
    if (!period || !amount || Number(amount) <= 0) return res.status(400).json({ success: false, message: "Billing period and a positive amount are required" });
    const invoice = await Invoice.create({
      invoice_number: `INV-${moment().format("YYYYMMDD")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      submitted_by: req.user.user_id,
      invoice_type: req.user.role === "engineer" ? "engineer" : "staff",
      period,
      amount: Number(amount),
      currency: String(currency).toUpperCase(),
      notes: notes || null,
      line_items: Array.isArray(line_items) ? line_items : [],
      status: "pending",
    });
    await notifyAdmins({ title: "New invoice submitted", message: `${req.user.email} submitted invoice ${invoice.invoice_number}.`, action_url: "/admin/workforce", metadata: { type: "invoice", id: invoice.invoice_id } });
    return res.status(201).json({ success: true, message: "Invoice submitted for review", data: formatInvoice(invoice) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to submit invoice", error: error.message });
  }
};

const getProjectInvoices = async (req, res) => {
  try {
    if (req.user.role !== "project_manager") return res.status(403).json({ success: false, message: "Project invoice summaries are only available to project managers" });
    const manager = await ProjectManager.findOne({ where: { user_id: req.user.user_id } });
    if (!manager) return res.status(404).json({ success: false, message: "Project manager profile not found" });
    const [projects, invoices] = await Promise.all([
      Project.findAll({ where: { project_managers_id: manager.project_managers_id }, order: [["created_at", "DESC"]] }),
      Invoice.findAll({ where: { submitted_by: req.user.user_id, invoice_type: "project" }, include: [{ model: Project, as: "project", attributes: ["projects_id", "title", "status"] }], order: [["created_at", "DESC"]] }),
    ]);
    return res.json({
      success: true,
      data: {
        projects: projects.map((project) => ({ id: project.projects_id, title: project.title, status: project.status })),
        invoices: invoices.map((invoice) => ({ ...formatInvoice(invoice), project: invoice.project?.title || "Deleted project", projectId: invoice.project_id, client: invoice.client_name })),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load project invoice summaries", error: error.message });
  }
};

const submitProjectInvoice = async (req, res) => {
  try {
    if (req.user.role !== "project_manager") return res.status(403).json({ success: false, message: "Only project managers can submit project invoices" });
    const { project_id, client_name, period, amount, currency = "USD", notes, line_items = [] } = req.body;
    if (!project_id || !client_name || !period || !amount || Number(amount) <= 0) return res.status(400).json({ success: false, message: "Project, client, billing period, and a positive amount are required" });
    const manager = await ProjectManager.findOne({ where: { user_id: req.user.user_id } });
    const project = manager ? await Project.findOne({ where: { projects_id: project_id, project_managers_id: manager.project_managers_id } }) : null;
    if (!project) return res.status(404).json({ success: false, message: "Assigned project not found" });
    if (project.status !== "completed") return res.status(409).json({ success: false, message: "Mark the project completed before submitting its invoice summary" });
    const invoice = await Invoice.create({
      invoice_number: `PRJ-${moment().format("YYYYMMDD")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      submitted_by: req.user.user_id,
      project_id,
      invoice_type: "project",
      period,
      client_name,
      amount: Number(amount),
      currency: String(currency).toUpperCase(),
      notes: notes || null,
      line_items: Array.isArray(line_items) ? line_items : [],
      status: "pending",
    });
    await notifyAdmins({ title: "New project invoice summary", message: `${req.user.email} submitted ${invoice.invoice_number} for ${project.title}.`, action_url: "/admin/workforce", metadata: { type: "invoice", id: invoice.invoice_id, project_id } });
    return res.status(201).json({ success: true, message: "Project invoice summary submitted to accounts review", data: { ...formatInvoice(invoice), project: project.title, client: client_name } });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to submit project invoice summary", error: error.message });
  }
};

const getKpis = async (req, res) => {
  try {
    const kpis = await Kpi.findAll({ where: { assigned_to_user_id: req.user.user_id }, order: [["created_at", "DESC"]] });
    return res.json({ success: true, data: kpis.map((kpi) => ({
      id: kpi.kpi_id,
      title: kpi.title,
      target: kpi.target,
      description: kpi.description,
      review: kpi.review_cycle,
      periodStart: kpi.period_start,
      periodEnd: kpi.period_end,
      progress: kpi.progress,
      score: kpi.appraisal_score ? Number(kpi.appraisal_score) : null,
      notes: kpi.appraisal_notes,
      status: titleCase(kpi.status),
    })) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load KPIs", error: error.message });
  }
};

const getHolidays = async (req, res) => {
  try {
    const where = req.query.all === "true" ? {} : { date: { [Op.gte]: moment().format("YYYY-MM-DD") } };
    const holidays = await Holiday.findAll({ where, order: [["date", "ASC"]] });
    return res.json({ success: true, data: holidays });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load holidays", error: error.message });
  }
};

const getBirthdays = async (req, res) => {
  try {
    const users = await User.findAll({
      where: { is_active: true, date_of_birth: { [Op.ne]: null }, role: { [Op.in]: ["staff", "project_manager", "admin", "super_admin"] } },
      attributes: ["user_id", "first_name", "last_name", "date_of_birth"],
    });
    const today = moment().startOf("day");
    const birthdays = users.map((user) => {
      const monthDay = moment(user.date_of_birth).format("MM-DD");
      let nextDate = moment(`${today.year()}-${monthDay}`, "YYYY-MM-DD");
      if (nextDate.isBefore(today)) nextDate = nextDate.add(1, "year");
      return { id: user.user_id, name: `${user.first_name || ""} ${user.last_name || ""}`.trim(), date: nextDate.format("YYYY-MM-DD"), monthDay, daysAway: nextDate.diff(today, "days") };
    }).filter((birthday) => birthday.daysAway <= 60).sort((a, b) => a.daysAway - b.daysAway);
    return res.json({ success: true, data: birthdays });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load upcoming birthdays", error: error.message });
  }
};

const getProfile = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.user_id, {
      include: [
        { model: Department, as: "department", attributes: ["department_id", "name", "code"] },
        { model: User, as: "reporting_manager", attributes: ["user_id", "first_name", "last_name", "email"] },
      ],
    });
    return res.json({ success: true, data: user });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load staff profile", error: error.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const allowed = ["first_name", "last_name", "phone_number", "country", "city", "linkedin_url", "website_url", "current_assignment", "work_region", "date_of_birth"];
    const updates = Object.fromEntries(allowed.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]]));
    await req.user.update(updates);
    return getProfile(req, res);
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to update staff profile", error: error.message });
  }
};

const updateLocationSharing = async (req, res) => {
  try {
    if (typeof req.body.enabled !== "boolean") return res.status(400).json({ success: false, message: "enabled must be a boolean" });
    await req.user.update({ location_sharing_enabled: req.body.enabled });
    return res.json({ success: true, message: req.body.enabled ? "Location sharing enabled" : "Location sharing disabled", data: { enabled: req.user.location_sharing_enabled } });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to update location consent", error: error.message });
  }
};

const updateLiveLocation = async (req, res) => {
  try {
    if (!req.user.location_sharing_enabled) return res.status(403).json({ success: false, message: "Enable location sharing before sending a location" });
    const { latitude, longitude, accuracy } = req.body;
    if (latitude === undefined || longitude === undefined) return res.status(400).json({ success: false, message: "Latitude and longitude are required" });
    const entry = await Attendance.findOne({ where: { user_id: req.user.user_id, work_date: moment().format("YYYY-MM-DD"), clock_out: null } });
    if (!entry) return res.status(409).json({ success: false, message: "Location is only captured during an active work session" });
    await entry.update({ latitude, longitude, location_accuracy: accuracy || null });
    return res.json({ success: true, message: "Live work location updated" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to update location", error: error.message });
  }
};

module.exports = {
  getDashboard,
  getApprovalQueue,
  getAttendance,
  clockIn,
  clockOut,
  getLeaveRequests,
  submitLeave,
  getExpenses,
  submitExpense,
  getInvoices,
  submitInvoice,
  getProjectInvoices,
  submitProjectInvoice,
  getKpis,
  getHolidays,
  getBirthdays,
  getProfile,
  updateProfile,
  updateLocationSharing,
  updateLiveLocation,
};
