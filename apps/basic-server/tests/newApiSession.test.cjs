const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/services/newApiService.ts'), 'utf8');
const code = ts.transpile(source.slice(source.indexOf('const toCookieHeader ='), source.indexOf('const getNewApiSelf =')) +
  '\nexports.request = requestNewApiInUserContext;', { module: ts.ModuleKind.CommonJS });
function setup({ login, refresh, respond, persisted = new Map(), baseUrl = "https://new-api.test" } = {}) {
  const requests = [];
  const cache = new Map();
  let now = 1700000000000;
  let logins = 0;
  const context = {
    exports: {}, Date: { now: () => now, parse: Date.parse },
    managedSessionCache: cache, managedSessionInflight: new Map(), managedSessionRateLimitUntil: 0,
    MANAGED_SESSION_RATE_LIMIT_COOLDOWN_MS: 30000,
    buildManagedUsername: (id) => id, buildManagedPassword: () => 'mock-password',
    getManagedSessionCacheTtlMs: () => 1800000, logNewApi: () => {},
    getConfig: () => ({ baseUrl, managedUserSecret: 'test-secret' }),
    withStoredManagedSession: async (scope, secret, action) => action({
      session: persisted.get(scope), save: async (value) => { if (value) persisted.set(scope, structuredClone(value)); else persisted.delete(scope); }
    }),
    assertNewApiSuccess: (r) => { if (r.statusCode >= 400) throw new Error('login failed'); return r.data.data; },
    requestNewApi: async (opts) => {
      requests.push(opts);
      if (opts.path === '/api/user/auth/refresh') {
        return refresh ? refresh(opts, now) : { statusCode: 401, headers: {} };
      }
      if (opts.path === '/api/user/login') {
        logins++;
        return login ? login(logins, now) : {
          statusCode: 200, headers: {},
          data: { data: { access_token: 'user-token-' + logins, access_expires_at: now / 1000 + 60 } }
        };
      }
      return respond ? respond(opts) : { statusCode: 200 };
    }
  };
  vm.runInNewContext(code, context);
  return { request: (id = 'user1') => context.exports.request(id, id, { method: 'GET', path: '/api/user/self' }),
    requests, cache, persisted, logins: () => logins, advance: (ms) => { now += ms; } };
}

test('uses per-user Bearer token without requiring cookies, reuses cached login', async () => {
  const env = setup();
  await env.request(); await env.request(); await env.request('user2');
  assert.equal(env.logins(), 2);
  const calls = env.requests.filter((r) => r.path === '/api/user/self');
  assert.equal(calls[0].bearerToken, 'user-token-1');
  assert.equal(calls[0].cookie, '');
  assert.equal(calls[2].bearerToken, 'user-token-2');
  assert.equal(calls[2].newApiUser, 'user2');
});
test('renews login before access token expires', async () => {
  const env = setup(); await env.request(); env.advance(56000); await env.request();
  assert.equal(env.logins(), 2);
});
test('concurrent requests share login and renew once after concurrent 401s', async () => {
  const env = setup({ respond: (r) => ({ statusCode: r.bearerToken === 'user-token-1' ? 401 : 200 }) });
  const responses = await Promise.all(Array.from({ length: 10 }, () => env.request()));
  assert.equal(env.logins(), 2);
  assert.ok(responses.every((r) => r.statusCode === 200));
});
test('persistent 401 retries only once and clears cached credentials', async () => {
  const env = setup({ respond: () => ({ statusCode: 401 }) });
  assert.equal((await env.request()).statusCode, 401);
  assert.equal(env.logins(), 2); assert.equal(env.cache.size, 0);
});
test('older New-API versions retain Cookie authentication', async () => {
  const env = setup({ login: () => ({ statusCode: 200, headers: { 'set-cookie': ['session=legacy; Path=/; HttpOnly'] }, data: { data: {} } }) });
  await env.request();
  assert.equal(env.requests[1].cookie, 'session=legacy');
  assert.equal(env.requests[1].bearerToken, undefined);
});
test('rejects login success with no usable credentials', async () => {
  const env = setup({ login: () => ({ statusCode: 200, headers: {}, data: { data: {} } }) });
  await assert.rejects(env.request(), /未返回访问令牌或会话 Cookie/);
  assert.equal(env.cache.size, 0);
});
test('login rate limit prevents repeated upstream attempts during cooldown', async () => {
  const env = setup({ login: () => ({ statusCode: 429, headers: {} }) });
  await assert.rejects(env.request(), /登录暂时受限/);
  await assert.rejects(env.request(), /登录暂时受限/);
  assert.equal(env.logins(), 1);
});


