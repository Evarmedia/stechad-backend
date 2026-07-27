const { User, Engineer, ProjectManager, Job, Application, Project } = require('../models');
const { Op } = require('sequelize');

// Export engineers data
const exportEngineers = async (req, res) => {
  try {
    const {
      format = 'json',
      fields,
      is_vetted,
      availability,
      date_from,
      date_to
    } = req.query;

    let where = {};
    let userWhere = {};

    // Apply filters
    if (is_vetted !== undefined) {
      where.is_vetted = is_vetted === 'true';
    }

    if (availability) {
      where.availability = availability;
    }

    if (date_from || date_to) {
      const dateFilter = {};
      if (date_from) dateFilter[Op.gte] = new Date(date_from);
      if (date_to) dateFilter[Op.lte] = new Date(date_to);
      userWhere.created_at = dateFilter;
    }

    // Define which fields to include
    let engineerAttributes = [
      'engineer_id', 'specialization', 'skill_level', 'years_of_experience',
      'certifications', 'project_types', 'availability', 'is_vetted', 'created_at'
    ];

    let userAttributes = [
      'user_id', 'email', 'first_name', 'last_name', 'phone_number',
      'city', 'country', 'is_verified', 'created_at'
    ];

    if (fields) {
      const requestedFields = fields?.split(',').map(field => field.trim());
      engineerAttributes = engineerAttributes.filter(attr => 
        requestedFields.includes(attr) || requestedFields.includes('*')
      );
      userAttributes = userAttributes.filter(attr => 
        requestedFields.includes(attr) || requestedFields.includes('*')
      );
    }

    const engineers = await Engineer.findAll({
      where,
      attributes: engineerAttributes,
      include: [{
        model: User,
        as: 'user',
        where: userWhere,
        attributes: userAttributes
      }],
      order: [['created_at', 'DESC']]
    });

    // Format data for export
    const exportData = engineers.map(engineer => {
      const data = {
        ...engineer.toJSON(),
        ...engineer.user.toJSON()
      };
      delete data.user;
      return data;
    });

    if (format === 'csv') {
      // Convert to CSV format
      if (exportData.length === 0) {
        return res.status(200).send('No data to export');
      }

      const headers = Object.keys(exportData[0]);
      const csvContent = [
        headers.join(','),
        ...exportData.map(row => 
          headers.map(header => {
            const value = row[header];
            if (Array.isArray(value)) {
              return `"${value.join('; ')}"`;
            }
            return `"${value || ''}"`;
          }).join(',')
        )
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=engineers.csv');
      return res.send(csvContent);
    }

    res.json({
      success: true,
      data: exportData,
      count: exportData.length,
      exported_at: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Export failed',
      error: error.message
    });
  }
};

// Export jobs data
const exportJobs = async (req, res) => {
  try {
    const {
      format = 'json',
      fields,
      status,
      posted_by,
      date_from,
      date_to
    } = req.query;

    let where = {};

    // Apply filters
    if (status) {
      where.status = status;
    }

    if (posted_by) {
      where.posted_by = posted_by;
    }

    if (date_from || date_to) {
      const dateFilter = {};
      if (date_from) dateFilter[Op.gte] = new Date(date_from);
      if (date_to) dateFilter[Op.lte] = new Date(date_to);
      where.posted_at = dateFilter;
    }

    // Define which fields to include
    let jobAttributes = [
      'jobs_id', 'title', 'company', 'location', 'description',
      'employment_type', 'salary', 'duration', 'openings',
      'experience_level', 'skills_required', 'requirements',
      'responsibilities', 'status', 'applications_count',
      'posted_at', 'deadline'
    ];

    if (fields) {
      const requestedFields = fields?.split(',').map(field => field.trim());
      jobAttributes = jobAttributes.filter(attr => 
        requestedFields.includes(attr) || requestedFields.includes('*')
      );
    }

    const jobs = await Job.findAll({
      where,
      attributes: jobAttributes,
      include: [{
        model: User,
        as: 'poster',
        attributes: ['first_name', 'last_name', 'email'],
        include: [{
          model: ProjectManager,
          as: 'project_manager',
          attributes: ['company']
        }]
      }],
      order: [['posted_at', 'DESC']]
    });

    // Format data for export
    const exportData = jobs.map(job => {
      const data = job.toJSON();
      data.poster_name = `${data.poster.first_name} ${data.poster.last_name}`;
      data.poster_email = data.poster.email;
      data.poster_company = data.poster.project_manager?.company || '';
      delete data.poster;
      return data;
    });

    if (format === 'csv') {
      if (exportData.length === 0) {
        return res.status(200).send('No data to export');
      }

      const headers = Object.keys(exportData[0]);
      const csvContent = [
        headers.join(','),
        ...exportData.map(row => 
          headers.map(header => {
            const value = row[header];
            if (Array.isArray(value)) {
              return `"${value.join('; ')}"`;
            }
            return `"${value || ''}"`;
          }).join(',')
        )
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=jobs.csv');
      return res.send(csvContent);
    }

    res.json({
      success: true,
      data: exportData,
      count: exportData.length,
      exported_at: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Export failed',
      error: error.message
    });
  }
};

// Export applications data
const exportApplications = async (req, res) => {
  try {
    const {
      format = 'json',
      fields,
      status,
      job_id,
      engineer_id,
      date_from,
      date_to
    } = req.query;

    let where = {};

    // Apply filters
    if (status) {
      where.status = status;
    }

    if (job_id) {
      where.job_id = job_id;
    }

    if (engineer_id) {
      where.engineer_id = engineer_id;
    }

    if (date_from || date_to) {
      const dateFilter = {};
      if (date_from) dateFilter[Op.gte] = new Date(date_from);
      if (date_to) dateFilter[Op.lte] = new Date(date_to);
      where.applied_at = dateFilter;
    }

    // Define which fields to include
    let applicationAttributes = [
      'applications_id', 'job_title', 'engineer_name', 'status',
      'experience', 'skills', 'feedback', 'applied_at', 'reviewed_at'
    ];

    if (fields) {
      const requestedFields = fields?.split(',').map(field => field.trim());
      applicationAttributes = applicationAttributes.filter(attr => 
        requestedFields.includes(attr) || requestedFields.includes('*')
      );
    }

    const applications = await Application.findAll({
      where,
      attributes: applicationAttributes,
      include: [
        {
          model: Job,
          as: 'job',
          attributes: ['title', 'company', 'location']
        },
        {
          model: User,
          as: 'applicant',
          attributes: ['first_name', 'last_name', 'email'],
          include: [{
            model: Engineer,
            as: 'engineer',
            attributes: ['specialization', 'years_of_experience']
          }]
        }
      ],
      order: [['applied_at', 'DESC']]
    });

    // Format data for export
    const exportData = applications.map(application => {
      const data = application.toJSON();
      data.job_company = data.job.company;
      data.job_location = data.job.location;
      data.applicant_name = `${data.applicant.first_name} ${data.applicant.last_name}`;
      data.applicant_email = data.applicant.email;
      data.applicant_specialization = data.applicant.engineer?.specialization?.join(', ') || '';
      data.applicant_experience = data.applicant.engineer?.years_of_experience || 0;
      delete data.job;
      delete data.applicant;
      return data;
    });

    if (format === 'csv') {
      if (exportData.length === 0) {
        return res.status(200).send('No data to export');
      }

      const headers = Object.keys(exportData[0]);
      const csvContent = [
        headers.join(','),
        ...exportData.map(row => 
          headers.map(header => {
            const value = row[header];
            if (Array.isArray(value)) {
              return `"${value.join('; ')}"`;
            }
            return `"${value || ''}"`;
          }).join(',')
        )
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=applications.csv');
      return res.send(csvContent);
    }

    res.json({
      success: true,
      data: exportData,
      count: exportData.length,
      exported_at: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Export failed',
      error: error.message
    });
  }
};

module.exports = {
  exportEngineers,
  exportJobs,
  exportApplications
};