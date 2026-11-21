const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = process.env.TENANCY_TEST_DATABASE_URL;
if (!url) test('recruitment HTTP/PostgreSQL seam (set TENANCY_TEST_DATABASE_URL)', { skip: true }, () => {});
else {
  const { Sequelize } = require('sequelize');
  const schema = `recruitment_${randomUUID().replaceAll('-', '')}`;
  const db = new Sequelize(url, { schema, logging: false, pool: { max: 8 } }); db.schema = schema;
  db.afterDefine((model) => { model.options.schema = schema; });
  const config = require.resolve('../config/database'); require.cache[config] = { id: config, filename: config, loaded: true, exports: db };
  const mail = require.resolve('../utils/sendEmail'); require.cache[mail] = { id: mail, filename: mail, loaded: true, exports: async () => {} };
  const models = require('../models');
  let server, origin, orgA, orgB, activeA, draftA, activeB, shared, talentUser, pmUser, otherPmUser, bOnly, talentA, talentB, pmA, pmB, otherPm, rewardA, rewardB;
  const profiles = {};
  before(async () => {
    await db.createSchema(schema); await db.sync();
    orgA = await models.Organization.create({ slug: 'stechad', name: 'Stechad' });
    orgB = await models.Organization.create({ slug: 'company-b', name: 'Company B' });
    const roles = {};
    for (const [org, key] of [[orgA, 'a'], [orgB, 'b']]) {
      roles[key] = {};
      for (const role_key of ['admin', 'staff', 'talent', 'project_manager']) roles[key][role_key] = await models.Role.create({ role_key, name: role_key, organization_id: org.organization_id, is_system: true });
    }
    async function identity(label, role = 'staff') { return models.User.create({ email: `${label}@example.test`, first_name: label, role_id: roles.a[role].role_id }); }
    shared = await identity('shared', 'admin'); talentUser = await identity('talent', 'talent'); pmUser = await identity('pm', 'project_manager'); otherPmUser = await identity('other-pm', 'project_manager');
    for (const [org, key] of [[orgA, 'a'], [orgB, 'b']]) for (const [user, role] of [[shared, key === 'a' ? 'admin' : 'staff'], [talentUser, 'talent'], [pmUser, 'project_manager'], [otherPmUser, key === 'a' ? 'project_manager' : 'admin']]) {
      const membership = await models.OrganizationMembership.create({ organization_id: org.organization_id, user_id: user.user_id });
      profiles[`${key}:${user.user_id}`] = await models.HRProfile.create({ organization_id: org.organization_id, membership_id: membership.membership_id, user_id: user.user_id, role_id: roles[key][role].role_id, reward: 0, workforce_permissions: user === shared && key === 'b' ? ['create_projects'] : [] });
    }
    bOnly = await identity('b-only');
    const bMembership = await models.OrganizationMembership.create({ organization_id: orgB.organization_id, user_id: bOnly.user_id });
    await models.HRProfile.create({ organization_id: orgB.organization_id, membership_id: bMembership.membership_id, user_id: bOnly.user_id, role_id: roles.b.staff.role_id });
    talentA = await models.Talent.create({ organization_id: orgA.organization_id, user_id: talentUser.user_id, is_onboarded: true });
    talentB = await models.Talent.create({ organization_id: orgB.organization_id, user_id: talentUser.user_id, is_onboarded: true });
    pmA = await models.ProjectManager.create({ organization_id: orgA.organization_id, user_id: pmUser.user_id });
    pmB = await models.ProjectManager.create({ organization_id: orgB.organization_id, user_id: pmUser.user_id });
    otherPm = await models.ProjectManager.create({ organization_id: orgA.organization_id, user_id: otherPmUser.user_id });
    const job = { title: 'Published role', company: 'A', location: 'Remote', description: 'Public description' };
    activeA = await models.Job.create({ ...job, organization_id: orgA.organization_id, posted_by: pmUser.user_id });
    draftA = await models.Job.create({ ...job, title: 'Secret draft', status: 'draft', organization_id: orgA.organization_id });
    activeB = await models.Job.create({ ...job, title: 'B role', organization_id: orgB.organization_id });
    for (const [org, key, amount] of [[orgA, 'a', 12.5], [orgB, 'b', 80]]) {
      const reward = await models.Reward.create({ organization_id: org.organization_id, reward_type: 'bonus', reward_amount: amount });
      const row = await models.UserReward.create({ organization_id: org.organization_id, user_id: shared.user_id, reward_id: reward.reward_id, reward_amount: amount, reward_status: 'approved' });
      if (key === 'a') rewardA = row; else rewardB = row;
    }
    await models.Referral.create({ organization_id: orgA.organization_id, referrer_id: shared.user_id, referee_id: talentUser.user_id, referral_code: 'A-CODE', status: 'completed' });
    await models.Referral.create({ organization_id: orgB.organization_id, referrer_id: shared.user_id, referee_id: pmUser.user_id, referral_code: 'B-CODE', status: 'completed' });
    await models.Referral.create({ organization_id: orgB.organization_id, referrer_id: shared.user_id, referee_id: bOnly.user_id, referral_code: 'B-CODE', status: 'pending' });
    const express = require('express'); const app = express(); app.use(express.json());
    app.use('/jobs', require('../routes/jobsRoutes'));
    for (const [prefix, name] of [['projects', 'project'], ['talents', 'talent'], ['interviews', 'interview'], ['applications', 'application'], ['referrals', 'referral'], ['pm', 'pm']]) app.use(`/${prefix}`, require(`../routes/${name}Routes`));
    server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); await db.dropSchema(schema, { cascade: true }); await db.close(); });
  const request = async (path, options = {}) => { const res = await fetch(origin + path, options); return { status: res.status, ...await res.json() }; };
  const privateRequest = (path, org = orgA, user = shared, method = 'GET', body) => request(path, { method, headers: { 'content-type': 'application/json', 'x-organization-id': org.organization_id, authorization: `Bearer ${require('jsonwebtoken').sign({ user_id: user.user_id, session_version: user.session_version }, process.env.JWT_SECRET)}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  test('public jobs select one organization, hide drafts and whitelist published fields', async () => {
    const a = await request('/jobs?status=draft');
    assert.equal(a.status, 200);
    assert.deepEqual(a.data.jobs.map((j) => j.jobs_id), [activeA.jobs_id]);
    assert.equal(a.data.pagination.totalItems, 1);
    for (const field of ['organization_id', 'posted_by', 'poster', 'applications', 'applications_count']) assert.equal(field in a.data.jobs[0], false, field);
    assert.equal((await request(`/jobs/${draftA.jobs_id}`)).status, 404);
    assert.equal((await request(`/jobs/${activeB.jobs_id}`)).status, 404);
    assert.equal((await request(`/jobs/${activeA.jobs_id}`)).data.poster, undefined);
    const b = await request('/jobs?organization_slug=company-b');
    assert.deepEqual(b.data.jobs.map((j) => j.jobs_id), [activeB.jobs_id]);
    assert.equal((await request('/jobs?organization_slug=missing')).status, 404);
  });
  test('HR project CRUD, counts, assignments and talent access stay in the selected organization', async () => {
    const a = await privateRequest('/projects', orgA, shared, 'POST', { title: 'A project', project_managers_id: pmA.project_managers_id, talent_ids: [talentA.talent_id], organization_id: orgB.organization_id });
    assert.equal(a.status, 201, JSON.stringify(a));
    assert.equal(a.data.organization_id, orgA.organization_id);
    const id = a.data.projects_id;
    assert.equal((await privateRequest(`/projects/${id}`, orgB)).status, 404);
    assert.equal((await privateRequest('/projects', orgA, shared, 'POST', { title: 'Foreign talent', talent_ids: [talentB.talent_id] })).status, 400);
    assert.equal((await privateRequest('/projects', orgA, shared, 'POST', { title: 'Foreign manager', project_managers_id: pmB.project_managers_id })).status, 400);
    assert.equal((await privateRequest('/projects', orgA, shared, 'POST', { title: 'Foreign team', team: [bOnly.user_id] })).status, 400);
    assert.equal((await privateRequest(`/projects/${id}`, orgA, shared, 'PUT', { tasks: [{ title: 'Foreign assignee', assignee: bOnly.user_id }] })).status, 400);
    assert.equal((await privateRequest(`/projects/${id}`, orgA, shared, 'PUT', { talent_ids: [talentB.talent_id] })).status, 400);
    const [aList, bList] = await Promise.all([privateRequest('/projects?page=1&limit=10', orgA), privateRequest('/projects?page=1&limit=10', orgB)]);
    assert.equal(aList.data.pagination.totalItems, 1, JSON.stringify(aList));
    assert.equal(bList.data.pagination.totalItems, 0, JSON.stringify(bList));
    assert.equal((await privateRequest('/projects/stats/overview', orgA)).data.overview.totalProjects, 1);
    assert.equal((await privateRequest(`/talents/projects/${id}`, orgA, talentUser)).status, 200);
    assert.equal((await privateRequest(`/talents/projects/${id}`, orgB, talentUser)).status, 404);
    assert.equal((await privateRequest(`/projects/${id}`, orgA, otherPmUser, 'PUT', { title: 'Forbidden' })).status, 403);
    assert.equal((await privateRequest(`/projects/${id}`, orgA, shared, 'PUT', { title: 'Renamed' })).data.title, 'Renamed');
    assert.equal((await privateRequest(`/projects/${id}`, orgA, shared, 'DELETE')).status, 200);
  });
  test('job creation, management, deletion and private counts retain the PM resource boundary', async () => {
    const created = await privateRequest('/pm/jobs', orgA, pmUser, 'POST', { title: 'New job', company: 'A', location: 'Remote', description: 'Description', employment_type: 'contract', openings: 1, experience_level: 'expert', skills_required: ['Engineering'], requirements: ['Experience'], responsibilities: ['Delivery'], organization_id: orgB.organization_id, posted_by: otherPmUser.user_id });
    assert.equal(created.status, 201, JSON.stringify(created));
    assert.equal(created.data.organization_id, orgA.organization_id); assert.equal(created.data.posted_by, pmUser.user_id);
    const id = created.data.jobs_id;
    const [a, b] = await Promise.all([privateRequest('/pm/jobs', orgA, pmUser), privateRequest('/pm/jobs', orgB, pmUser)]);
    assert.equal(a.data.pagination.totalItems, 2); assert.equal(b.data.pagination.totalItems, 0);
    assert.equal((await privateRequest('/jobs/stats/overview', orgA)).data.overview.totalJobs, 3);
    assert.equal((await privateRequest('/jobs/stats/overview', orgB, pmUser)).data.overview.totalJobs, 1);
    assert.equal((await privateRequest(`/jobs/update/${id}`, orgB, pmUser, 'PUT', { title: 'Foreign update' })).status, 404);
    assert.equal((await privateRequest(`/jobs/${id}`, orgA, otherPmUser, 'DELETE')).status, 403);
    assert.equal((await privateRequest(`/jobs/update/${id}`, orgA, pmUser, 'PUT', { title: 'Updated job' })).data.title, 'Updated job');
    assert.equal((await privateRequest(`/jobs/${id}`, orgA, pmUser, 'DELETE')).status, 200);
    assert.equal((await privateRequest('/jobs/stats/overview', orgA)).data.overview.totalJobs, 2);
  });
  test('talent onboarding and nested profile lists preserve independent tenant profiles', async () => {
    const changed = await privateRequest('/talents/onboarding', orgA, talentUser, 'PUT', { years_of_experience: '8', specialization: ['A-private'], organization_id: orgB.organization_id });
    assert.equal(changed.status, 200, JSON.stringify(changed));
    const [a, b] = await Promise.all([privateRequest('/talents/all?page=1&limit=10', orgA), privateRequest('/talents/all?page=1&limit=10', orgB, pmUser)]);
    assert.equal(a.status, 200, JSON.stringify(a)); assert.equal(b.status, 200, JSON.stringify(b));
    assert.equal(a.data.pagination.totalItems, 1); assert.equal(b.data.pagination.totalItems, 1);
    assert.equal(a.data.talents[0].talent_id, talentA.talent_id); assert.equal(b.data.talents[0].talent_id, talentB.talent_id);
    assert.deepEqual(a.data.talents[0].specialization, ['A-private']); assert.deepEqual(b.data.talents[0].specialization, []);
    assert.equal(a.data.talents[0].user.user_id, talentUser.user_id); assert.equal(b.data.talents[0].user.user_id, talentUser.user_id);
  });
  test('applications and interview participants are private and foreign assignments fail', async () => {
    assert.equal((await privateRequest(`/talents/jobs/${activeA.jobs_id}/apply`, orgB, talentUser, 'POST', {})).status, 404);
    const applied = await privateRequest(`/talents/jobs/${activeA.jobs_id}/apply`, orgA, talentUser, 'POST', {});
    assert.equal(applied.status, 201, JSON.stringify(applied));
    const applicationId = applied.data.applications_id;
    assert.equal((await privateRequest(`/applications/${applicationId}`, orgA)).status, 200);
    assert.equal((await privateRequest(`/applications/${applicationId}`, orgB)).status, 404);
    assert.equal((await privateRequest(`/applications/${applicationId}`, orgB, pmUser)).status, 404);
    assert.equal((await privateRequest('/applications/stats/overview', orgA)).data.overview.totalApplications, 1);
    assert.equal((await privateRequest('/applications', orgB)).status, 403);
    assert.equal((await privateRequest(`/jobs/${activeA.jobs_id}/applicants`, orgA, otherPmUser)).status, 403);
    assert.equal((await privateRequest(`/jobs/update/${activeA.jobs_id}`, orgA, otherPmUser, 'PUT', { title: 'Forbidden' })).status, 403);
    assert.equal((await privateRequest('/interviews', orgA, shared, 'POST', { talent_id: talentB.talent_id, job_id: activeA.jobs_id, date_time: '2026-12-10T12:00:00Z' })).status, 404);
    assert.equal((await privateRequest('/interviews', orgA, shared, 'POST', { talent_id: talentA.talent_id, job_id: activeB.jobs_id, date_time: '2026-12-10T12:00:00Z' })).status, 404);
    const interview = await privateRequest('/interviews', orgA, pmUser, 'POST', { talent_id: talentA.talent_id, job_id: activeA.jobs_id, date_time: '2026-12-10T12:00:00Z' });
    assert.equal(interview.status, 201, JSON.stringify(interview));
    const id = interview.data.interviews_id;
    assert.equal((await privateRequest(`/interviews/${id}`, orgB, talentUser)).status, 404);
    assert.equal((await privateRequest(`/interviews/${id}`, orgA, otherPmUser)).status, 403);
    assert.equal((await privateRequest(`/interviews/${id}`, orgA, talentUser)).status, 200);
    assert.equal((await privateRequest(`/interviews/${id}`, orgA, otherPmUser, 'PATCH', { status: 'cancelled' })).status, 403);
    assert.equal((await privateRequest(`/interviews/${id}`, orgA, talentUser, 'PATCH', { status: 'cancelled' })).status, 200);
    const history = await privateRequest('/talents/applications', orgB, talentUser);
    assert.equal(history.data.applications.length, 0, JSON.stringify(history));
  });
  test('concurrent reward claims credit once and leave the other organization ledger and balance intact', async () => {
    const result = await Promise.all([privateRequest('/referrals/rewards/claim'), privateRequest('/referrals/rewards/claim')]);
    assert.deepEqual(result.map((r) => r.status).sort(), [200, 404], JSON.stringify(result));
    const aHistory = await privateRequest('/referrals/rewards');
    const bHistory = await privateRequest('/referrals/rewards', orgB);
    assert.equal(aHistory.data.rewards[0].reward_status, 'claimed');
    assert.equal(bHistory.data.rewards[0].reward_status, 'approved');
    assert.equal(aHistory.data.pagination.totalItems, 1);
    assert.equal(bHistory.data.pagination.totalItems, 1);
    // The profile is exposed through the existing authenticated HR profile seam.
    const aProfile = await privateRequest('/referrals/dashboard');
    assert.equal(Number(aProfile.data.reward_balance), 12.5, JSON.stringify(aProfile));
    const bProfile = await privateRequest('/referrals/dashboard', orgB);
    assert.equal(Number(bProfile.data.reward_balance), 0);
  });
  test('referral grouped leaderboards, sums and nested HR roles use the selected organization', async () => {
    const [a, b] = await Promise.all([privateRequest('/referrals/leaderboard'), privateRequest('/referrals/leaderboard', orgB, otherPmUser)]);
    assert.equal(a.status, 200, JSON.stringify(a)); assert.equal(b.status, 200, JSON.stringify(b));
    assert.equal(Number(a.data.leaderboard[0].total_referrals), 1); assert.equal(Number(b.data.leaderboard[0].total_referrals), 2);
    assert.equal(a.data.leaderboard[0].referrer.role, 'admin'); assert.equal(b.data.leaderboard[0].referrer.role, 'staff');
    const [aStats, bStats] = await Promise.all([privateRequest('/referrals/analytics'), privateRequest('/referrals/analytics', orgB, otherPmUser)]);
    assert.equal(aStats.status, 200, JSON.stringify(aStats)); assert.equal(bStats.status, 200, JSON.stringify(bStats));
    assert.equal(aStats.data.total_referrals, 1); assert.equal(bStats.data.total_referrals, 2);
    assert.equal(Number(aStats.data.total_rewards_claimed), 12.5); assert.equal(Number(bStats.data.total_rewards_claimed), 0);
  });
  test('a real balance write failure rolls back the claim ledger', async () => {
    await profiles[`b:${shared.user_id}`].update({ reward: '99999999.99' });
    const failed = await privateRequest('/referrals/rewards/claim', orgB);
    assert.equal(failed.status, 500, JSON.stringify(failed));
    const history = await privateRequest('/referrals/rewards', orgB);
    assert.equal(history.data.rewards[0].reward_status, 'approved');
    assert.equal(history.data.rewards[0].claimed_at, null);
    const profile = await privateRequest('/referrals/dashboard', orgB);
    assert.equal(Number(profile.data.reward_balance), 99999999.99);
    assert.equal(Number((await privateRequest('/referrals/dashboard')).data.reward_balance), 12.5);
  });
}
