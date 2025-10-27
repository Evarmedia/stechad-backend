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
  body('first_name').notEmpty().trim(),
  body('last_name').notEmpty().trim(),
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
  body('title').notEmpty().trim(),
  body('description').notEmpty().trim(),
  body('budget_type').isIn(['hourly', 'fixed', 'negotiable']),
  body('experience_level').isIn(['entry', 'intermediate', 'senior', 'expert']),
  body('job_type').isIn(['full_time', 'part_time', 'contract', 'freelance']),
  handleValidationErrors
];

// Application validation
const validateApplication = [
  body('cover_letter').optional().trim(),
  body('proposed_rate').optional().isNumeric(),
  body('availability').optional().trim(),
  handleValidationErrors
];

module.exports = {
  validateRegistration,
  validateLogin,
  validateJobCreation,
  validateApplication,
  handleValidationErrors
};