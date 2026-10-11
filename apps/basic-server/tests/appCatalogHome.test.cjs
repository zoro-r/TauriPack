const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const mongoose = require('mongoose');

function loadSource(file, dependencies) {
  const code = ts.transpile(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true
  });
  const context = { exports: {}, console, process, require: name => {
    if (Object.prototype.hasOwnProperty.call(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  }};
  vm.runInNewContext(code, context);
  return context.exports;
}

const ItemSchemaModel = loadSource('models/AppItem.ts', { mongoose }).default;
const oid = value => new mongoose.Types.ObjectId(value.toString(16).padStart(24, '0'));
const categoryId = oid(100);
const uploadCategoryId = oid(101);
const userId = oid(200);
const otherUserId = oid(201);
const admin = { userId: String(oid(202)), role: 'admin' };
const member = { userId: String(userId), role: 'user' };

const equal = (a, b) => a == null && b == null || String(a) === String(b);
function matches(row, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$and') return value.every(item => matches(row, item));
    if (key === '$or') return value.some(item => matches(row, item));
    if (key.startsWith('media.')) return (row.media || []).some(item => equal(item[key.split('.')[1]], value));
    const actual = row[key];
    if (value && typeof value === 'object' && !(value instanceof mongoose.Types.ObjectId) && !(value instanceof Date)) {
      return Object.entries(value).every(([op, expected]) => {
        if (op === '$exists') return (actual !== undefined) === expected;
        if (op === '$ne') return !equal(actual, expected);
        if (op === '$in') return expected.some(item => equal(actual, item));
        if (op === '$gt') return actual > expected;
        if (op === '$regex') return new RegExp(expected, value.$options).test(actual || '');
        if (op === '$options') return true;
        throw new Error(`Unsupported filter ${op}`);
      });
    }
    return equal(actual, value);
  });
}

function setup(initialRows = [], entitlements = []) {
  const rows = initialRows.map(row => ({ ...row }));
  const pipelines = [];
  const removedFiles = [];
  const itemModel = {
    find: filter => ({ cast: () => ItemSchemaModel.find(filter).cast(ItemSchemaModel) }), // Real casting, no database.
    aggregate: async pipeline => {
      pipelines.push(pipeline);
      let result = rows.map(row => ({ ...row }));
      for (const stage of pipeline) {
        if (stage.$match) result = result.filter(row => matches(row, stage.$match));
        else if (stage.$set) result = result.map(row => {
          for (const [key, value] of Object.entries(stage.$set)) row[key] ??= value.$ifNull[1];
          return row;
        });
        else if (stage.$sort) result.sort((a, b) => {
          for (const [key, direction] of Object.entries(stage.$sort)) {
            const av = a[key] instanceof mongoose.Types.ObjectId ? String(a[key]) : a[key];
            const bv = b[key] instanceof mongoose.Types.ObjectId ? String(b[key]) : b[key];
            if (av < bv) return -direction;
            if (av > bv) return direction;
          }
          return 0;
        });
        else if (stage.$skip !== undefined) result = result.slice(stage.$skip);
        else if (stage.$limit !== undefined) result = result.slice(0, stage.$limit);
        else throw new Error('Unsupported stage');
      }
      return result;
    },
    populate: async rows => rows,
    countDocuments: async filter => rows.filter(row => matches(row, filter)).length,
    findOne: filter => ({ lean: async () => rows.find(row => matches(row, filter)) || null }),
    findById: id => ({ lean: async () => rows.find(row => equal(row._id, id)) || null }),
    findByIdAndUpdate: async (id, update) => {
      const index = rows.findIndex(row => equal(row._id, id));
      if (index < 0) return null;
      rows[index] = { ...rows[index], ...(update.$set || update) };
      return rows[index];
    },
    findByIdAndDelete: async id => {
      const index = rows.findIndex(row => equal(row._id, id));
      return index < 0 ? null : rows.splice(index, 1)[0];
    },
    create: async data => { const row = { ...data, _id: oid(999) }; rows.push(row); return row; },
    exists: async filter => rows.some(row => matches(row, filter))
  };
  const service = loadSource('services/appCatalogService.ts', {
    mongoose,
    fs: { existsSync: () => true, unlinkSync: file => removedFiles.push(file), rmSync: () => {} },
    path,
    '@/models/AppCategory': {
      findOne: () => ({ select: () => ({ lean: async () => ({ _id: uploadCategoryId }) }) }),
      findById: () => ({ lean: async () => ({ _id: categoryId }) })
    },
    '@/models/AppItem': itemModel,
    '@/models/UserAppEntitlement': {
      find: () => ({ select: () => ({ lean: async () => entitlements }) })
    },
    '@/models/AppTemporaryLink': { updateMany: async () => {} },
    '@/services/memberService': { getMemberAppQuota: async () => ({ availableSlotCount: 1 }), isMemberActive: async () => true },
    '@/services/memberUploadCategoryService': { MEMBER_UPLOAD_CATEGORY_SLUG: 'my-apps' }
  });
  const auth = { user: { _id: userId, role: 'user' }, token: 'test', invalid: false };
  const controller = loadSource('controllers/appCatalogController.ts', {
    '@/services/appCatalogService': service,
    '@/services/appCoverService': {},
    '@/services/appCatalogMediaService': {},
    '@/services/appPackageService': {},
    '@/middleware/auth': {
      requireUser: async () => { if (auth.invalid) throw new Error('expired'); return auth.user; },
      requireAdmin: async () => { if (auth.invalid) throw new Error('expired'); if (auth.user.role !== 'admin') throw new Error('admin required'); return auth.user; },
      getBearerToken: () => auth.token
    },
    '@/models/User': {},
    '@/services/authService': { verifyAccessToken: async () => ({ sub: String(auth.user._id) }) },
    '@/services/memberService': { isMemberActive: async () => true, getMemberAppQuota: async () => ({ availableSlotCount: 1 }) },
    '@/services/memberUploadCategoryService': { ensureMemberUploadCategoryId: async () => String(uploadCategoryId) },
    '@/services/documentService': {},
    '@/utils/tool': loadSource('utils/tool.ts', {})
  });
  return { ...service, controller, auth, rows, pipelines, removedFiles };
}

