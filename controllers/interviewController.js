const { Op } = require('sequelize');
const path = require('path');
const { Interview, Engineer, ProjectManager, Job, User } = require('../models');
const notificationUtil = require('../utils/notificationUtil'); // assumes sendNotification()
const sendEmail = require('../utils/sendEmail');
const { getRoleKey } = require('../utils/roleUtils');

// helpers
function asJSON(modelInstance) {
  return modelInstance ? modelInstance.toJSON() : null;
}
function ensureRole(user, roles = []) {
  const roleKey = getRoleKey(user);
  return roles.includes(roleKey) || (roleKey === 'super_admin' && roles.includes('admin'));
}

// POST /api/interviews
// PM/Admin schedules an interview for an engineer on a job
// Body: { engineer_id, job_id, date_time, duration?, zoom_link?, phone_number?, notes? }
async function scheduleInterview(req, res) {
  try {
    if (!ensureRole(req.user, ['project_manager', 'admin'])) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const { engineer_id, job_id, date_time, duration = 30, zoom_link, phone_number, notes } = req.body;
    if (!engineer_id || !job_id || !date_time) {
      return res.status(400).json({ success: false, message: 'engineer_id, job_id and date_time are required' });
    }

    // Load entities & derive denorm fields
    const engineer = await Engineer.findOne({ where: { engineer_id }, include: [{ model: User, as: 'user' }] });
    if (!engineer) return res.status(404).json({ success: false, message: 'Engineer not found' });

    const pm = await ProjectManager.findOne({ where: { user_id: req.user.user_id }, include: [{ model: User, as: 'user' }] });
    if (!pm && !['admin', 'super_admin'].includes(getRoleKey(req.user))) {
      return res.status(403).json({ success: false, message: 'Only a PM or Admin can schedule' });
    }

    const job = await Job.findOne({ where: { jobs_id: job_id } });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    // Prevent multiple active interviews for the same engineer & job
    const existingInterview = await Interview.findOne({
      where: {
        candidate_id: engineer.engineer_id,
        job_id,
        status: { [Op.notIn]: ['cancelled', 'completed'] },
      },
    });
    if (existingInterview) {
      return res.status(409).json({
        success: false,
        message: 'An Interview Already exists for this candidate & Job, can you reschedule instead?',
        data: existingInterview,
      });
    }

    const candidate_name  = `${engineer.user?.first_name ?? ''} ${engineer.user?.last_name ?? ''}`.trim();
    const candidate_email = engineer.user?.email;
    const interviewer_id  = pm ? pm.project_managers_id : null;
    const interviewer_email = pm?.user?.email || req.user.email || null;
    const job_title = job.title;
    const pm_name = `${pm?.user?.first_name ?? ''} ${pm?.user?.last_name ?? ''}`.trim() || 'Hiring Team';

    const interview = await Interview.create({
      candidate_id: engineer.engineer_id,
      candidate_name,
      candidate_email,
      interviewer_id: interviewer_id ?? null,
      interviewer_email,
      job_id,
      job_title,
      date_time: new Date(date_time),
      duration,
      phone_number,
      status: 'scheduled',
      zoom_link,
      notes
    });

    // Notifications (best-effort)
    try {
      await notificationUtil.sendNotification({
        user_id: engineer.user_id,
        title: 'Interview Scheduled',
        message: `Your interview for "${job_title}" is scheduled on ${new Date(date_time).toLocaleString()}`,
        type: 'interview',
      data: { interview_id: interview.interviews_id, job_id }
    });
      if (pm) {
        await notificationUtil.sendNotification({
          user_id: pm.user_id,
          title: 'Interview Created',
          message: `Interview with ${candidate_name} for "${job_title}" has been scheduled.`,
          type: 'interview',
          data: { interview_id: interview.interviews_id, job_id }
        });
      }
    } catch (e) {
      // don’t fail the request on notification errors
      console.warn('Notification error(scheduleInterview):', e?.message || e);
    }

    // Email confirmation to engineer (best-effort)
    if (candidate_email) {
      try {
        const htmlFilePath = path.join(__dirname, '../templates/interviewScheduled.html');
        const replacements = {
          engineerName: candidate_name || 'there',
          jobTitle: job_title || 'your role',
          interviewDateTime: new Date(date_time).toLocaleString(),
          duration: `${duration} minutes`,
          zoomLink: zoom_link || 'Will be shared separately',
          phoneNumber: phone_number || 'N/A',
          notes: notes || 'None',
          pmName: pm_name,
        };

        await sendEmail({
          to: candidate_email,
          subject: `Interview Scheduled: ${job_title}`,
          htmlFilePath,
          replacements,
        });
      } catch (emailErr) {
        console.warn('Email error(scheduleInterview):', emailErr?.message || emailErr);
      }
    }

    return res.status(201).json({ success: true, message: 'Interview scheduled', data: interview });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to schedule interview', error: error.message });
  }
}

