const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, deps, root) {
  const code = ts.transpile(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true
  });
  const context = { exports: {}, URL, console, setInterval, process: { cwd: () => root, env: {} }, require: name => {
    if (Object.hasOwn(deps, name)) return deps[name];
    if (!name.startsWith('@/')) return require(name);
    throw new Error(`Unexpected dependency: ${name}`);
  }};
  vm.runInNewContext(code, context);
  return context.exports;
}
function setup(t, realUpload = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'member-cloud-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const accounts = new Map();
  const model = {
    findById: id => ({ lean: async () => structuredClone(accounts.get(id) || null) }),
    updateOne: async (filter, update, options) => {
      let account = accounts.get(filter._id);
      if (!account && options?.upsert) { account = { packages: [] }; accounts.set(filter._id, account); }
      if (!account) return { modifiedCount: 0 };
      if (filter.$expr?.$lte) {
        const [addition, limit] = filter.$expr.$lte;
        const [size, sum] = addition.$add;
        const threshold = sum.$sum.$map.input.$filter.cond.$gt[1];
        const now = threshold === '$$NOW' ? new Date() : threshold;
        const used = account.packages.filter(p => p.previewExpiresAt > now).reduce((s, p) => s + p.packageSize, 0);
        if (size + used > limit) return { modifiedCount: 0 };
      }
      if (filter.packages) {
        const match = filter.packages.$elemMatch;
        const item = account.packages.find(p => p.appSlug === match.appSlug && p.status === match.status && p.previewExpiresAt > match.previewExpiresAt.$gt);
        if (!item) return { modifiedCount: 0 };
        for (const [key, value] of Object.entries(update.$set)) item[key.replace('packages.$.', '')] = value;
      }
      if (update.$push) account.packages.push(update.$push.packages);
      if (update.$pull) {
        const target = update.$pull.packages;
        account.packages = account.packages.filter(p => !(p.appSlug === target.appSlug && (!target.previewExpiresAt || p.previewExpiresAt <= target.previewExpiresAt.$lte)));
      }
      return { modifiedCount: 1 };
    }
  };
  const tool = load('utils/tool.ts', {}, root);
  let failUpload = false;
  let expireReservation = false;
  const packageService = realUpload ? load('services/appPackageService.ts', {
    '@/services/appCatalogService': { resolveAppSlug: async () => 'demo' }, '@/utils/tool': tool
  }, root) : {
    getAppHostingOrigin: () => 'https://hosting.example.com',
    uploadAppPackage: async input => {
      if (failUpload) throw new Error('invalid ZIP');
      const dir = path.join(root, 'uploads/apps', input.storageSlug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'web.html'), 'preview');
      if (expireReservation) for (const a of accounts.values()) for (const p of a.packages) p.previewExpiresAt = new Date(0);
      return { appSlug: input.storageSlug, previewPath: `/app-previews/${input.storageSlug}/token/`, previewExpiresAt: new Date(Date.now() + 86400000).toISOString() };
    }
  };
  const service = load('services/memberCloudSpaceService.ts', {
    '@/models/MemberCloudSpace': model, '@/services/appPackageService': packageService
  }, root);
  const input = (size = 100) => {
    const file = path.join(root, Math.random() + '.zip');
    fs.writeFileSync(file, ''); fs.truncateSync(file, size);
    return { file: { path: file, originalname: 'demo.zip' }, appName: 'demo' };
  };
  return { service, input, accounts, model, root, packageService, tool,
    fail: () => { failUpload = true; }, expire: () => { expireReservation = true; } };
}