function app(id, extra = {}) {
  return { _id: oid(id), name: `App ${id}`, slug: `app-${id}`, categoryId, accessLevel: 'login', createdAt: new Date(1000), ...extra };
}
const ids = rows => rows.map(row => Number.parseInt(String(row._id), 16));

test('home excludes member uploads for admins; all and upload category retain them', async () => {
  const env = setup([app(1), app(2, { ownerUserId: userId, categoryId: uploadCategoryId, accessLevel: 'owner' })]);
  const home = await env.listAppsPaged({ scope: 'home' }, admin);
  assert.deepEqual(ids(home.list), [1]);
  assert.equal(home.total, 1);
  assert.equal((await env.listAppsPaged({}, admin)).total, 2);
  assert.deepEqual(ids((await env.listAppsPaged({ categoryId: String(uploadCategoryId) }, admin)).list), [2]);
  assert.equal(await env.listAppsPaged({ scope: 'invalid' }, admin).then(() => false, () => true), true);
});

test('sorting normalizes legacy fields before paging and breaks ties with ID', async () => {
  const env = setup([
    app(1, { isPinned: true, sortOrder: 5 }),
    app(2, { isPinned: true, sortOrder: -1 }),
    app(3),
    app(4, { isPinned: false, sortOrder: 0 }),
    app(5, { sortOrder: -2 }),
    app(6, { sortOrder: 1 })
  ]);
  const first = await env.listAppsPaged({ page: 1, pageSize: 3 }, admin);
  const second = await env.listAppsPaged({ page: 2, pageSize: 3 }, admin);
  assert.deepEqual(ids(first.list), [2, 1, 5]);
  assert.deepEqual(ids(second.list), [4, 3, 6]);
  assert.equal(first.total, 6);
  assert.equal(second.list[1].sortOrder, 0);
  assert.equal(second.list[1].isPinned, false);
  assert.equal(env.pipelines[0][2].$sort._id, -1);
});

test('home filters combine with keyword and category, including real ObjectId casting', async () => {
  const env = setup([app(1, { name: '精选应用' }), app(2, { name: '其他应用' }), app(3, { name: '精选应用', ownerUserId: userId })]);
  const data = await env.listAppsPaged({ scope: 'home', categoryId: String(categoryId), keyword: '精选' }, admin);
  assert.deepEqual(ids(data.list), [1]);
  assert.ok(env.pipelines[0][0].$match.categoryId instanceof mongoose.Types.ObjectId);
});

