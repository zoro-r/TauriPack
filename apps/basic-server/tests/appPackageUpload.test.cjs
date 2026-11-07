const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const Koa = require('koa');
function load(file, deps, root, env = {}) {
  const code = ts.transpile(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true
  });
  const context = { exports: {}, URL, console, process: { cwd: () => root, env }, require: name => {
    if (Object.hasOwn(deps, name)) return deps[name];
    if (name === '@/utils/tool') return { error: (message, err) => ({ code: -1, message, error: err.message }) };
    if (name === '@/controllers/memberCloudSpaceController') return { isApiKeyRequest: () => false };
    if (name === '@/services/memberCloudSpaceService') return {
      uploadMemberCloudPackage: async (userId, input) => {
        const service = deps['@/services/appPackageService'];
        const result = await service.uploadAppPackage({ ...input, createPreview: true });
        return { ...result, previewUrl: new URL(result.previewPath, service.getAppHostingOrigin()).toString() };
      }
    };
    if (!name.startsWith('@/')) return require(name);
    throw new Error(`Unexpected dependency: ${name}`);
  }};
  vm.runInNewContext(code, context);
  return context.exports;
}
test('real ZIP upload yields immediate anonymous preview without a catalog row; token, expiry and file boundaries hold', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-upload-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = {};
  const service = load('services/appPackageService.ts', {
    '@/services/appCatalogService': { resolveAppSlug: async () => 'demo' }
  }, root, env);
  assert.equal(service.getAppHostingOrigin(), 'https://app.chaobenxueyuan.com');
  env.APP_HOSTING_ORIGIN = 'https://hosting.example.com/';
  assert.equal(service.getAppHostingOrigin(), 'https://hosting.example.com');
  for (const invalid of ['invalid', 'file:///tmp', 'https://example.com/path', 'https://user:pass@example.com', 'https://example.com/?a=1']) {
    env.APP_HOSTING_ORIGIN = invalid;
    assert.throws(() => service.getAppHostingOrigin());
  }
  delete env.APP_HOSTING_ORIGIN;
  fs.mkdirSync(path.join(root, 'source/web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'source/web/index.html'), '<html>upload regression</html>');
  fs.writeFileSync(path.join(root, 'source/web/app.js'), 'console.log(1)');
  const upload = async createPreview => {
    const zip = path.join(root, 'input.zip');
    require('node:child_process').execFileSync('zip', ['-qr', zip, 'web'], { cwd: path.join(root, 'source') });
    return service.uploadAppPackage({ file: { path: zip, originalname: 'demo.zip' }, appName: 'demo', createPreview });
  };
  const first = await upload(true);
  const second = await upload(true);
  assert.notEqual(first.appSlug, second.appSlug);
  for (const result of [first, second]) {
    for (const url of [result.packageUrl, result.entryUrl]) {
      assert.ok(fs.statSync(path.join(root, 'uploads', url.replace(/^\/static\//, ''))).isFile());
    }
  }
  const app = new Koa();
  app.use(load('middleware/appPackagePreview.ts', {}, root).appPackagePreviewMiddleware);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => { server.closeAllConnections(); server.close(); });
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(origin + first.previewPath);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<html>upload regression</html>');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await fetch(origin + first.previewPath + 'app.js')).status, 200);
  assert.equal((await fetch(origin + first.previewPath, { method: 'HEAD' })).status, 200);
  for (const suffix of ['package.zip', '.preview.json', '%2e%2e%2fpackage.zip']) {
    assert.equal((await fetch(origin + first.previewPath + suffix)).status, 404);
  }
  const wrongToken = first.previewPath.replace(/\/[a-f0-9]{64}\//, `/${'0'.repeat(64)}/`);
  assert.equal((await fetch(origin + wrongToken)).status, 404);
  const metadataPath = path.join(root, 'uploads/apps', first.appSlug, '.preview.json');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  fs.writeFileSync(metadataPath, JSON.stringify({ ...metadata, expiresAt: '2000-01-01T00:00:00Z' }));
  assert.equal((await fetch(origin + first.previewPath)).status, 404);
  const regular = await upload(false);
  assert.equal(regular.appSlug, 'demo');
  assert.equal(regular.previewPath, undefined);
});

test('both upload controllers ignore missing/local/untrusted origins; API key uses independent preview', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-controller-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = {};
  const service = load('services/appPackageService.ts', { '@/services/appCatalogService': {} }, root, env);
  let writes = 0;
  let denied = false;
  const controller = load('controllers/appCatalogController.ts', {
    '@/services/appCatalogService': { authorizeMemberPackageUpload: async () => { if (denied) throw new Error('denied'); } },
    '@/services/appCoverService': {}, '@/services/appCatalogMediaService': {},
    '@/services/appPackageService': {
      getAppHostingOrigin: service.getAppHostingOrigin,
      uploadAppPackage: async input => {
        writes++;
        return { entryUrl: '/static/apps/demo/web/index.html', ...(input.createPreview ? { previewPath: '/app-previews/demo/token/' } : {}) };
      }
    },
    '@/middleware/auth': { requireUser: async () => ({ _id: 'user', role: 'user' }) },
    '@/models/User': { findById: async () => ({ _id: 'user', role: 'user' }) },
    '@/services/authService': {}, '@/services/memberService': { isMemberActive: async () => !denied }, '@/services/memberUploadCategoryService': {},
    '@/services/documentService': { authenticateDocumentApiKey: async () => ({ userId: 'user' }) },
    '@/utils/tool': load('utils/tool.ts', {}, root)
  }, root);
  for (const origin of [undefined, '', 'http://localhost:5173', 'https://attacker.example']) {
    for (const apiKey of [false, true]) {
      const ctx = { origin, headers: { authorization: 'Bearer test' }, request: { body: { appName: 'demo' } } };
      await controller[apiKey ? 'postAppPackageWithApiKey' : 'postAppPackage'](ctx);
      assert.equal(ctx.body.code, 200);
      assert.equal(ctx.body.data.previewUrl, 'https://app.chaobenxueyuan.com' + (apiKey ? '/app-previews/demo/token/' : '/static/apps/demo/web/index.html'));
    }
  }
  const count = writes;
  env.APP_HOSTING_ORIGIN = 'invalid';
  let ctx = { headers: {}, request: { body: { appName: 'demo' } } };
  await controller.postAppPackageWithApiKey(ctx);
  assert.equal(ctx.body.code, -1);
  assert.equal(writes, count);
  delete env.APP_HOSTING_ORIGIN;
  denied = true;
  ctx = { headers: {}, request: { body: { appName: 'demo' } } };
  await controller.postAppPackageWithApiKey(ctx);
  assert.equal(ctx.body.code, -1);
  assert.equal(writes, count);
});

test('multipart API accepts expireDays and returns the exact stored expiry; invalid values fail before deployment', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-expiry-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let resolutions = 0;
  const service = load('services/appPackageService.ts', {
    '@/services/appCatalogService': { resolveAppSlug: async () => { resolutions++; return 'expiry-demo'; } }
  }, root);
  const controller = load('controllers/appCatalogController.ts', {
    '@/services/appCatalogService': { authorizeMemberPackageUpload: async () => {} },
    '@/services/appCoverService': {}, '@/services/appCatalogMediaService': {},
    '@/services/appPackageService': service,
    '@/middleware/auth': {},
    '@/models/User': { findById: async () => ({ _id: 'user', role: 'user' }) },
    '@/services/authService': {}, '@/services/memberService': { isMemberActive: async () => true }, '@/services/memberUploadCategoryService': {},
    '@/services/documentService': { authenticateDocumentApiKey: async () => ({ userId: 'user' }) },
    '@/utils/tool': load('utils/tool.ts', {}, root)
  }, root);
  const Router = require('@koa/router');
  const router = new Router();
  router.post('/api/apps/upload-package/api-key', service.appPackageUpload.single('file'), controller.postAppPackageWithApiKey);
  const app = new Koa();
  app.use(router.routes());
  const server = app.listen(0, '127.0.0.1');
  t.after(() => { server.closeAllConnections(); server.close(); });
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/apps/upload-package/api-key`;
  fs.mkdirSync(path.join(root, 'source/web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'source/web/index.html'), '<html>expiry regression</html>');
  const zip = path.join(root, 'input.zip');
  require('node:child_process').execFileSync('zip', ['-qr', zip, 'web'], { cwd: path.join(root, 'source') });
  const send = async values => {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(zip)]), 'demo.zip');
    form.append('appName', 'expiry demo');
    for (const value of values) form.append('expireDays', value);
    return (await fetch(url, { method: 'POST', body: form, headers: { Authorization: 'Bearer test' } })).json();
  };
  for (const value of [undefined, '1', '7', '30', '365']) {
    const before = Date.now();
    const response = await send(value === undefined ? [] : [value]);
    const after = Date.now();
    assert.equal(response.code, 200);
    const expectedDuration = Number(value || 1) * 86400000;
    const expiry = Date.parse(response.data.previewExpiresAt);
    assert.ok(expiry >= before + expectedDuration && expiry <= after + expectedDuration);
    const metadata = JSON.parse(fs.readFileSync(path.join(root, 'uploads/apps', response.data.appSlug, '.preview.json'), 'utf8'));
    assert.equal(metadata.expiresAt, response.data.previewExpiresAt);
  }
  const count = resolutions;
  for (const values of [[''], ['0'], ['-1'], ['1.5'], ['366'], ['NaN'], ['Infinity'], ['1e2'], ['7days'], ['7', '30']]) {
    const response = await send(values);
    assert.equal(response.code, -1, JSON.stringify(values));
    assert.match(response.error, /expireDays/);
    assert.equal(resolutions, count);
  }
});
