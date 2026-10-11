const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks) {
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const context = { exports: {}, console, require: name => name === 'crypto' ? require('node:crypto') : mocks[name] || {} };
  vm.runInNewContext(ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }), context);
  return context.exports;
}

function matches(row, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some(condition => matches(row, condition));
    if (value && typeof value === 'object' && '$exists' in value) return (row[key] !== undefined) === value.$exists;
    return row[key] === value;
  });
}

function setup() {
  const rows = Array.from({ length: 65 }, (_, i) => ({
    _id: String(i + 1).padStart(3, '0'), userId: 'current', orderType: 'recharge',
    status: ['paid', 'pending', 'closed', 'refunded'][i % 4], createdAt: new Date(1000), planId: 'plan'
  }));
  rows.push({ _id: '100', userId: 'other', orderType: 'recharge', status: 'paid', createdAt: new Date(2000) });
  rows.push({ _id: '101', userId: 'current', orderType: 'member', status: 'paid', createdAt: new Date(2000) });
  rows.push({ _id: '102', userId: 'current', status: 'paid', createdAt: new Date(2000) });
  const filters = [];
  const model = {
    countDocuments: async filter => { filters.push(filter); return rows.filter(row => matches(row, filter)).length; },
    find: filter => {
      filters.push(filter);
      let sort = {}, skip = 0, limit = Infinity;
      const query = {
        populate: () => query,
        sort: value => { sort = value; return query; },
        skip: value => { skip = value; return query; },
        limit: value => { limit = value; return query; },
        lean: async () => rows.filter(row => matches(row, filter)).sort((a, b) => {
          for (const [key, direction] of Object.entries(sort)) {
            if (a[key] < b[key]) return -direction;
            if (a[key] > b[key]) return direction;
          }
          return 0;
        }).slice(skip, skip + limit)
      };
      return query;
    }
  };
  const service = load('services/memberService.ts', { '@/models/MemberOrder': model });
  let signedIn = true;
  const controller = load('controllers/memberController.ts', {
    '@/services/memberService': service,
    '@/services/authService': { verifyAccessToken: async () => { if (!signedIn) throw new Error('expired'); return { sub: 'current' }; } },
    '@/utils/tool': load('utils/tool.ts', {})
  });
  const context = query => ({ headers: {}, cookies: { get: () => 'token' }, query });
  return { rows, filters, service, controller, context, expire: () => { signedIn = false; } };
}

test('my orders paging includes all states, exceeds old 50 limit, and remains user scoped', async () => {
  const env = setup();
  const first = await env.service.listMemberOrdersPaged('current', { orderType: 'recharge', page: 1, pageSize: 10 });
  const last = await env.service.listMemberOrdersPaged('current', { orderType: 'recharge', page: 7, pageSize: 10 });
  assert.equal(first.total, 65);
  assert.equal(first.items.length, 10);
  assert.equal(first.items[0]._id, '065');
  assert.equal(last.items.length, 5);
  assert.equal(last.items[4]._id, '001');
  assert.equal(new Set(first.items.map(row => row.status)).size, 4);
  assert.ok(env.filters.every(filter => filter.userId === 'current'));
});

test('type and status filters combine; legacy member type stays discoverable', async () => {
  const env = setup();
  for (const status of ['paid', 'pending', 'closed', 'refunded']) {
    const page = await env.service.listMemberOrdersPaged('current', { orderType: 'recharge', status, pageSize: 100 });
    assert.equal(page.total, env.rows.filter(row => row.userId === 'current' && row.orderType === 'recharge' && row.status === status).length);
    assert.ok(page.items.every(row => row.status === status && row.orderType === 'recharge'));
  }
  const members = await env.service.listMemberOrdersPaged('current', { orderType: 'member' });
  assert.equal(members.total, 2);
  assert.equal(members.items[0]._id, '102');
  assert.equal((await env.service.listMemberOrdersPaged('current', {})).total, 67);
});

test('empty and out-of-range pages normalize; invalid queries never reach the database', async () => {
  const env = setup();
  const last = await env.service.listMemberOrdersPaged('current', { orderType: 'recharge', page: 999 });
  assert.equal(last.page, 7);
  const empty = await env.service.listMemberOrdersPaged('current', { orderType: 'app', page: 5 });
  assert.equal(empty.page, 1);
  assert.equal(empty.total, 0);
  const count = env.filters.length;
  for (const query of [{ orderType: '$where' }, { status: 'all' }, { page: -1 }, { page: 'abc' }, { page: 1.5 }, { pageSize: 0 }, { pageSize: 101 }]) {
    await assert.rejects(env.service.listMemberOrdersPaged('current', query));
  }
  assert.equal(env.filters.length, count);
});

test('endpoint uses signed-in identity, preserves legacy array, and rejects expired sessions', async () => {
  const env = setup();
  const ctx = env.context({ page: '1', pageSize: '10', orderType: 'recharge', status: 'pending', userId: 'other' });
  await env.controller.getOrders(ctx);
  assert.equal(ctx.body.code, 200);
  assert.ok(ctx.body.data.items.every(row => row.userId === 'current' && row.status === 'pending'));
  const legacy = env.context({});
  await env.controller.getOrders(legacy);
  assert.ok(Array.isArray(legacy.body.data));
  assert.ok(legacy.body.data.every(row => row.status === 'paid'));
  env.expire();
  const count = env.filters.length;
  await env.controller.getOrders(ctx);
  assert.equal(ctx.body.code, -1);
  assert.equal(env.filters.length, count);
});
