const express = require("express");
const { authenticate, authorize, authorizePermission, authorizeAnyPermission, authorizeApprovalAction } = require("../middleware/auth");
const { upload } = require("../middleware/upload");
const staffController = require("../controllers/staffController");
const adminController = require("../controllers/adminController");

const router = express.Router();

router.use(authenticate, authorize("staff", "project_manager", "engineer", "admin", "super_admin"));

router.get("/dashboard", staffController.getDashboard);
router.get("/approvals", authorizeAnyPermission("approve_leave", "approve_expenses", "verify_receipts", "approve_invoices"), staffController.getApprovalQueue);
router.put("/approvals/:type/:request_id", authorizeApprovalAction, adminController.reviewWorkforceApproval);
router.get("/attendance", staffController.getAttendance);
router.post("/attendance/clock-in", staffController.clockIn);
router.post("/attendance/clock-out", staffController.clockOut);
router.get("/leave", staffController.getLeaveRequests);
router.post("/leave", staffController.submitLeave);
router.get("/expenses", staffController.getExpenses);
router.post("/expenses", authorizePermission("submit_expenses"), upload.single("receipt"), staffController.submitExpense);
router.get("/invoices", staffController.getInvoices);
router.post("/invoices", staffController.submitInvoice);
router.get("/project-invoices/completed-projects", staffController.getCompletedProjectsForInvoice);
router.get("/project-invoices", staffController.getProjectInvoices);
router.post("/project-invoices", staffController.submitProjectInvoice);
router.get("/kpis", staffController.getKpis);
router.get("/holidays", staffController.getHolidays);
router.get("/birthdays", staffController.getBirthdays);
router.get("/profile", staffController.getProfile);
router.put("/profile", upload.single("avatar"), staffController.updateProfile);
router.put("/location-sharing", staffController.updateLocationSharing);
router.post("/location", staffController.updateLiveLocation);
router.get("/location/reverse-geo", staffController.reverseGeoLocation);
router.post("/location/reverse-geo", staffController.reverseGeoLocation);

module.exports = router;
