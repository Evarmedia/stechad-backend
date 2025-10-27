const swaggerJSDoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Engineering Platform API',
      version: '1.0.0',
      description: 'A comprehensive API for an engineering talent platform connecting engineers with project managers',
      contact: {
        name: 'Engineering Platform Team',
        email: 'support@engineeringplatform.com'
      }
    },
    servers: [
      {
        url: 'http://localhost:5000/api',
        description: 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            email: { type: 'string', format: 'email', example: 'john@example.com' },
            role: { type: 'string', enum: ['engineer', 'project_manager', 'admin'], example: 'engineer' },
            first_name: { type: 'string', example: 'John' },
            last_name: { type: 'string', example: 'Doe' },
            phone: { type: 'string', example: '+1234567890' },
            avatar: { type: 'string', example: 'avatar-123.jpg' },
            is_active: { type: 'boolean', example: true },
            is_verified: { type: 'boolean', example: false },
            last_login: { type: 'string', format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' }
          }
        },
        Engineer: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            user_id: { type: 'integer', example: 1 },
            skills: { type: 'array', items: { type: 'string' }, example: ['JavaScript', 'React', 'Node.js'] },
            experience_years: { type: 'integer', example: 5 },
            bio: { type: 'string', example: 'Experienced full-stack developer' },
            resume_url: { type: 'string', example: 'resume-123.pdf' },
            portfolio_url: { type: 'string', example: 'https://portfolio.com' },
            github_url: { type: 'string', example: 'https://github.com/johndoe' },
            linkedin_url: { type: 'string', example: 'https://linkedin.com/in/johndoe' },
            availability: { type: 'string', enum: ['available', 'busy', 'unavailable'], example: 'available' },
            hourly_rate: { type: 'number', format: 'decimal', example: 75.00 },
            location: { type: 'string', example: 'New York, NY' },
            timezone: { type: 'string', example: 'America/New_York' },
            is_vetted: { type: 'boolean', example: false },
            onboarding_completed: { type: 'boolean', example: true },
            rating: { type: 'number', format: 'decimal', example: 4.5 },
            total_projects: { type: 'integer', example: 12 }
          }
        },
        ProjectManager: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            user_id: { type: 'integer', example: 2 },
            company_name: { type: 'string', example: 'Tech Corp Inc.' },
            company_size: { type: 'string', example: '50-100' },
            industry: { type: 'string', example: 'Technology' },
            bio: { type: 'string', example: 'Experienced project manager in tech industry' },
            website_url: { type: 'string', example: 'https://techcorp.com' },
            linkedin_url: { type: 'string', example: 'https://linkedin.com/in/pmjohn' },
            location: { type: 'string', example: 'San Francisco, CA' },
            timezone: { type: 'string', example: 'America/Los_Angeles' },
            is_verified: { type: 'boolean', example: true },
            total_projects: { type: 'integer', example: 25 },
            total_hires: { type: 'integer', example: 40 }
          }
        },
        Job: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            title: { type: 'string', example: 'Senior React Developer' },
            description: { type: 'string', example: 'We are looking for a senior React developer...' },
            requirements: { type: 'array', items: { type: 'string' }, example: ['5+ years React', 'TypeScript'] },
            skills_required: { type: 'array', items: { type: 'string' }, example: ['React', 'TypeScript', 'Node.js'] },
            budget_min: { type: 'number', format: 'decimal', example: 5000.00 },
            budget_max: { type: 'number', format: 'decimal', example: 8000.00 },
            budget_type: { type: 'string', enum: ['hourly', 'fixed', 'negotiable'], example: 'fixed' },
            duration: { type: 'string', example: '3 months' },
            location: { type: 'string', example: 'Remote' },
            remote_allowed: { type: 'boolean', example: true },
            experience_level: { type: 'string', enum: ['entry', 'intermediate', 'senior', 'expert'], example: 'senior' },
            job_type: { type: 'string', enum: ['full_time', 'part_time', 'contract', 'freelance'], example: 'contract' },
            status: { type: 'string', enum: ['draft', 'open', 'closed', 'in_progress', 'completed'], example: 'open' },
            posted_by: { type: 'integer', example: 2 },
            deadline: { type: 'string', format: 'date-time' },
            applications_count: { type: 'integer', example: 15 },
            views_count: { type: 'integer', example: 120 },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' }
          }
        },
        Application: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            job_id: { type: 'integer', example: 1 },
            engineer_id: { type: 'integer', example: 1 },
            cover_letter: { type: 'string', example: 'I am interested in this position...' },
            proposed_rate: { type: 'number', format: 'decimal', example: 75.00 },
            availability: { type: 'string', example: 'Available immediately' },
            status: { type: 'string', enum: ['pending', 'reviewed', 'shortlisted', 'rejected', 'hired'], example: 'pending' },
            reviewed_at: { type: 'string', format: 'date-time' },
            reviewed_by: { type: 'integer', example: 2 },
            feedback: { type: 'string', example: 'Great profile, moving to next round' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' }
          }
        },
        Project: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            title: { type: 'string', example: 'E-commerce Website Development' },
            description: { type: 'string', example: 'Building a modern e-commerce platform...' },
            job_id: { type: 'integer', example: 1 },
            client_id: { type: 'integer', example: 2 },
            engineer_id: { type: 'integer', example: 1 },
            status: { type: 'string', enum: ['planning', 'in_progress', 'review', 'completed', 'cancelled'], example: 'in_progress' },
            budget: { type: 'number', format: 'decimal', example: 7500.00 },
            start_date: { type: 'string', format: 'date-time' },
            end_date: { type: 'string', format: 'date-time' },
            actual_end_date: { type: 'string', format: 'date-time' },
            progress: { type: 'integer', minimum: 0, maximum: 100, example: 65 },
            milestones: { type: 'array', items: { type: 'object' } },
            deliverables: { type: 'array', items: { type: 'object' } },
            rating: { type: 'number', format: 'decimal', example: 4.8 },
            feedback: { type: 'string', example: 'Excellent work quality and communication' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' }
          }
        },
        Notification: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            user_id: { type: 'integer', example: 1 },
            title: { type: 'string', example: 'New Job Application' },
            message: { type: 'string', example: 'You have received a new application for your job posting' },
            type: { type: 'string', enum: ['info', 'success', 'warning', 'error'], example: 'info' },
            is_read: { type: 'boolean', example: false },
            read_at: { type: 'string', format: 'date-time' },
            action_url: { type: 'string', example: '/applications/123' },
            metadata: { type: 'object' },
            created_at: { type: 'string', format: 'date-time' }
          }
        },
        FileUpload: {
          type: 'object',
          properties: {
            filename: { type: 'string', example: 'resume-1234567890.pdf' },
            path: { type: 'string', example: '/uploads/resumes/resume-1234567890.pdf' },
            size: { type: 'integer', example: 1024000 }
          }
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Error message' },
            error: { type: 'string', example: 'Detailed error information' },
            errors: { 
              type: 'array', 
              items: { 
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  message: { type: 'string' }
                }
              }
            }
          }
        },
        Success: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Operation successful' },
            data: { type: 'object' }
          }
        },
        PaginationInfo: {
          type: 'object',
          properties: {
            currentPage: { type: 'integer', example: 1 },
            totalPages: { type: 'integer', example: 5 },
            totalItems: { type: 'integer', example: 50 },
            itemsPerPage: { type: 'integer', example: 10 }
          }
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ]
  },
  apis: ['./routes/*.js', './controllers/*.js']
};

const specs = swaggerJSDoc(options);

module.exports = specs;