// GET /api/interviews
// Admin/PM: fetch all interviews (optionally filter by status or date range)
async function getAllInterviews(req, res) {
  try {
    if (!ensureRole(req.user, ['project_manager', 'admin'])) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const { status, from, to } = req.query;
    const where = {};
    if (status) where.status = status;
    if (from || to) {
      where.date_time = {};
      if (from) where.date_time[Op.gte] = new Date(from);
      if (to)   where.date_time[Op.lte] = new Date(to);
    }

    const rows = await Interview.findAll({
      where,
      order: [['date_time', 'DESC']],
      include: [
        { model: Engineer, as: 'candidate', include: [{ model: User, as: 'user' }] },
        { model: ProjectManager, as: 'interviewer', include: [{ model: User, as: 'user' }] },
        { model: Job, as: 'job' },
      ],
    });

    return res.json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch interviews', error: error.message });
  }
}

// GET /api/interviews/:id
// Allowed: Admin, PM, or the assigned Engineer
async function getInterviewById(req, res) {
  try {
    const { interviews_id } = req.params;
    const interview = await Interview.findOne({
      where: { interviews_id: interviews_id },
      include: [
        { model: Engineer, as: 'candidate', include: [{ model: User, as: 'user' }] },
        { model: ProjectManager, as: 'interviewer', include: [{ model: User, as: 'user' }] },
        { model: Job, as: 'job' },
      ],
    });
    if (!interview) return res.status(404).json({ success: false, message: 'Interview not found' });

    // authZ
    const roleKey = getRoleKey(req.user);
    const isAdmin = ['admin', 'super_admin'].includes(roleKey);
    const isPM    = roleKey === 'project_manager' && interview.interviewer_id != null;
    const isEngineer = roleKey === 'engineer' && interview.candidate_id === interview.candidate?.engineer_id && interview.candidate?.user_id === req.user.user_id;
    if (!(isAdmin || isPM || isEngineer)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    return res.json({ success: true, data: interview });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch interview', error: error.message });
  }
}

// GET /api/interviews/me
// For any logged-in user: return interviews where they are PM interviewer or Engineer candidate
async function getMyInterviews(req, res) {
  try {
    if (getRoleKey(req.user) === 'engineer') {
      const eng = await Engineer.findOne({ where: { user_id: req.user.user_id } });
      if (!eng) return res.json({ success: true, data: [] });

      const rows = await Interview.findAll({
        where: { candidate_id: eng.engineer_id },
        order: [['date_time', 'DESC']],
      });
      return res.json({ success: true, data: rows });
    }

    if (getRoleKey(req.user) === 'project_manager') {
      const pm = await ProjectManager.findOne({ where: { user_id: req.user.user_id } });
      if (!pm) return res.json({ success: true, data: [] });

      const rows = await Interview.findAll({
        where: { interviewer_id: pm.project_managers_id },
        order: [['date_time', 'DESC']],
      });
      return res.json({ success: true, data: rows });
    }

    // Admin gets all
    if (['admin', 'super_admin'].includes(getRoleKey(req.user))) {
      const rows = await Interview.findAll({ order: [['date_time', 'DESC']] });
      return res.json({ success: true, data: rows });
    }

    return res.status(403).json({ success: false, message: 'Forbidden' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch interviews', error: error.message });
  }
}

// PATCH /api/interviews/:id
// Update: cancel | reschedule | complete (+ notes/zoom_link/phone_number/duration)
// Rules:
//  - PM/Admin can set any status or reschedule
//  - Engineer can set status to 'completed' or 'cancelled' (their own interview)
async function updateInterview(req, res) {
  try {
    const { interviews_id } = req.params;
    const interview = await Interview.findOne({
      where: { interviews_id: interviews_id },
      include: [
        { model: Engineer, as: 'candidate', include: [{ model: User, as: 'user' }] },
        { model: ProjectManager, as: 'interviewer', include: [{ model: User, as: 'user' }] },
        { model: Job, as: 'job' },
      ]
    });
    if (!interview) return res.status(404).json({ success: false, message: 'Interview not found' });

    const isAdmin = ['admin', 'super_admin'].includes(getRoleKey(req.user));
    const pm = await ProjectManager.findOne({ where: { user_id: req.user.user_id } });
    const isPM = getRoleKey(req.user) === 'project_manager' && pm && interview.interviewer_id === pm.project_managers_id;

    const eng = await Engineer.findOne({ where: { user_id: req.user.user_id } });
    const isEngineer = getRoleKey(req.user) === 'engineer' && eng && interview.candidate_id === eng.engineer_id;

    const { status, date_time, duration, zoom_link, phone_number, notes } = req.body;
    const wasRescheduled = date_time !== undefined || status === 'rescheduled';

    // Authorization matrix
    if (isEngineer) {
      // engineers can only mark their own interview as completed/cancelled; cannot reschedule date_time
      if (status && !['completed', 'cancelled'].includes(status)) {
        return res.status(403).json({ success: false, message: 'Engineers can only cancel, contact a PM or your interviewer with Date and time you like to recschedule to via email' });
      }
      if (date_time) {
        return res.status(403).json({ success: false, message: 'Engineers cannot reschedule date/time' });
      }
    } else if (!(isPM || isAdmin)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const updates = {};
    if (status) updates.status = status;
    if (date_time) updates.date_time = new Date(date_time);
    if (duration !== undefined) updates.duration = Number(duration);
    if (zoom_link !== undefined) updates.zoom_link = zoom_link;
    if (phone_number !== undefined) updates.phone_number = phone_number;
    if (notes !== undefined) updates.notes = notes;

    await interview.update(updates);

    // Notifications
    try {
      const payload = {
        user_id: interview.engineer?.user_id,
        title: 'Interview Updated',
        message: `Interview ${status ? `status: ${status}. ` : ''}${date_time ? `Rescheduled to ${new Date(date_time).toLocaleString()}.` : ''}`.trim(),
        type: 'interview',
        data: { interview_id: interview.interviews_id }
      };
      if (payload.user_id) await notificationUtil.sendNotification(payload);

      // notify PM too
      if (interview.project_manager?.user_id) {
        await notificationUtil.sendNotification({
          user_id: interview.project_manager.user_id,
          title: 'Interview Updated',
          message: `An interview was updated (status: ${interview.status}).`,
          type: 'interview',
          data: { interview_id: interview.interviews_id }
        });
      }

      // Email on reschedule (best-effort)
      if (wasRescheduled && interview.candidate?.user?.email) {
        const htmlFilePath = path.join(__dirname, '../templates/interviewScheduled.html');
        const pmName = `${interview.interviewer?.user?.first_name ?? ''} ${interview.interviewer?.user?.last_name ?? ''}`.trim() || 'Hiring Team';
        const replacements = {
          engineerName: `${interview.candidate?.user?.first_name ?? ''} ${interview.candidate?.user?.last_name ?? ''}`.trim() || 'there',
          jobTitle: interview.job?.title || interview.job_title || 'your role',
          interviewDateTime: new Date(interview.date_time).toLocaleString(),
          duration: `${interview.duration ?? duration ?? 30} minutes`,
          zoomLink: interview.zoom_link || zoom_link || 'Will be shared separately',
          phoneNumber: interview.phone_number || phone_number || 'N/A',
          notes: interview.notes || notes || 'None',
          pmName,
        };
        await sendEmail({
          to: interview.candidate.user.email,
          subject: `Interview Rescheduled: ${replacements.jobTitle}`,
          htmlFilePath,
          replacements,
        });
      }
    } catch (e) {
      console.warn('Notification error(updateInterview):', e?.message || e);
    }

    return res.json({ success: true, message: 'Interview updated', data: interview });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update interview', error: error.message });
  }
}

module.exports = {
  scheduleInterview,
  getAllInterviews,
  getInterviewById,
  getMyInterviews,
  updateInterview,
};