test('member lists preserve own uploads and entitlements without exposing other owners', async () => {
  const env = setup([
    app(1), app(2, { ownerUserId: userId, categoryId: uploadCategoryId, accessLevel: 'owner' }),
    app(3, { ownerUserId: otherUserId, categoryId: uploadCategoryId, accessLevel: 'owner' }),
    app(4, { accessLevel: 'explicit' }), app(5, { accessLevel: 'explicit' })
  ], [{ appId: oid(4) }]);
  assert.deepEqual(ids((await env.listAppsPaged({}, member)).list), [4, 2, 1]);
  assert.deepEqual(ids((await env.listAppsPaged({ scope: 'home' }, member)).list), [4, 1]);
  assert.equal((await env.listAppsPaged({}, undefined)).total, 0);
});

test('featured is independent of pinning, sorted globally and never includes uploads', async () => {
  const rows = Array.from({ length: 15 }, (_, i) => app(i + 1, { isFeatured: true, sortOrder: i }));
  rows.push(app(20, { isFeatured: true, ownerUserId: userId, accessLevel: 'owner', sortOrder: -10 }));
  rows.push(app(21, { isPinned: true, isFeatured: false }));
  rows[5].isPinned = true;
  const env = setup(rows);
  assert.deepEqual(ids(await env.listHomeFeaturedApps(admin)), Array.from({ length: 15 }, (_, i) => i + 1));
  assert.equal(env.pipelines[0].some(stage => stage.$limit), false);
  assert.equal(await env.listHomeFeaturedApps().then(rows => rows.length), 0);
});

test('featured endpoint authenticates the session and applies normal visibility', async () => {
  const env = setup([app(1, { isFeatured: true }), app(2, { isFeatured: true, accessLevel: 'explicit' }), app(3, { isFeatured: true, accessLevel: 'owner', ownerUserId: otherUserId })]);
  const ctx = {};
  await env.controller.getHomeFeaturedApps(ctx);
  assert.equal(ctx.body.code, 200);
  assert.deepEqual(ids(ctx.body.data), [1]);
  env.auth.user.role = 'admin';
  await env.controller.getHomeFeaturedApps(ctx);
  assert.deepEqual(ids(ctx.body.data), [2, 1]);
  env.auth.invalid = true;
  await env.controller.getHomeFeaturedApps(ctx);
  assert.equal(ctx.body.data.length, 0);
});

test('create and update reject every display field from ordinary members', async () => {
  const env = setup([app(1, { ownerUserId: userId })]);
  for (const [key, value] of Object.entries({ sortOrder: 0, isPinned: false, isFeatured: true, bannerImage: '' })) {
    for (const method of ['postApp', 'putApp']) {
      const ctx = { request: { body: { name: 'Changed', categoryId: String(categoryId), [key]: value } }, params: { id: String(oid(1)) } };
      await env.controller[method](ctx);
      assert.equal(ctx.body.code, -1);
      assert.match(ctx.body.error, /仅管理员/);
    }
  }
  assert.equal(env.rows[0].name, 'App 1');
  assert.equal(env.rows.length, 1);
});

test('admin saves settings; omitted fields survive old client updates; empty banner clears it', async () => {
  const env = setup([app(1)]);
  env.auth.user.role = 'admin';
  const body = { name: 'Changed', categoryId: String(categoryId), sortOrder: -3, isPinned: true, isFeatured: true, bannerImage: '/static/covers/banner.png' };
  const ctx = { request: { body }, params: { id: String(oid(1)) } };
  await env.controller.putApp(ctx);
  assert.equal(ctx.body.code, 200);
  assert.equal(env.rows[0].isPinned, true);
  assert.equal(env.rows[0].sortOrder, -3);
  await env.updateApp(String(oid(1)), { name: 'Old client edit', categoryId: String(categoryId) });
  assert.equal(env.rows[0].bannerImage, '/static/covers/banner.png');
  assert.equal(env.rows[0].isFeatured, true);
  assert.equal(env.removedFiles.length, 0);
  await env.updateApp(String(oid(1)), { name: 'Clear banner', categoryId: String(categoryId), bannerImage: '' });
  assert.equal(env.rows[0].bannerImage, '');
  assert.ok(env.removedFiles[0].endsWith('/uploads/covers/banner.png'));
});

test('invalid display values cannot be persisted and member creation cannot bypass permission', async () => {
  const env = setup([app(1)]);
  for (const fields of [{ sortOrder: 1.5 }, { sortOrder: NaN }, { isPinned: 'true' }, { isFeatured: 1 }, { bannerImage: null }]) {
    await assert.rejects(env.updateApp(String(oid(1)), { name: 'Invalid', categoryId: String(categoryId), ...fields }));
  }
  await assert.rejects(env.createApp({ name: 'Upload', categoryId: String(categoryId), isFeatured: true }, String(userId)), /仅管理员/);
});

