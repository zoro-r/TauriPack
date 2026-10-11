const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the production state machine with mocked Mongo and New-API boundaries.
const source = fs.readFileSync(path.join(__dirname, '../src/services/newApiService.ts'), 'utf8');
const code = ts.transpile(source.slice(source.indexOf('export const creditNewApiRecharge ='), source.indexOf('export const listNewApiKeys =')),
  { module: ts.ModuleKind.CommonJS });
const input = { orderId: 'order1', userId: 'user1', remoteUserId: '123', quota: 500 };
function setup(options = {}) {
  let row = options.row ? { _id: 'recharge1', ...input, updatedAt: new Date(0), ...options.row } : null;
  let calls = 0;
  let saveFailures = options.saveFailures || 0;
  const document = () => row && { ...row, async save() {
    if (this.status === 'credited' && saveFailures-- > 0) throw new Error('Mongo save failed');
    row = { ...this, updatedAt: new Date() };
    delete row.save;
    return this;
  } };
  const model = {
    async findOne() { return document(); },
    async create(value) {
      if (row) throw new Error('duplicate orderId');
      row = { _id: 'recharge1', ...value, updatedAt: new Date() };
      return document();
    },
    async findOneAndUpdate(filter, update) {
      if (filter.$or && !(row.status === 'pending' || (row.status === 'failed' && row.retrySafe))) return null;
      if (filter.status && filter.status !== row.status) return null;
      if (filter.updatedAt && filter.updatedAt.getTime() !== row.updatedAt.getTime()) return null;
      Object.assign(row, update.$set, { updatedAt: new Date() });
      for (const key of Object.keys(update.$unset || {})) delete row[key];
      return document();
    }
  };
  const context = { exports: {}, NewApiRechargeModel: model,
    resolveRemoteUser: async () => { if (options.resolveError) throw new Error('rate limited'); return { id: '123' }; },
    requestNewApiAsAdmin: async () => { calls++; if (options.requestError) throw new Error('socket reset'); return {statusCode: 200, data: options.response || { success: true }}; },
    assertNewApiSuccess: () => {}, logNewApi: () => {}, logNewApiError: () => {} };
  vm.runInNewContext(code, context);
  return { ...context.exports, row: () => row, calls: () => calls, options };
}

test('50 simultaneous callbacks and polls credit the order once', async () => {
  const env = setup();
  await Promise.allSettled(Array.from({length: 50}, () => env.creditNewApiRecharge(input)));
  assert.equal(env.calls(), 1);
  assert.equal(env.row().status, 'credited');
  await env.creditNewApiRecharge(input);
  assert.equal(env.calls(), 1);
});
test('user lookup failure is retryable without sending a quota request', async () => {
  const env = setup({resolveError: true});
  await assert.rejects(env.creditNewApiRecharge(input), /rate limited/);
  assert.equal(env.row().status, 'failed');
  assert.equal(env.row().retrySafe, true);
  assert.equal(env.calls(), 0);
  env.options.resolveError = false;
  await env.creditNewApiRecharge(input);
  assert.equal(env.calls(), 1);
});
test('lost upstream response remains locked even after timeout', async () => {
  const env = setup({requestError: true});
  await assert.rejects(env.creditNewApiRecharge(input), /socket reset/);
  assert.equal(env.row().status, 'crediting');
  env.row().updatedAt = new Date(0);
  await assert.rejects(env.creditNewApiRecharge(input), /待核对/);
  assert.equal(env.calls(), 1);
});
test('upstream success followed by local save failure cannot double credit', async () => {
  const env = setup({saveFailures: 1});
  await assert.rejects(env.creditNewApiRecharge(input), /Mongo save failed/);
  await assert.rejects(env.creditNewApiRecharge(input), /待核对/);
  assert.equal(env.calls(), 1);
});
test('legacy failed records require reconciliation before retry', async () => {
  const env = setup({row: {status: 'failed'}});
  await assert.rejects(env.creditNewApiRecharge(input), /待核对/);
  await env.reconcileNewApiRecharge({orderId: input.orderId, resolution: 'not_credited'});
  await env.creditNewApiRecharge(input);
  assert.equal(env.calls(), 1);
});
test('confirmed remote credit is marked locally without another quota request', async () => {
  const env = setup({row: {status: 'crediting'}});
  await env.reconcileNewApiRecharge({orderId: input.orderId, resolution: 'credited'});
  await env.creditNewApiRecharge(input);
  assert.equal(env.calls(), 0);
  assert.equal(env.row().status, 'credited');
});
test('empty upstream success body is not accepted as credited', async () => {
  const env = setup({response: {}});
  await assert.rejects(env.creditNewApiRecharge(input), /未明确确认/);
  assert.equal(env.row().status, 'crediting');
});
test('invalid quota is rejected before creating a record', async () => {
  const env = setup();
  await assert.rejects(env.creditNewApiRecharge({...input, quota: -1}), /无效/);
  assert.equal(env.row(), null);
});
test('manual reconciliation cannot unlock an active request', async () => {
  const env = setup({row: {status: 'crediting', updatedAt: new Date()}});
  await assert.rejects(env.reconcileNewApiRecharge({orderId: input.orderId, resolution: 'not_credited'}), /等待 10 分钟/);
  assert.equal(env.row().status, 'crediting');
  assert.equal(env.calls(), 0);
});
