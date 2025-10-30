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
            user_id: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174000' },
            email: { type: 'string', format: 'email', example: 'mosimishak@gmail.com' },
            role: { type: 'string', enum: ['engineer', 'project_manager', 'admin'], example: 'engineer' },
            first_name: { type: 'string', example: 'John' },
            last_name: { type: 'string', example: 'Doe' },
            phone_number: { type: 'string', example: '+1234567890' },
            avatar_url: { type: 'string', example: 'avatar-123.jpg' },
            is_active: { type: 'boolean', example: true },
            is_verified: { type: 'boolean', example: false },
            country: { type: 'string', example: 'USA' },
            city: { type: 'string', example: 'New York' },
            last_login: { type: 'string', format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' }
          }
        },
        Engineer: {
          type: 'object',
          properties: {
            engineer_id: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174001' },
            user_id: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174000' },
            date_of_birth: { type: 'string', format: 'date', example: '1990-01-01' },
            open_to_nearby_cities: { type: 'boolean', example: true },
            languages: { type: 'array', items: { type: 'string' }, example: ['English', 'Spanish'] },
            language_proficiency: { type: 'string', enum: ['basic', 'conversational', 'fluent', 'native'], example: 'fluent' },
            has_drivers_license: { type: 'boolean', example: true },
            has_car: { type: 'boolean', example: true },
            is_native: { type: 'boolean', example: false },
            work_authorized: { type: 'boolean', example: true },
            specialization: { type: 'array', items: { type: 'string' }, example: ['Frontend Development', 'Backend Development'] },
            skill_level: { type: 'string', enum: ['beginner', 'intermediate', 'advanced', 'expert'], example: 'advanced' },
            years_of_experience: { type: 'number', example: 5.5 },
            certifications: { type: 'array', items: { type: 'string' }, example: ['AWS Certified Developer', 'Scrum Master'] },
            project_types: { type: 'array', items: { type: 'string' }, example: ['Web Applications', 'Mobile Apps'] },
            open_to_training: { type: 'boolean', example: true },
            is_freelancer: { type: 'boolean', example: false },
            follows_linkedin: { type: 'boolean', example: true },
            referee_info: { type: 'string', example: 'John Doe, johndoe@email.com' },
            newsletter: { type: 'boolean', example: true },
            special_preferences: { type: 'string', example: 'No weekend work' },
            cv_url: { type: 'string', example: 'https://example.com/cv.pdf' },
            is_vetted: { type: 'boolean', example: false },
            vetted_by: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174002' },
            vetted_at: { type: 'string', format: 'date-time' },
            availability: { type: 'string', enum: ['available', 'busy', 'unavailable'], example: 'available' },
            status: { type: 'string', enum: ['active', 'inactive', 'suspended'], example: 'active' },
            is_onboarded: { type: 'boolean', example: true },
            onboarded_at: { type: 'string', format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' }
          }
        },
        ProjectManager: {
          type: 'object',
          properties: {
            project_managers_id: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174003' },
            user_id: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174000' },
            company: { type: 'string', example: 'Tech Corp Inc.' },
            bio: { type: 'string', example: 'Experienced project manager in tech industry' },
            status: { type: 'string', enum: ['active', 'inactive'], example: 'active' },
            total_projects: { type: 'integer', example: 25 },
            total_hires: { type: 'integer', example: 40 },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' }
          }
        },
        Job: {
          type: 'object',
          properties: {
            jobs_id: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174004' },
            posted_by: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174000' },
            title: { type: 'string', example: 'Senior React Developer' },
            company: { type: 'string', example: 'Tech Solutions Inc.' },
            location: { type: 'string', example: 'Remote' },
            description: { type: 'string', example: 'We are looking for a senior React developer...' },
            employment_type: { type: 'string', enum: ['full-time', 'contract', 'part-time'], example: 'contract' },
            salary: { type: 'string', example: '$80,000 - $120,000' },
            duration: { type: 'string', example: '6 months' },
            openings: { type: 'integer', example: 2 },
            experience_level: { type: 'string', example: 'Senior' },
            skills_required: { type: 'array', items: { type: 'string' }, example: ['React', 'TypeScript', 'Node.js'] },
            requirements: { type: 'array', items: { type: 'string' }, example: ['5+ years React', 'TypeScript'] },
            responsibilities: { type: 'array', items: { type: 'string' }, example: ['Build clean architecture', 'Debug projects'] },
            remote: { type: 'boolean', example: true },
            status: { type: 'string', enum: ['active', 'closed', 'draft'], example: 'active' },
            deadline: { type: 'string', format: 'date-time', example: '2024-12-31T23:59:59Z' },
            applications_count: { type: 'integer', example: 15 },
            posted_at: { type: 'string', format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' }
          }
        },
        Application: {
          type: 'object',
          properties: {
            applications_id: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174005' },
            job_id: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174004' },
            engineer_id: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174000' },
            job_title: { type: 'string', example: 'Senior React Developer' },
            engineer_name: { type: 'string', example: 'John Doe' },
            status: { type: 'string', enum: ['pending', 'reviewed', 'accepted', 'rejected'], example: 'pending' },
            experience: { type: 'string', example: '5 years of React development experience' },
            skills: { type: 'array', items: { type: 'string' }, example: ['React', 'TypeScript', 'Node.js'] },
            reviewed_at: { type: 'string', format: 'date-time' },
            reviewed_by: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174003' },
            feedback: { type: 'string', example: 'Great profile, moving to next round' },
            applied_at: { type: 'string', format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' }
          }
        },
        Project: {
          type: 'object',
          properties: {
            projects_id: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174006' },
            project_managers_user_id: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174000' },
            title: { type: 'string', example: 'E-commerce Website Development' },
            description: { type: 'string', example: 'Building a modern e-commerce platform...' },
            job_id: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174004' },
            engineer_user_id: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174000' },
            status: { type: 'string', enum: ['planning', 'in_progress', 'completed', 'on_hold', 'cancelled'], example: 'in_progress' },
            priority: { type: 'string', enum: ['high', 'medium', 'low', 'critical'], example: 'medium' },
            progress: { type: 'integer', minimum: 0, maximum: 100, example: 65 },
            team: { type: 'array', items: { type: 'string' }, example: ['John Doe', 'Jane Smith'] },
            tasks: { type: 'array', items: { type: 'object' }, example: [{"id": 1, "title": "Setup project", "status": "completed"}] },
            start_date: { type: 'string', format: 'date-time' },
            deadline: { type: 'string', format: 'date-time' },
            feedback: { type: 'string', example: 'Excellent work quality and communication' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' }
          }
        },
        Notification: {
          type: 'object',
          properties: {
            notifications_id: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174007' },
            user_id: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174000' },
            title: { type: 'string', example: 'New Job Application' },
            message: { type: 'string', example: 'You have received a new application for your job posting' },
            type: { type: 'string', enum: ['info', 'success', 'warning'], example: 'info' },
            is_read: { type: 'boolean', example: false },
            read_at: { type: 'string', format: 'date-time' },
            action_url: { type: 'string', example: '/applications/123' },
            metadata: { type: 'object', example: {"application_id": "123e4567-e89b-12d3-a456-426614174005"} },
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