test('shared images are retained; deletion cleans unused banners and ignores external paths', async () => {
  const shared = '/static/covers/shared.png';
  const env = setup([app(1, { cover: shared, bannerImage: '/static/covers/banner.webp' }), app(2, { bannerImage: shared })]);
  await env.deleteApp(String(oid(1)));
  assert.equal(env.removedFiles.length, 1);
  assert.ok(env.removedFiles[0].endsWith('banner.webp'));
  const external = setup([app(3, { bannerImage: 'https://example.com/image.png', cover: '/static/covers/../../secret.png' })]);
  await external.deleteApp(String(oid(3)));
  assert.equal(external.removedFiles.length, 0);
  const media = setup([app(4, { bannerImage: shared }), app(5, { media: [{ type: 'image', url: shared }] })]);
  await media.deleteApp(String(oid(4)));
  assert.equal(media.removedFiles.length, 0);
});

test('new schema defaults match legacy normalization', () => {
  const item = new ItemSchemaModel({ name: 'New', slug: 'new', categoryId });
  assert.equal(item.sortOrder, 0);
  assert.equal(item.isPinned, false);
  assert.equal(item.isFeatured, false);
});

test('quick settings require an admin session and only change the submitted flag', async () => {
  const env = setup([app(1, { isPinned: false, isFeatured: true, sortOrder: 7, bannerImage: '/static/covers/banner.png' })]);
  const ctx = { request: { body: { isPinned: true } }, params: { id: String(oid(1)) } };
  await env.controller.patchAppDisplaySettings(ctx);
  assert.equal(ctx.body.code, -1);
  assert.equal(env.rows[0].isPinned, false);
  env.auth.user.role = 'admin';
  env.auth.invalid = true;
  await env.controller.patchAppDisplaySettings(ctx);
  assert.equal(ctx.body.code, -1);
  assert.equal(env.rows[0].isPinned, false);
  env.auth.invalid = false;
  await env.controller.patchAppDisplaySettings(ctx);
  assert.equal(ctx.body.code, 200);
  assert.equal(ctx.body.data.isPinned, true);
  assert.equal(ctx.body.data.isFeatured, true);
  assert.equal(env.rows[0].name, 'App 1');
  assert.equal(env.rows[0].sortOrder, 7);
  assert.equal(env.rows[0].bannerImage, '/static/covers/banner.png');
  ctx.request.body = { isFeatured: false };
  await env.controller.patchAppDisplaySettings(ctx);
  assert.equal(ctx.body.data.isFeatured, false);
  assert.equal(ctx.body.data.isPinned, true);
  assert.equal(env.removedFiles.length, 0);
});

test('quick settings reject empty/invalid/unknown fields and missing apps', async () => {
  const env = setup([app(1, { isPinned: false, isFeatured: false })]);
  for (const input of [null, [], {}, { isPinned: undefined }, { isFeatured: null }, { isPinned: 'true' }, { isFeatured: 1 }, { isPinned: true, name: 'Overwrite' }, { sortOrder: 1 }, { $set: { isPinned: true } }]) {
    await assert.rejects(env.updateAppDisplaySettings(String(oid(1)), input));
  }
  await assert.rejects(env.updateAppDisplaySettings('invalid', { isPinned: true }), /appId is invalid/);
  await assert.rejects(env.updateAppDisplaySettings(String(oid(2)), { isPinned: true }), /app not found/);
  assert.equal(env.rows[0].isPinned, false);
  assert.equal(env.rows[0].isFeatured, false);
});

test('independent quick setting writes preserve each other and update list/featured queries', async () => {
  const env = setup([app(1), app(2)]);
  await Promise.all([
    env.updateAppDisplaySettings(String(oid(1)), { isPinned: true }),
    env.updateAppDisplaySettings(String(oid(1)), { isFeatured: true })
  ]);
  assert.equal(env.rows[0].isPinned, true);
  assert.equal(env.rows[0].isFeatured, true);
  assert.deepEqual(ids((await env.listAppsPaged({ scope: 'home' }, admin)).list), [1, 2]);
  assert.deepEqual(ids(await env.listHomeFeaturedApps(admin)), [1]);
  await env.updateAppDisplaySettings(String(oid(1)), { isPinned: false, isFeatured: false });
  assert.deepEqual(ids((await env.listAppsPaged({ scope: 'home' }, admin)).list), [2, 1]);
  assert.equal((await env.listHomeFeaturedApps(admin)).length, 0);
});
