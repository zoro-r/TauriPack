const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/services/newApiSessionStore.ts'), 'utf8');
const code = ts.transpile(source, { module: ts.ModuleKind.CommonJS, esModuleInterop: true });
function setup() {
  const rows = new Map();
  const model = {
    async updateOne(filter, update, options) {
      let row = rows.get(filter._id);
      if (!row && options?.upsert) { row = { _id: filter._id }; rows.set(filter._id, row); }
      if (!row || (filter.leaseOwner && filter.leaseOwner !== row.leaseOwner) ||
          (filter.leaseUntil?.$gt && row.leaseUntil <= filter.leaseUntil.$gt)) return { matchedCount: 0 };
      Object.assign(row, update.$set || {});
      for (const key of Object.keys(update.$unset || {})) delete row[key];
      return { matchedCount: 1 };
    },
    findOneAndUpdate(filter, update) {
      const row = rows.get(filter._id);
      let found;
      if (row && (!row.leaseUntil || row.leaseUntil <= new Date())) {
        Object.assign(row, update.$set); found = {...row};
      }
      return {select: () => ({ lean: async () => found })};
    }
  };
  const context = { exports: {}, Buffer, setTimeout, require: name => {
    if (name === 'crypto') return crypto;
    if (name === '@/models/NewApiManagedSession') return {default:model,__esModule:true};
    throw new Error('Unexpected import: ' + name);
  }};
  vm.runInNewContext(code, context);
  return { run: context.exports.withStoredManagedSession, rows };
}
const value = { cookie: '', bearerToken:'private-access-token', refreshCookie:'new_api_refresh=private-refresh-token', sessionId:'sid', expiresAt:1700000000000 };
test('credentials survive a new store invocation and are encrypted at rest', async () => {
  const env = setup();
  await env.run('server:user:remote1','secret',async store => { await store.save(value); });
  const raw = [...env.rows.values()][0];
  assert.ok(!raw.encryptedSession.includes(value.bearerToken));
  assert.ok(!raw.encryptedSession.includes('private-refresh-token'));
  await env.run('server:user:remote1','secret',async store => {
    assert.equal(store.session.bearerToken,value.bearerToken);
    assert.equal(store.session.refreshCookie,value.refreshCookie);
  });
});
test('wrong secret and swapped user ciphertext are rejected', async () => {
  const env = setup();
  await env.run('user1','secret',async s => s.save(value));
  await assert.rejects(env.run('user1','wrong-secret',async () => {}), /无法解密/);
  await env.run('user2','secret',async s => s.save(value));
  const rows=[...env.rows.values()]; rows[1].encryptedSession=rows[0].encryptedSession;
  await assert.rejects(env.run('user2','secret',async () => {}), /无法解密/);
  assert.ok(rows.every(r => !r.leaseOwner));
});
test('concurrent store clients serialize rotation and read the newest credential', async () => {
  const env=setup(); let creates=0;
  await Promise.all(Array.from({length:8},()=>env.run('same-user','secret',async s=>{
    if (!s.session) { creates++; await new Promise(r=>setTimeout(r,10)); await s.save(value); }
    else assert.equal(s.session.bearerToken,value.bearerToken);
  })));
  assert.equal(creates,1);
});
test('callback failure releases lease and retains credentials', async () => {
  const env=setup();
  await env.run('user','secret',async s=>s.save(value));
  await assert.rejects(env.run('user','secret',async()=>{throw new Error('refresh failed');}),/refresh failed/);
  await env.run('user','secret',async s=>assert.equal(s.session.sessionId,'sid'));
});
test('an expired lease cannot overwrite another process credentials', async () => {
  const env=setup();
  await assert.rejects(env.run('user','secret',async s=>{
    [...env.rows.values()][0].leaseUntil=new Date(0);
    await s.save(value);
  }),/锁已失效/);
});
test('clearing revoked session retains the lock record and allows a fresh session', async () => {
  const env=setup();
  await env.run('user','secret',async s=>s.save(value));
  await env.run('user','secret',async s=>s.save(undefined));
  await env.run('user','secret',async s=>assert.equal(s.session,undefined));
  assert.equal(env.rows.size,1);
});
