const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const url = process.env.SESSIONS_TEST_DATABASE_URL;
if (!url) test('managed session HTTP/PostgreSQL regressions', { skip: true }, () => {});
else {
  const { Sequelize } = require('sequelize');
  const schema = `sessions_${randomUUID().replaceAll('-', '')}`;
  const db = new Sequelize(url, { logging: false, schema }); db.schema = schema;
  db.afterDefine(model => { model.options.schema = schema; });
  const path = require.resolve('../config/database'); require.cache[path] = { id: path, filename: path, loaded: true, exports: db };
  process.env.GOOGLE_CLIENT_ID = 'test-client'; process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.JWT_SECRET = 'test-access'; process.env.JWT_REFRESH_SECRET = 'test-refresh'; process.env.AUTH_SESSIONS_ENFORCED = 'true';
  const { User, Role } = require('../models');
  let server, realtime, origin, user;
  const request = async (path, body, token, method = 'POST') => {
    const res = await fetch(`${origin}/api/auth/${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, ...await res.json() };
  };
  const login = () => request('login', { email: user.email, password: 'password6' });
  before(async () => {
    await db.createSchema(schema); await db.sync();
    await require('../migrations/20261122100000-managed-auth-sessions').up(db.getQueryInterface(), Sequelize);
    const role = await Role.create({ role_key: 'staff', name: 'Staff', is_system: true });
    user = await User.create({ email: 'sessions@example.com', password: 'password6', role_id: role.role_id, is_verified: true });
    const app = require('express')(); app.use(require('express').json()); app.use('/api/auth', require('../routes/authRoutes'));
    server = require('node:http').createServer(app); realtime = new (require('socket.io').Server)(server);
    require('../utils/events').setRealtime(realtime); require('../utils/chatSocket').initializeChatSocket(realtime);
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { if (realtime) await new Promise(resolve => realtime.close(resolve)); require('../utils/events').setRealtime(null); try { await db.dropSchema(schema, { cascade: true }); } finally { await db.close(); } });
  test('sign in creates a revocable device session while preserving the global identity response', async () => {
    const signed = await login(); assert.equal(signed.status, 200); assert.equal(signed.data.user.user_id, user.user_id);
    assert.ok(signed.data.session.session_id);
    const listed = await request('sessions', undefined, signed.data.token, 'GET');
    assert.equal(listed.status, 200); assert.equal(listed.data.current_session_id, signed.data.session.session_id);
    assert.equal(listed.data.sessions.filter(s => s.current).length, 1);
    assert.equal(JSON.stringify(listed).includes('token_hash'), false);
    assert.equal((await request('logout', {}, signed.data.token)).status, 200);
    assert.equal((await request('me', undefined, signed.data.token, 'GET')).status, 401);
  });
  test('concurrent refresh has one winner and replay revokes only the affected device', async () => {
    const a = await login(), b = await login();
    const rotated = await Promise.all([request('refresh-token', { refresh_token: a.data.refreshToken }), request('refresh-token', { refresh_token: a.data.refreshToken })]);
    assert.deepEqual(rotated.map(r => r.status).sort(), [200, 409]);
    const loser = rotated.find(r => r.status === 409); assert.equal(loser.code, 'REFRESH_ALREADY_ROTATED'); assert.equal(loser.data, undefined);
    const winner = rotated.find(r => r.status === 200);
    assert.equal((await request('me', undefined, winner.data.token, 'GET')).status, 200);
    process.env.AUTH_REFRESH_RACE_MS = '10'; await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal((await request('refresh-token', { refresh_token: a.data.refreshToken })).status, 401);
    delete process.env.AUTH_REFRESH_RACE_MS;
    assert.equal((await request('me', undefined, winner.data.token, 'GET')).status, 401);
    assert.equal((await request('me', undefined, b.data.token, 'GET')).status, 200);
    assert.equal((await request('logout-all', {}, b.data.token)).status, 200);
    assert.equal((await request('me', undefined, b.data.token, 'GET')).status, 401);
  });
  test('refresh proof revokes a rotating device without issuing credentials or touching another device', async () => {
    const a = await login(), b = await login();
    const results = await Promise.all([
      request('refresh-token', { refresh_token: a.data.refreshToken }),
      request('logout', { refresh_token: a.data.refreshToken }),
    ]);
    assert.equal(results[1].status, 200);
    assert.equal(results[1].data?.token, undefined);
    if (results[0].status === 200) assert.equal((await request('me', undefined, results[0].data.token, 'GET')).status, 401);
    else assert.equal(results[0].status, 401);
    assert.equal((await request('me', undefined, b.data.token, 'GET')).status, 200);
    const listed = await request('sessions', undefined, b.data.token, 'GET');
    assert.ok(listed.data.sessions.find(s => s.session_id === a.data.session.session_id).revoked_at);
  });
  test('logout-all accepts a just-rotated refresh proof but rejects old, expired and invalidated proofs', async () => {
    const a = await login(), b = await login();
    const [winner, ended] = await Promise.all([request('refresh-token', { refresh_token: a.data.refreshToken }), request('logout-all', { refresh_token: a.data.refreshToken })]);
    assert.ok([200,401].includes(winner.status));
    assert.equal(ended.status, 200); assert.equal(ended.data.token, undefined);
    assert.equal((await request('me', undefined, b.data.token, 'GET')).status, 401);
    const old = await login(); const replacement = await request('refresh-token', { refresh_token: old.data.refreshToken });
    process.env.AUTH_REFRESH_RACE_MS = '10'; await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal((await request('logout', { refresh_token: old.data.refreshToken })).status, 401);
    delete process.env.AUTH_REFRESH_RACE_MS;
    assert.equal((await request('me', undefined, replacement.data.token, 'GET')).status, 200);
    const expired = await login();
    await require('../models').AuthRefreshToken.update({ expires_at: new Date(Date.now() - 1000) }, { where: { session_id: expired.data.session.session_id } });
    assert.equal((await request('logout-all', { refresh_token: expired.data.refreshToken })).status, 401);
    const expiredSession = await login();
    await require('../models').AuthSession.update({ expires_at: new Date(Date.now() - 1000) }, { where: { session_id: expiredSession.data.session.session_id } });
    assert.equal((await request('logout', { refresh_token: expiredSession.data.refreshToken })).status, 401);
    const inactive = await login(); await user.reload(); await user.update({ is_active: false });
    assert.equal((await request('logout', { refresh_token: inactive.data.refreshToken })).status, 401);
    await user.update({ is_active: true, session_version: user.session_version + 1 });
    assert.equal((await request('logout', { refresh_token: inactive.data.refreshToken })).status, 401);
    assert.equal((await request('logout', { refresh_token: 'unknown-proof' })).status, 401);
  });

  test('password recovery consumes its code once transactionally and invalidates existing sessions', async () => {
    const first = await login();
    await user.update({ reset_password_token: 'reset-one-use', reset_password_expires: new Date(Date.now() + 60000) });
    const responses = await Promise.all(['new-pass-111', 'new-pass-222'].map(password => request('reset-password', { otp: 'reset-one-use', new_password: password, confirm_password: password })));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
    assert.equal((await request('me', undefined, first.data.token, 'GET')).status, 401);
    // Restore the fixture password through the same public password-reset flow.
    await user.reload(); await user.update({ reset_password_token: 'reset-restore', reset_password_expires: new Date(Date.now() + 60000) });
    assert.equal((await request('reset-password', { otp: 'reset-restore', new_password: 'password6', confirm_password: 'password6' })).status, 200);
  });

  test('Google callback is browser-state-bound and exchanges its code once with PKCE', async () => {
    const crypto = require('node:crypto'); const verifier = 'v'.repeat(64);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const strategy = require('passport')._strategy('google');
    // Fake Google's external token/profile transports, retaining the actual strategy and identity checks.
    strategy._oauth2.getOAuthAccessToken = (code, params, done) => done(null, 'fake-access', 'fake-refresh', {});
    strategy._oauth2.get = (url, token, done) => done(null, JSON.stringify({ sub: 'google-sub', email: user.email, email_verified: true, given_name: 'Session' }));
    const start = await fetch(`${origin}/api/auth/google?code_challenge=${challenge}&return_to=/platform-admin.html`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get('location')).searchParams.get('state'); assert.ok(state);
    const cookie = start.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${origin}/api/auth/google/callback?code=fake&state=${state}`, { redirect: 'manual' })).status, 400);
    const callback = await fetch(`${origin}/api/auth/google/callback?code=fake&state=${state}`, { headers: { cookie }, redirect: 'manual' });
    assert.equal(callback.status, 302);
    const destination = new URL(callback.headers.get('location'), origin);
    assert.equal(destination.pathname, '/platform-admin.html'); assert.equal(destination.searchParams.has('token'), false);
    const code = destination.searchParams.get('code'); assert.ok(code);
    assert.equal((await request('oauth/exchange', { code, code_verifier: 'x'.repeat(64) })).status, 400);
    const exchanged = await request('oauth/exchange', { code, code_verifier: verifier });
    assert.equal(exchanged.status, 200); assert.ok(exchanged.data.refreshToken); assert.ok(exchanged.data.session.session_id);
    assert.equal((await request('oauth/exchange', { code, code_verifier: verifier })).status, 400);
    assert.equal((await fetch(`${origin}/api/auth/google?code_challenge=${challenge}&return_to=https://evil.test`, { redirect: 'manual' })).status, 400);
    assert.equal((await fetch(`${origin}/api/auth/google/callback?code=fake&state=${state}`, { headers: { cookie }, redirect: 'manual' })).status, 400);
  });

  test('revoking a device disconnects its sockets and preserves another device', { timeout: 8000 }, async () => {
    const first = await login(), second = await login();
    const connect = require('socket.io-client').io;
    const a = connect(origin, { auth: { token: first.data.token }, transports: ['websocket'], reconnection: false, forceNew: true });
    const b = connect(origin, { auth: { token: second.data.token }, transports: ['websocket'], reconnection: false, forceNew: true });
    try {
      await Promise.all([once(a, 'connect'), once(b, 'connect')]);
      const disconnected = once(a, 'disconnect');
      assert.equal((await request(`sessions/${first.data.session.session_id}`, undefined, second.data.token, 'DELETE')).status, 200);
      await Promise.race([disconnected, new Promise((_, reject) => setTimeout(() => reject(new Error('revoked session socket stayed connected')), 1000))]);
      assert.equal(b.connected, true);
      const response = await new Promise(resolve => b.emit('get_online_users', {}, resolve)); assert.equal(response.success, true);
      const forged = require('jsonwebtoken').sign({ user_id: user.user_id, sid: randomUUID(), token_use: 'access', session_version: user.session_version }, process.env.JWT_SECRET);
      process.env.AUTH_SESSIONS_ENFORCED = 'false';
      assert.equal((await request('me', undefined, forged, 'GET')).status, 401);
      process.env.AUTH_SESSIONS_ENFORCED = 'true';
    } finally { a.disconnect(); b.disconnect(); }
  });

  test('legacy exchange is finite, one-use and cannot accept tokens minted after activation', async () => {
    await user.reload();
    const state = await require('../models').AuthSecurityState.findByPk('sessions');
    const activationSeconds = Math.floor(new Date(state.activated_at).getTime() / 1000);
    const jwt = require('jsonwebtoken');
    const claims = { user_id: user.user_id, session_version: user.session_version, iat: activationSeconds - 10, exp: activationSeconds + 3600 };
    const access = jwt.sign(claims, process.env.JWT_SECRET);
    const refresh = jwt.sign(claims, process.env.JWT_REFRESH_SECRET);
    assert.equal((await request('logout', {refresh_token:refresh})).status,401);
    assert.equal((await request('me', undefined, access, 'GET')).status, 200);
    const exchanges = await Promise.all([request('refresh-token', { refresh_token: refresh }), request('refresh-token', { refresh_token: refresh })]);
    assert.deepEqual(exchanges.map(r => r.status).sort(), [200, 401]);
    assert.ok(exchanges.find(r => r.status === 200).data.session.session_id);
    const newlyMinted = jwt.sign({ ...claims, iat: activationSeconds + 1 }, process.env.JWT_REFRESH_SECRET);
    assert.equal((await request('refresh-token', { refresh_token: newlyMinted })).status, 401);
    const original = state.toJSON();
    await state.update({ activated_at: new Date(Date.now() - 90000000), legacy_until: new Date(Date.now() - 3600000) });
    assert.equal((await request('me', undefined, access, 'GET')).status, 401);
    assert.equal((await request('refresh-token', { refresh_token: refresh })).status, 401);
    await state.update({ activated_at: original.activated_at, legacy_until: original.legacy_until });
    const before = (await state.reload()).toJSON();
    await require('../migrations/20261122100000-managed-auth-sessions').up(db.getQueryInterface(), require('sequelize').Sequelize);
    await state.reload(); assert.equal(+state.activated_at, +before.activated_at); assert.equal(+state.legacy_until, +before.legacy_until);
  });

  test('an expired socket handshake reconnects with HTTP-rotated credentials and keeps its selected organization', { timeout: 10000 }, async () => {
    const { Organization, OrganizationMembership, HRProfile } = require('../models');
    const organizations = [];
    for (const name of ['socket-a', 'socket-b']) {
      const organization = await Organization.create({name,slug:name});
      const role = await Role.create({organization_id:organization.organization_id,role_key:'staff',name:'Staff',is_system:true});
      const membership = await OrganizationMembership.create({organization_id:organization.organization_id,user_id:user.user_id});
      await HRProfile.create({organization_id:organization.organization_id,membership_id:membership.membership_id,user_id:user.user_id,role_id:role.role_id});
      organizations.push(organization);
    }
    process.env.JWT_ACCESS_EXPIRATION = '2s';
    const signed = await login(); delete process.env.JWT_ACCESS_EXPIRATION;
    let access = signed.data.token;
    const selected = organizations[1].organization_id;
    const socket = require('socket.io-client').io(origin, {auth: callback => callback({token:access,organization_id:selected}),transports:['websocket'],reconnection:false,forceNew:true});
    try {
      await once(socket, 'connect');
      const expires = require('jsonwebtoken').decode(access).exp * 1000;
      await new Promise(resolve => setTimeout(resolve, Math.max(0, expires - Date.now() + 50)));
      const refreshed = await request('refresh-token', {refresh_token:signed.data.refreshToken});
      assert.equal(refreshed.status,200); access = refreshed.data.token;
      const me = await fetch(`${origin}/api/auth/me`, {headers:{authorization:`Bearer ${access}`,'X-Organization-Id':selected}});
      const projection = await me.json();
      assert.equal(projection.data.organizations.length,2); assert.equal(projection.data.active_organization_id,selected);
      const disconnected = once(socket, 'disconnect'); socket.emit('get_online_users');
      assert.equal((await disconnected)[0], 'io server disconnect');
      socket.connect(); await once(socket, 'connect');
      const result = await new Promise(resolve => socket.emit('get_online_users', {}, resolve));
      assert.equal(result.success,true); assert.equal(result.organization_id,selected);
      socket.disconnect();
      await OrganizationMembership.update({status:'suspended'}, {where:{user_id:user.user_id,organization_id:selected}});
      socket.connect(); const [error] = await once(socket,'connect_error'); assert.equal(error.message,'Authentication error');
    } finally { socket.disconnect(); delete process.env.JWT_ACCESS_EXPIRATION; }
  });

}
