const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const jwt = require('jsonwebtoken');
const ts = require('typescript');

const origin = 'https://app.chaobenxueyuan.com';
const secret = 'chaoben-integration-fixture-secret-32';
const firstOrange = randomUUID();
const secondOrange = randomUUID();
const user = { _id: 'wechat-user', wechatOpenId: 'first-wechat', role: 'user' };
const otherUser = { _id: 'other-wechat-user', wechatOpenId: 'other-wechat', role: 'user' };
const accessSecret = 'test-access';
const query = item => ({ select: () => query(item), lean: async () => item });
const duplicate = () => Object.assign(new Error('duplicate key'), { code: 11000 });
const matches = (record, filter) => Object.entries(filter).every(([key, value]) => {
  if (key === '$or') return value.some(option => matches(record, option));
  if (value && Object.hasOwn(value, '$gt')) return record[key] > value.$gt;
  if (value && Object.hasOwn(value, '$exists')) return Object.hasOwn(record, key) === value.$exists;
  return record[key] === value;
});

function load(path, imports = {}) {
  const source = readFileSync(join(__dirname, '../src', path), 'utf8');
  const exports = {};
  runInNewContext(ts.transpile(source, {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2015, esModuleInterop: true
  }), {
    exports, Buffer, process: { env: {
      APP_CHAOBEN_LOGIN_SECRET: secret, JWT_ACCESS_SECRET: accessSecret, JWT_REFRESH_SECRET: 'test-refresh',
      WECHAT_CLIENT_BASE: origin
    } },
    console: { error() {} },
    require: name => Object.hasOwn(imports, name) ? imports[name] : require(name)
  });
  return exports;
}

function fixture() {
  const users = [{ ...user }, { ...otherUser }], attempts = [], states = [], sessions = [];
  const usersModel = {
    findOne: filter => query(users.find(item => matches(item, filter))),
    findById: id => query(users.find(item => item._id === id)),
    init: async () => {},
    updateOne: async (filter, { $set }) => {
      const selected = users.find(item => matches(item, filter));
      if (selected && users.some(item => item !== selected && item.orangeUserId === $set.orangeUserId)) throw duplicate();
      if (selected) Object.assign(selected, $set);
      return { matchedCount: Number(Boolean(selected)) };
    }
  };
  const binding = load('services/orangeLoginService.ts', {
    '@/models/User': usersModel,
    '@/models/OrangeLoginAttempt': {
      create: async attempt => {
        if (attempts.some(item => item._id === attempt._id)) throw duplicate();
        attempts.push(attempt);
      },
      findOne: filter => query(attempts.find(item => matches(item, filter)))
    }
  });
  const auth = load('services/authService.ts', {
    '@/models/User': usersModel,
    '@/models/WechatLoginState': {
      create: async state => { states.push(state); return state; },
      findOneAndUpdate: async (filter, { $set, $unset }) => {
        const state = states.find(item => matches(item, filter));
        if (!state) return null;
        const value = { ...state };
        Object.assign(state, $set);
        for (const key of Object.keys($unset)) delete state[key];
        return value;
      }
    },
    '@/models/UserSession': {
      find: filter => ({ sort: () => query(sessions.filter(item => matches(item, filter))) }),
      findOne: async filter => sessions.find(item => matches(item, filter)),
      create: async session => { sessions.push(session); return session; },
      updateOne: async (filter, { $set }) => {
        const session = sessions.find(item => matches(item, filter));
        if (session) Object.assign(session, $set);
      }
    },
    '@/models/RefreshToken': { create: async () => {}, updateMany: async () => {} },
    '@/services/wechatApi': {}, '@/services/memberDebugService': {}, '@/services/orangeLoginService': binding
  });
  const controller = load('controllers/authController.ts', {
    '@/services/authService': auth, '@/services/orangeLoginService': binding,
    '@/services/memberDebugService': {}, '@/middleware/auth': {}, '@/utils/tool': load('utils/tool.ts')
  });
  function context(cookies = new Map(), body = {}, queryParams = {}, source = origin) {
    return {
      headers: {}, query: queryParams, request: { body }, secure: true, ip: '127.0.0.1',
      get: name => name === 'origin' ? source : '', set() {},
      cookies: { get: name => cookies.get(name), set: (name, value) => cookies.set(name, value) }
    };
  }
  const ticket = (orangeId = firstOrange, options = {}) => jwt.sign({}, secret, {
    issuer: 'orange-education-desktop', audience: origin, subject: orangeId, jwtid: randomUUID(), expiresIn: 60,
    ...options
  });
  const open = async (signedTicket, cookies = new Map(), source = origin) => {
    const ctx = context(cookies, { ticket: signedTicket }, {}, source);
    await controller.openOrangeSession(ctx);
    return { ctx, cookies };
  };
  const scan = async (cookies, account = user) => {
    const ctx = context(cookies, {}, { bindOrange: '1' });
    await controller.getWechatQr(ctx);
    assert.equal(ctx.body.code, 200);
    const state = states.find(item => item.state === ctx.body.data.state);
    state.status = 'SUCCESS'; state.userId = account._id; state.loginCode = randomUUID();
    return state.loginCode;
  };
  const finish = async (cookies, loginCode, bindOrange = true) => {
    const ctx = context(cookies, { loginCode, bindOrange });
    await controller.exchangeToken(ctx);
    return ctx;
  };
  return { binding, users, sessions, ticket, open, scan, finish };
}

