const { body, validationResult } = require('express-validator');

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// User registration validation
const validateRegistration = [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  // body('first_name').notEmpty().trim(),
  // body('last_name').notEmpty().trim(),
  body('role').isIn(['engineer', 'project_manager', 'admin']),
  handleValidationErrors
];

// User login validation
const validateLogin = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  handleValidationErrors
];

// Job creation validation
const validateJobCreation = [
  body("title").notEmpty().trim(),
  body("company").notEmpty().trim(),
  body("location").notEmpty().trim(),
  body("description").notEmpty().trim(),
  body("employment_type").isIn(["full-time", "contract", "part-time"]),
  body("salary").optional().trim(),
  body("duration").optional().trim(),
  body("openings").isInt({ min: 1 }),
  body("experience_level").isIn([
    "entry",
    "intermediate",
    "advanced",
    "expert",
  ]),
  body("skills_required").isArray({ min: 1 }),
  body("requirements").isArray({ min: 1 }),
  body("responsibilities").isArray({ min: 1 }),
  handleValidationErrors,
];

// Application validation
const validateApplication = [
  body('job_id').isUUID(),
  body('engineer_id').isUUID(),
  // body('job_title').notEmpty().trim(),
  // body('engineer_name').notEmpty().trim(),
  // body('cover_letter').optional().trim(),
  // body('proposed_rate').optional().isNumeric(),
  // body('availability').optional().trim(),
  handleValidationErrors
];

module.exports = {
  validateRegistration,
  validateLogin,
  validateJobCreation,
  validateApplication,
  handleValidationErrors
};