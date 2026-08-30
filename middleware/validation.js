const { body, validationResult } = require('express-validator');

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const formattedErrors = {};

    errors.array().forEach((err) => {
      // Only record first error per field
      if (!formattedErrors[err.param]) {
        formattedErrors[err.param] = err.msg;
      }
    });

    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: formattedErrors,
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
  body('role').equals('engineer').withMessage('Only engineers can register directly; workforce roles require an invitation'),
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
  body("title").notEmpty().withMessage("Job title is required").trim(),
  body("company").notEmpty().withMessage("Company is required").trim(),
  body("location").notEmpty().withMessage("Location is required").trim(),
  body("description").notEmpty().withMessage("Description is required").trim(),

  body("employment_type")
    .isIn(["full-time", "contract", "part-time"])
    .withMessage("Employment type is invalid"),

  body("openings").isInt({ min: 1 }).withMessage("Openings must be at least 1"),

  body("experience_level")
    .isIn(["entry", "intermediate", "advanced", "expert"])
    .withMessage("Experience level is invalid"),

  body("skills_required")
    .isArray({ min: 1 })
    .withMessage("At least one skill is required"),

  body("requirements")
    .isArray({ min: 1 })
    .withMessage("At least one requirement is required"),

  body("responsibilities")
    .isArray({ min: 1 })
    .withMessage("At least one responsibility is required"),

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