test('honors upstream Retry-After across users, while cached sessions remain usable', async () => {
  let limited = false;
  const env = setup({ login: (n, now) => limited
    ? { statusCode: 429, headers: { 'retry-after': '1200' } }
    : { statusCode: 200, headers: {}, data: { data: { access_token: 'cached-token', access_expires_at: now / 1000 + 3600 } } }
  });
  await env.request('cached-user');
  limited = true;
  await assert.rejects(env.request('limited-user'), /1200 秒/);
  env.advance(31000);
  await assert.rejects(env.request('another-user'), /1169 秒/);
  assert.equal((await env.request('cached-user')).statusCode, 200);
  assert.equal(env.logins(), 2);
  env.advance(1170000);
  limited = false;
  await env.request('another-user');
  assert.equal(env.logins(), 3);
});


const modernLogin = (n, now) => ({ statusCode: 200,
  headers: { 'set-cookie': ['new_api_refresh=sid.refresh-' + n + '; Path=/api/user/auth; HttpOnly'] },
  data: { data: { access_token: 'user-token-' + n, access_expires_at: now / 1000 + 60,
    session: { sid: 'sid', expires_at: now / 1000 + 86400 } } }
});
const modernRefresh = (opts, now) => ({ statusCode: 200,
  headers: { 'set-cookie': ['new_api_refresh=sid.rotated; Path=/api/user/auth; HttpOnly'] },
  data: { data: { access_token: 'refreshed-token', access_expires_at: now / 1000 + 3600,
    session: { sid: 'sid', expires_at: now / 1000 + 86400 } } }
});
test('expiry refreshes and persists rotated credentials without another login', async () => {
  const env = setup({ login: modernLogin, refresh: modernRefresh });
  await env.request(); env.advance(56000); await env.request();
  assert.equal(env.logins(), 1);
  const r = env.requests.find(r => r.path === '/api/user/auth/refresh');
  assert.equal(r.cookie, 'new_api_refresh=sid.refresh-1');
  assert.equal(env.requests.at(-1).bearerToken, 'refreshed-token');
  assert.equal([...env.persisted.values()][0].refreshCookie, 'new_api_refresh=sid.rotated');
});
test('restart recovers credentials and refreshes the same session', async () => {
  const env = setup({ login: modernLogin, refresh: modernRefresh });
  await env.request(); env.cache.clear(); await env.request();
  assert.equal(env.logins(), 1);
  env.cache.clear(); env.advance(56000); await env.request();
  assert.equal(env.logins(), 1);
  assert.equal([...env.persisted.values()][0].sessionId, 'sid');
});
test('concurrent 401s share one refresh and never create a new login', async () => {
  const env = setup({ login: modernLogin, refresh: modernRefresh,
    respond: r => ({ statusCode: r.bearerToken === 'user-token-1' ? 401 : 200 }) });
  const results = await Promise.all(Array.from({length: 20}, () => env.request()));
  assert.ok(results.every(r => r.statusCode === 200));
  assert.equal(env.logins(), 1);
  assert.equal(env.requests.filter(r => r.path === '/api/user/auth/refresh').length, 1);
});
test('revoked refresh permits one new login', async () => {
  const env = setup({ login: modernLogin });
  await env.request(); env.advance(56000); await env.request();
  assert.equal(env.logins(), 2);
});
for (const status of [409, 429, 500]) {
  test('refresh ' + status + ' preserves credentials without creating another session', async () => {
    const env = setup({ login: modernLogin, refresh: () => ({statusCode: status, headers: {'retry-after':'1200'}}) });
    await env.request(); env.advance(56000);
    await assert.rejects(env.request());
    assert.equal(env.logins(), 1);
    assert.equal([...env.persisted.values()][0].refreshCookie, 'new_api_refresh=sid.refresh-1');
  });
}
test('refresh network failure keeps the refresh credential for retry', async () => {
  const env = setup({ login: modernLogin, refresh: () => { throw new Error('socket reset'); } });
  await env.request(); env.advance(56000); await assert.rejects(env.request(), /socket reset/);
  assert.equal(env.logins(), 1);
  assert.equal(env.persisted.size, 1);
});
test('wrong user or wrong session in refresh response fails without saving', async () => {
  for (const changed of [{user:{id:'other'}}, {session:{sid:'other'}}]) {
    const env = setup({login:modernLogin, refresh:(o, now) => {
      const r = modernRefresh(o,now); Object.assign(r.data.data,changed); return r;
    }});
    await env.request(); env.advance(56000); await assert.rejects(env.request(), /不匹配/);
    assert.equal([...env.persisted.values()][0].bearerToken, 'user-token-1');
  }
});
test('different upstream servers never reuse another server credential', async () => {
  const persisted = new Map();
  const a = setup({ persisted, login: modernLogin }); await a.request();
  const b = setup({ persisted, login: modernLogin, baseUrl:'https://other.test' }); await b.request();
  assert.equal(b.logins(),1); assert.equal(persisted.size,2);
});