test('first launch requires a scan in the same binding attempt; a new launch signs in to the original account', async () => {
  const f = fixture();
  const { ctx, cookies } = await f.open(f.ticket());
  assert.equal(ctx.body.data.status, 'scan-required');
  assert.equal(cookies.get('accessToken'), '');
  const code = await f.scan(cookies);
  const differentAttempt = await f.open(f.ticket());
  assert.equal((await f.finish(differentAttempt.cookies, code)).body.code, -1);
  assert.equal((await f.finish(cookies, code, false)).body.code, -1);
  assert.equal((await f.finish(cookies, code)).body.data.status, 'signed-in');
  assert.equal(f.users[0].orangeUserId, firstOrange);
  assert.equal(jwt.verify(cookies.get('accessToken'), accessSecret).sub, user._id);
  assert.equal((await f.finish(cookies, code)).body.code, -1);
  const reopened = await f.open(f.ticket());
  assert.equal(reopened.ctx.body.data.status, 'signed-in');
  assert.equal(jwt.verify(reopened.cookies.get('accessToken'), accessSecret).sub, user._id);
  const existingSession = await f.open(f.ticket(), reopened.cookies);
  assert.equal(existingSession.ctx.body.data.status, 'signed-in');
  assert.equal(f.sessions.length, 2, 'an existing valid session is not replaced');
});

test('rejects replay, expired tickets, a different issuer, and cross-origin requests', async () => {
  const f = fixture();
  const ticket = f.ticket();
  assert.equal((await f.open(ticket, new Map(), 'https://unrelated.test')).ctx.body.code, -1);
  assert.equal((await f.open(ticket)).ctx.body.code, 200);
  assert.equal((await f.open(ticket)).ctx.body.code, -1);
  assert.equal((await f.open(f.ticket(firstOrange, { expiresIn: -1 }))).ctx.body.code, -1);
  assert.equal((await f.open(f.ticket(firstOrange, { issuer: 'other-platform' }))).ctx.body.code, -1);
});

test('a one-to-one binding cannot overwrite either existing account', async () => {
  const f = fixture();
  const original = await f.open(f.ticket());
  const sameOrange = await f.open(f.ticket());
  const differentOrange = await f.open(f.ticket(secondOrange));
  assert.equal((await f.finish(original.cookies, await f.scan(original.cookies))).body.code, 200);
  assert.match((await f.finish(sameOrange.cookies, await f.scan(sameOrange.cookies, otherUser))).body.message, /已绑定其他超本云账号/);
  assert.match((await f.finish(differentOrange.cookies, await f.scan(differentOrange.cookies))).body.message, /已绑定其他橙子账号/);
  assert.equal(f.users[0].orangeUserId, firstOrange);
  assert.equal(f.users[1].orangeUserId, undefined);
});