test('50MB is enforced across concurrent uploads; reservations count and accounts remain independent', async t => {
  const { service, input } = setup(t);
  const mb = 1024 * 1024;
  const results = await Promise.allSettled([service.uploadMemberCloudPackage('a', input(30 * mb)), service.uploadMemberCloudPackage('a', input(30 * mb))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /容量不足/);
  assert.equal((await service.getMemberCloudQuota('a')).usedBytes, 30 * mb);
  await service.uploadMemberCloudPackage('a', input(20 * mb));
  assert.equal((await service.getMemberCloudQuota('a')).usedBytes, 50 * mb);
  await assert.rejects(service.uploadMemberCloudPackage('a', input(1)), /容量不足/);
  await service.uploadMemberCloudPackage('b', input(50 * mb));
  assert.equal((await service.getMemberCloudQuota('b')).usedBytes, 50 * mb);
  const large = input(50 * mb + 1);
  await assert.rejects(service.uploadMemberCloudPackage('c', large), /过大/);
  assert.equal(fs.existsSync(large.file.path), false);
});

test('listing is complete by default, paging does not change quota; deletion checks ownership and path boundaries', async t => {
  const { service, input, root } = setup(t);
  const first = await service.uploadMemberCloudPackage('a', input(123));
  const second = await service.uploadMemberCloudPackage('a', input(456));
  const all = await service.listMemberCloudPackages('a');
  assert.equal(all.list.length, 2);
  assert.equal(all.list.find(p => p.appSlug === first.appSlug).previewUrl, first.previewUrl);
  assert.equal(all.list.find(p => p.appSlug === second.appSlug).packageSize, 456);
  assert.ok(all.list.every(p => p.createdAt.endsWith('Z') && p.previewExpiresAt.endsWith('Z')));
  const paged = await service.listMemberCloudPackages('a', { page: '2', pageSize: '1' });
  assert.equal(paged.list.length, 1); assert.equal(paged.total, 2); assert.equal(paged.usedBytes, 579);
  await assert.rejects(service.listMemberCloudPackages('a', { page: '-1' }), /正整数/);
  assert.equal((await service.listMemberCloudPackages('b')).total, 0);
  await assert.rejects(service.deleteMemberCloudPackage('b', first.appSlug), /无权/);
  assert.ok(fs.existsSync(path.join(root, 'uploads/apps', first.appSlug)));
  await assert.rejects(service.deleteMemberCloudPackage('a', '../apps'), /无效/);
  await service.deleteMemberCloudPackage('a', first.appSlug);
  assert.equal(fs.existsSync(path.join(root, 'uploads/apps', first.appSlug)), false);
  assert.equal((await service.getMemberCloudQuota('a')).usedBytes, 456);
});

test('failed ZIP and expired reservation release quota and remove files; expiration cleanup leaves unknown historical files alone', async t => {
  const a = setup(t);
  a.fail();
  const invalid = a.input(1024);
  await assert.rejects(a.service.uploadMemberCloudPackage('a', invalid), /invalid ZIP/);
  assert.equal((await a.service.getMemberCloudQuota('a')).usedBytes, 0);
  assert.equal(fs.existsSync(invalid.file.path), false);
  const b = setup(t); b.expire();
  await assert.rejects(b.service.uploadMemberCloudPackage('a', b.input()), /预占已过期/);
  assert.equal((await b.service.getMemberCloudQuota('a')).usedBytes, 0);
  assert.equal(fs.readdirSync(path.join(b.root, 'uploads/apps')).length, 0);
  const c = setup(t);
  const saved = await c.service.uploadMemberCloudPackage('a', c.input());
  c.accounts.get('a').packages[0].previewExpiresAt = new Date(0);
  const legacy = path.join(c.root, 'uploads/apps/legacy'); fs.mkdirSync(legacy);
  assert.equal((await c.service.listMemberCloudPackages('a')).total, 0);
  assert.equal(fs.existsSync(path.join(c.root, 'uploads/apps', saved.appSlug)), false);
  assert.ok(fs.existsSync(legacy));
});

test('real ZIP records a stable preview; list does not rotate token, and deletion immediately revokes access', async t => {
  const a = setup(t, true);
  const source = path.join(a.root, 'source'); fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'index.html'), 'cloud preview');
  const zip = path.join(a.root, 'input.zip');
  require('node:child_process').execFileSync('zip', ['-q', zip, 'index.html'], { cwd: source });
  const size = fs.statSync(zip).size;
  const result = await a.service.uploadMemberCloudPackage('a', { file: { path: zip, originalname: 'demo.zip' }, appName: 'demo', appId: 'owned-catalog-app' });
  assert.match(result.appSlug, /^preview-/);
  assert.equal(result.packageSize, size);
  assert.equal((await a.service.listMemberCloudPackages('a')).list[0].previewUrl, result.previewUrl);
  const Koa = require('koa'); const app = new Koa();
  app.use(load('middleware/appPackagePreview.ts', {}, a.root).appPackagePreviewMiddleware);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => { server.closeAllConnections(); server.close(); });
  await new Promise(r => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}${new URL(result.previewUrl).pathname}`;
  assert.equal(await (await fetch(url)).text(), 'cloud preview');
  await a.service.deleteMemberCloudPackage('a', result.appSlug);
  assert.equal((await fetch(url)).status, 404);
});

test('actual routes support API-key aliases and rotation, preserve JWT catalog, and reject oversized multipart files', async t => {
  const a = setup(t, true);
  const auth = {
    getBearerToken: ctx => String(ctx.headers.authorization || '').replace(/^Bearer /, ''),
    requireUser: async ctx => {
      if (ctx.headers.authorization !== 'Bearer jwt-a') throw new Error('未登录');
      return { _id: 'a', role: 'user' };
    }
  };
  const documentService = { authenticateDocumentApiKey: async header => {
    const key = header.replace(/^Bearer\s+/i, '');
    if (['sk-a', 'sk-a-rotated'].includes(key)) return { userId: 'a' };
    if (key === 'sk-b') return { userId: 'b' };
    throw new Error('API Key 无效');
  } };
  const users = { findById: async id => ({ _id: id, role: 'user' }) };
  const cloudController = load('controllers/memberCloudSpaceController.ts', {
    '@/middleware/auth': auth, '@/services/documentService': documentService,
    '@/models/User': users, '@/services/memberCloudSpaceService': a.service, '@/utils/tool': a.tool
  }, a.root);
  let membership = true;
  const catalogController = load('controllers/appCatalogController.ts', {
    '@/services/memberCloudSpaceService': a.service,
    '@/controllers/memberCloudSpaceController': cloudController,
    '@/services/appCatalogService': {
      listAppsPaged: async (_, viewer) => ({ list: [{ name: viewer ? 'jwt catalog' : 'public catalog' }], total: 1 }),
      authorizeMemberPackageUpload: async () => { throw new Error('cloud must not consume catalog slots'); },
      assertMemberOwnsAppOrAdmin: async () => {}, deleteApp: async id => ({ id })
    },
    '@/services/appCoverService': {}, '@/services/appCatalogMediaService': {},
    '@/services/appPackageService': a.packageService, '@/middleware/auth': auth, '@/models/User': users,
    '@/services/authService': { verifyAccessToken: async token => { if (token !== 'jwt-a') throw new Error('invalid JWT'); return { sub: 'a' }; } },
    '@/services/memberService': { isMemberActive: async () => membership },
    '@/services/memberUploadCategoryService': {}, '@/services/documentService': documentService, '@/utils/tool': a.tool
  }, a.root);
  const noop = async () => {};
  const register = load('routers/appCatalog.ts', {
    '@/controllers/appCatalogController': catalogController,
    '@/controllers/memberCloudSpaceController': cloudController,
    '@/services/appPackageService': a.packageService,
    '@/services/appCoverService': { appCoverUpload: { single: () => noop } },
    '@/services/appCatalogMediaService': { appCatalogMediaUpload: { single: () => noop } },
    '@/controllers/appTemporaryLinkController': Object.fromEntries(['deleteAppTemporaryLink', 'getAppTemporaryLinks', 'getTemporaryLinkPreview', 'postAppTemporaryLink', 'postTemporaryLinkClaim'].map(name => [name, noop]))
  }, a.root).default;
  const Koa = require('koa'); const Router = require('@koa/router');
  const router = new Router(); register(router);
  const app = new Koa(); app.use(router.routes());
  const server = app.listen(0, '127.0.0.1');
  t.after(() => { server.closeAllConnections(); server.close(); });
  await new Promise(r => server.once('listening', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, key, method = 'GET') => (await fetch(origin + route, { method, headers: key ? { Authorization: 'Bearer ' + key } : {} })).json();
  const source = path.join(a.root, 'source'); fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'index.html'), 'route preview');
  const zip = path.join(a.root, 'route.zip');
  require('node:child_process').execFileSync('zip', ['-q', zip, 'index.html'], { cwd: source });
  const send = async (key, bytes = fs.readFileSync(zip)) => {
    const form = new FormData(); form.append('appName', 'route preview'); form.append('file', new Blob([bytes]), 'demo.zip');
    return (await fetch(origin + '/api/apps/upload-package/api-key', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form })).json();
  };
  const uploaded = await send('sk-a'); assert.equal(uploaded.code, 200);
  for (const route of ['/api/apps', '/api/previews']) {
    const list = await request(route, 'sk-a-rotated');
    assert.equal(list.data.total, 1); assert.equal(list.data.list[0].previewUrl, uploaded.data.previewUrl);
    assert.equal((await request(route, 'sk-b')).data.total, 0);
    assert.equal((await request(route, 'sk-invalid')).code, -1);
  }
  for (const route of ['/api/apps/quota', '/api/previews/quota']) {
    const response = await request(route, 'sk-a');
    assert.equal(response.code, 200); assert.equal(response.data.usedBytes, fs.statSync(zip).size);
    assert.equal(response.data.limitBytes, 50 * 1024 * 1024);
    assert.equal((await request(route)).code, -1);
  }
  assert.equal((await request('/api/apps', 'jwt-a')).data.list[0].name, 'jwt catalog');
  assert.equal((await request('/api/apps')).data.list[0].name, 'public catalog');
  assert.equal((await request('/api/apps/catalog-id', 'jwt-a', 'DELETE')).code, 200);
  assert.equal((await request('/api/apps/' + uploaded.data.appSlug, 'sk-b', 'DELETE')).code, -1);
  membership = false;
  assert.equal((await send('sk-a')).code, -1);
  assert.equal((await request('/api/previews', 'sk-a')).data.total, 1);
  assert.equal((await request('/api/apps/' + uploaded.data.appSlug, 'sk-a-rotated', 'DELETE')).code, 200);
  assert.equal((await request('/api/apps', 'sk-a')).data.total, 0);
  membership = true;
  const large = await send('sk-a', new Uint8Array(50 * 1024 * 1024 + 1));
  assert.equal(large.code, -1); assert.match(large.error, /50MB/);
  assert.equal(fs.readdirSync(path.join(a.root, 'uploads/.tmp/apps')).length, 0);
});


test('ambiguous database commit failure rolls back files and capacity', async t => {
  const a = setup(t);
  const update = a.model.updateOne;
  a.model.updateOne = async (filter, value, options) => {
    const result = await update(filter, value, options);
    if (filter.packages) throw new Error('connection lost after write');
    return result;
  };
  await assert.rejects(a.service.uploadMemberCloudPackage('a', a.input()), /connection lost/);
  assert.equal((await a.service.getMemberCloudQuota('a')).usedBytes, 0);
  assert.equal((await a.service.listMemberCloudPackages('a')).total, 0);
  assert.equal(fs.readdirSync(path.join(a.root, 'uploads/apps')).length, 0);
});

test('uncompressed-size limit rejects ZIP before extraction and cleans staging', async t => {
  const a = setup(t);
  const childProcess = require('node:child_process');
  let extractionAttempted = false;
  const service = load('services/appPackageService.ts', {
    '@/services/appCatalogService': { resolveAppSlug: async () => 'demo' }, '@/utils/tool': a.tool,
    child_process: { execFileSync: (command, args, options) => {
      if (args[0] === '-Z' && args[1] === '-t') return '2 files, 209715201 bytes uncompressed';
      if (args[0] === '-q') extractionAttempted = true;
      return childProcess.execFileSync(command, args, options);
    } }
  }, a.root);
  const source = path.join(a.root, 'source'); fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'index.html'), 'zip size limit');
  const zip = path.join(a.root, 'input.zip');
  childProcess.execFileSync('zip', ['-q', zip, 'index.html'], { cwd: source });
  await assert.rejects(service.uploadAppPackage({ file: { path: zip, originalname: 'demo.zip' }, appName: 'demo', createPreview: true }), /200MB/);
  assert.equal(extractionAttempted, false);
  assert.equal(fs.readdirSync(path.join(a.root, 'uploads/.tmp/apps')).length, 0);
  assert.equal(fs.readdirSync(path.join(a.root, 'uploads/apps')).length, 0);
});
