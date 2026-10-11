const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const jwt = require('jsonwebtoken');
const code = ts.transpile(fs.readFileSync(require('node:path').join(__dirname, '../src/services/memberDebugService.ts'), 'utf8'), {module: ts.ModuleKind.CommonJS, esModuleInterop: true});
const joker = {_id: '698433ea0cda17ab9fdcd41f', wechatOpenId: 'o8yng1Rr9LW8dW1989inQTIIxVGI', role: 'admin'};
const target = {_id: '698433ea0cda17ab9fdcd420', wechatOpenId: 'member-openid', role: 'user'};
function setup() {
  const users = new Map([[joker._id, {...joker}], [target._id, {...target}]]);
  let parent = {expiresAt: new Date(Date.now() + 3600000)};
  let record;
  let tokenPayload;
  const models = {
    '@/models/User': {findById: async id => users.get(String(id))},
    '@/models/UserSession': {findOne: async () => parent},
    '@/models/MemberDebugSession': {
      create: async input => {record = {...input};},
      findOne: async filter => record && !record.endedAt && record.expiresAt > new Date() &&
        record.sessionId === filter.sessionId && record.targetUserId === filter.targetUserId && record.parentSessionId === filter.parentSessionId ? record : null,
      updateOne: async (filter, update) => {if (record?.sessionId === filter.sessionId) Object.assign(record, update.$set);}
    }
  };
  const context = {exports: {}, process: {env: {JWT_ACCESS_SECRET: 'test-secret'}}, require: name => {
    if (models[name]) return models[name];
    if (name === 'crypto') return require('node:crypto');
    if (name === 'mongoose') return {isValidObjectId: id => /^[a-f0-9]{24}$/.test(id)};
    if (name === 'jsonwebtoken') return {sign: (payload, secret, options) => {tokenPayload = payload; return jwt.sign(payload, secret, options);}};
    throw new Error(name);
  }};
  vm.runInNewContext(code, context);
  return {...context.exports, users, record: () => record, payload: () => tokenPayload,
    revokeParent: () => {parent = null;},
    start() {return context.exports.createMemberDebugSession({actorUserId: joker._id, parentSessionId: 'admin-session', targetUserId: target._id, ip: '127.0.0.1', userAgent: 'test'});}
  };
}
test('only the exact Joker ID, OpenID and admin role are permitted', () => {
  const env = setup();
  assert.equal(env.canDebugMembers(joker), true);
  assert.equal(env.canDebugMembers({...joker, _id: target._id, nickname: 'Joker'}), false);
  assert.equal(env.canDebugMembers({...joker, wechatOpenId: 'different'}), false);
  assert.equal(env.canDebugMembers({...joker, role: 'user'}), false);
});
test('another administrator cannot create a debug session', async () => {
  const env = setup();
  env.users.get(joker._id).wechatOpenId = 'different';
  await assert.rejects(env.start(), /仅 Joker/);
  assert.equal(env.record(), undefined);
});
test('debug access uses its own audit record and no member login session or refresh token', async () => {
  const env = setup();
  const result = await env.start();
  const payload = jwt.verify(result.accessToken, 'test-secret');
  assert.equal(payload.sub, target._id);
  assert.equal(payload.sid, 'admin-session');
  assert.ok(payload.debugSessionId);
  assert.equal(payload.exp - payload.iat, 1800);
  assert.equal(result.refreshToken, undefined);
  assert.equal(env.record().actorUserId, joker._id);
  assert.equal(env.record().targetUserId, target._id);
  await env.verifyMemberDebugSession(env.payload());
});
test('target administrators are rejected', async () => {
  const env = setup();
  env.users.get(target._id).role = 'admin';
  await assert.rejects(env.start(), /管理员账户/);
});
test('revoking the parent session invalidates member access', async () => {
  const env = setup(); await env.start(); env.revokeParent();
  await assert.rejects(env.verifyMemberDebugSession(env.payload()), /权限已失效/);
});
test('removing Joker admin role invalidates existing member access', async () => {
  const env = setup(); await env.start(); env.users.get(joker._id).role = 'user';
  await assert.rejects(env.verifyMemberDebugSession(env.payload()), /权限已失效/);
});
test('changing target identity or promoting target is rejected', async () => {
  const env = setup(); await env.start();
  await assert.rejects(env.verifyMemberDebugSession({...env.payload(), sub: joker._id}), /已结束/);
  env.users.get(target._id).role = 'admin';
  await assert.rejects(env.verifyMemberDebugSession(env.payload()), /权限已失效/);
});
test('expired and ended sessions cannot be reused; audit record is retained', async () => {
  const env = setup(); await env.start();
  const expiry = env.record().expiresAt;
  env.record().expiresAt = new Date(0);
  await assert.rejects(env.verifyMemberDebugSession(env.payload()), /已结束/);
  env.record().expiresAt = expiry;
  await env.endMemberDebugSession(env.payload().debugSessionId);
  await assert.rejects(env.verifyMemberDebugSession(env.payload()), /已结束/);
  assert.ok(env.record().endedAt);
});

function controllerSetup(env) {
  const controllerSource = fs.readFileSync(require('node:path').join(__dirname, '../src/controllers/adminController.ts'), 'utf8');
  const cookies = [];
  const context = {exports: {}, require: name => {
    if (name === '@/middleware/auth') return {requireAdmin: async () => env.users.get(joker._id), getBearerToken: () => 'admin-token'};
    if (name === '@/services/authService') return {verifyAccessToken: async () => ({sid:'admin-session'})};
    if (name === '@/services/memberDebugService') return env;
    if (name === '@/controllers/authController') return {buildCookieOptions: (ctx, maxAge) => ({httpOnly:true,path:'/',maxAge})};
    if (name === '@/utils/tool') return {success: data => ({code:200,data}), error: (message, error) => ({code:-1,message,error:error.message})};
    return {};
  }};
  vm.runInNewContext(ts.transpile(controllerSource, {module:ts.ModuleKind.CommonJS}), context);
  const ctx = {params:{id:target._id}, ip:'127.0.0.1', get: () => 'test', cookies:{set: (...args) => cookies.push(args)}};
  return {controller:context.exports, ctx, cookies};
}
test('switch endpoint replaces access cookie, clears administrator refresh, and returns no token', async () => {
  const env = setup();
  const {controller, ctx, cookies} = controllerSetup(env);
  await controller.postMemberDebugSession(ctx);
  assert.equal(ctx.body.code, 200);
  assert.equal(ctx.body.data.user.id, target._id);
  assert.equal(ctx.body.data.accessToken, undefined);
  assert.equal(cookies[0][0], 'accessToken');
  assert.equal(jwt.verify(cookies[0][1], 'test-secret').sub, target._id);
  assert.equal(cookies[0][2].httpOnly, true);
  assert.equal(cookies[1][0], 'refreshToken');
  assert.equal(cookies[1][1], '');
  assert.equal(cookies[1][2].maxAge, 0);
});
test('unauthorized switch does not modify login cookies', async () => {
  const env = setup(); env.users.get(joker._id).wechatOpenId = 'different-admin';
  const {controller, ctx, cookies} = controllerSetup(env);
  await controller.postMemberDebugSession(ctx);
  assert.equal(ctx.body.code, -1);
  assert.equal(cookies.length, 0);
});
