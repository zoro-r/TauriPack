import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import AppCategoryModel from '@/models/AppCategory';
import AppItemModel from '@/models/AppItem';
import MemberAccountModel from '@/models/MemberAccount';
import UserAppEntitlementModel from '@/models/UserAppEntitlement';

export interface CategoryInput {
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  sort?: number;
  isActive?: boolean;
}

export interface AppMediaInput {
  type: 'image' | 'video';
  url: string;
  poster?: string;
  caption?: string;
  sort?: number;
}

export interface AppItemInput {
  name: string;
  categoryId: string;
  accessLevel?: 'login' | 'member' | 'explicit';
  summary?: string;
  description?: string;
  cover?: string;
  publisher?: string;
  content?: string;
  media?: AppMediaInput[];
  slug?: string;
  packageName?: string;
  packageUrl?: string;
  entryUrl?: string;
}

export interface AppListQuery {
  categoryId?: string;
  keyword?: string;
}

export interface AppListViewer {
  userId?: string;
  role?: 'user' | 'admin';
}

const normalizeText = (value?: string) => value?.trim() || undefined;

const normalizeAppMediaItems = (items?: AppMediaInput[]) => {
  if (!items?.length) {
    return [];
  }
  const rows = items
    .filter((item) => item && typeof item.url === 'string' && item.url.trim())
    .map((item, index) => ({
      type: item.type === 'video' ? ('video' as const) : ('image' as const),
      url: item.url.trim(),
      poster: normalizeText(item.poster),
      caption: normalizeText(item.caption),
      sort: typeof item.sort === 'number' ? item.sort : index
    }));
  rows.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  return rows;
};

const ensureObjectId = (value: string, label: string) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new Error(`${label} is invalid`);
  }
};

const ensureCategoryExists = async (categoryId: string) => {
  const category = await AppCategoryModel.findById(categoryId).lean();
  if (!category) {
    throw new Error('category not found');
  }
};

const ensureUniqueCategorySlug = async (slug: string, excludeId?: string) => {
  const existing = await AppCategoryModel.findOne({
    slug,
    ...(excludeId ? { _id: { $ne: excludeId } } : {})
  }).lean();
  if (existing) {
    throw new Error('category slug already exists');
  }
};

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

const appUploadRoot = path.join(process.cwd(), 'uploads', 'apps');

const buildUniqueAppSlug = async (name: string, excludeId?: string) => {
  const base = slugify(name) || 'app';
  let slug = base;
  let counter = 1;
  while (true) {
    const existing = await AppItemModel.findOne({
      slug,
      ...(excludeId ? { _id: { $ne: excludeId } } : {})
    }).lean();
    if (!existing) {
      return slug;
    }
    slug = `${base}-${counter}`;
    counter += 1;
  }
};

export const resolveAppSlug = async (name: string, appId?: string) => {
  if (appId) {
    ensureObjectId(appId, 'appId');
    const existing = await AppItemModel.findById(appId).lean();
    if (!existing) {
      throw new Error('app not found');
    }
    return existing.slug;
  }
  return buildUniqueAppSlug(name);
};

const mapCategoryInput = (input: CategoryInput) => ({
  name: input.name.trim(),
  slug: input.slug.trim(),
  description: normalizeText(input.description),
  icon: normalizeText(input.icon),
  sort: typeof input.sort === 'number' ? input.sort : 0,
  isActive: typeof input.isActive === 'boolean' ? input.isActive : true
});

const mapAppPayloadBase = (input: AppItemInput) => ({
  name: input.name.trim(),
  categoryId: input.categoryId,
  accessLevel: input.accessLevel || 'login',
  summary: normalizeText(input.summary),
  description: normalizeText(input.description),
  cover: normalizeText(input.cover),
  publisher: normalizeText(input.publisher),
  content: normalizeText(input.content),
  packageName: normalizeText(input.packageName),
  packageUrl: normalizeText(input.packageUrl),
  entryUrl: normalizeText(input.entryUrl)
});

const mapAppPayloadForCreate = (input: AppItemInput) => ({
  ...mapAppPayloadBase(input),
  media: normalizeAppMediaItems(input.media)
});

/** 更新时若不传 media 字段则保留库里原有条目，避免无意间清空 */
const mapAppPayloadForUpdate = (input: AppItemInput) => ({
  ...mapAppPayloadBase(input),
  ...(input.media !== undefined ? { media: normalizeAppMediaItems(input.media) } : {})
});

const validateCategoryInput = (input: Partial<CategoryInput>) => {
  if (!normalizeText(input.name)) {
    throw new Error('name is required');
  }
  if (!normalizeText(input.slug)) {
    throw new Error('slug is required');
  }
};

const validateAppInput = (input: Partial<AppItemInput>) => {
  if (!normalizeText(input.name)) {
    throw new Error('name is required');
  }
  if (!normalizeText(input.categoryId)) {
    throw new Error('categoryId is required');
  }
  ensureObjectId(input.categoryId as string, 'categoryId');
};

export const listCategories = async () => {
  return AppCategoryModel.find()
    .sort({ sort: 1, createdAt: -1 })
    .lean();
};

export const createCategory = async (input: CategoryInput) => {
  validateCategoryInput(input);
  const payload = mapCategoryInput(input);
  await ensureUniqueCategorySlug(payload.slug);
  return AppCategoryModel.create(payload);
};

export const updateCategory = async (id: string, input: CategoryInput) => {
  ensureObjectId(id, 'categoryId');
  validateCategoryInput(input);
  const payload = mapCategoryInput(input);
  await ensureUniqueCategorySlug(payload.slug, id);
  const category = await AppCategoryModel.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true
  });
  if (!category) {
    throw new Error('category not found');
  }
  return category;
};

export const deleteCategory = async (id: string) => {
  ensureObjectId(id, 'categoryId');
  const relatedCount = await AppItemModel.countDocuments({ categoryId: id });
  if (relatedCount > 0) {
    throw new Error('category has related apps');
  }
  const category = await AppCategoryModel.findByIdAndDelete(id);
  if (!category) {
    throw new Error('category not found');
  }
  return { id };
};

export const listApps = async (query: AppListQuery, viewer?: AppListViewer) => {
  const filter: Record<string, unknown> = {};

  if (query.categoryId) {
    ensureObjectId(query.categoryId, 'categoryId');
    filter.categoryId = query.categoryId;
  }
  if (query.keyword?.trim()) {
    filter.$or = [
      { name: { $regex: query.keyword.trim(), $options: 'i' } },
      { summary: { $regex: query.keyword.trim(), $options: 'i' } },
      { description: { $regex: query.keyword.trim(), $options: 'i' } },
      { publisher: { $regex: query.keyword.trim(), $options: 'i' } },
      { content: { $regex: query.keyword.trim(), $options: 'i' } }
    ];
  }

  if (viewer?.role !== 'admin') {
    if (!viewer?.userId) {
      filter.accessLevel = { $in: [] };
    } else {
      const entitlementItems = await UserAppEntitlementModel.find({
        userId: viewer.userId,
        status: 'active',
        $or: [{ expiredAt: { $exists: false } }, { expiredAt: null }, { expiredAt: { $gt: new Date() } }]
      })
        .select('appId')
        .lean();
      const entitlementAppIds = entitlementItems.map((item) => item.appId);

      filter.$and = [
        {
          $or: [
            { accessLevel: 'login' },
            { accessLevel: 'member' },
            ...(entitlementAppIds.length ? [{ _id: { $in: entitlementAppIds } }] : [])
          ]
        }
      ];
    }
  }

  return AppItemModel.find(filter)
    .populate('categoryId', 'name slug icon sort isActive')
    .sort({ createdAt: -1 })
    .lean();
};

const isMemberActive = async (userId: string) => {
  const account = await MemberAccountModel.findOne({ userId }).lean();
  if (!account?.isMember || account.status !== 'active') {
    return false;
  }
  if (account.expiredAt && account.expiredAt.getTime() < Date.now()) {
    return false;
  }
  return true;
};

export const canUserPreviewAppDetail = async (userId: string, appId: string) => {
  ensureObjectId(appId, 'appId');
  const app = await AppItemModel.findById(appId).lean();
  if (!app) {
    throw new Error('app not found');
  }
  if (app.accessLevel === 'explicit') {
    const entitlement = await UserAppEntitlementModel.findOne({
      userId,
      appId,
      status: 'active',
      $or: [{ expiredAt: { $exists: false } }, { expiredAt: null }, { expiredAt: { $gt: new Date() } }]
    }).lean();
    return { allowed: Boolean(entitlement), reason: entitlement ? 'entitlement' : 'explicit_required', app };
  }
  if (app.accessLevel === 'member') {
    const isMember = await isMemberActive(userId);
    return { allowed: isMember, reason: isMember ? 'member' : 'member_required', app };
  }
  return { allowed: true, reason: 'login', app };
};

export const canUserAccessApp = async (userId: string, appId: string) => {
  ensureObjectId(appId, 'appId');
  const app = await AppItemModel.findById(appId).lean();
  if (!app) {
    throw new Error('app not found');
  }
  if (app.accessLevel === 'login') {
    return { allowed: true, reason: 'login', app };
  }

  const entitlement = await UserAppEntitlementModel.findOne({
    userId,
    appId,
    status: 'active',
    $or: [{ expiredAt: { $exists: false } }, { expiredAt: null }, { expiredAt: { $gt: new Date() } }]
  }).lean();
  if (entitlement) {
    return { allowed: true, reason: 'entitlement', app };
  }

  if (app.accessLevel === 'member' && (await isMemberActive(userId))) {
    return { allowed: true, reason: 'member', app };
  }

  return {
    allowed: false,
    reason: app.accessLevel === 'explicit' ? 'explicit_required' : 'member_required',
    app
  };
};

export const getAppDetail = async (id: string) => {
  ensureObjectId(id, 'appId');
  const app = await AppItemModel.findById(id)
    .populate('categoryId', 'name slug icon sort isActive')
    .lean();
  if (!app) {
    throw new Error('app not found');
  }
  return app;
};

export const createApp = async (input: AppItemInput) => {
  validateAppInput(input);
  const payload = mapAppPayloadForCreate(input);
  const slug = normalizeText(input.slug) || (await buildUniqueAppSlug(payload.name));
  await ensureCategoryExists(payload.categoryId);
  const existing = await AppItemModel.findOne({ slug }).lean();
  if (existing) {
    throw new Error('app slug already exists');
  }
  return AppItemModel.create({ ...payload, slug });
};

export const updateApp = async (id: string, input: AppItemInput) => {
  ensureObjectId(id, 'appId');
  validateAppInput(input);
  const payload = mapAppPayloadForUpdate(input);
  await ensureCategoryExists(payload.categoryId);
  const existing = await AppItemModel.findById(id).lean();
  if (!existing) {
    throw new Error('app not found');
  }
  const app = await AppItemModel.findByIdAndUpdate(id, { ...payload, slug: existing.slug }, {
    new: true,
    runValidators: true
  });
  if (!app) {
    throw new Error('app not found');
  }
  return app;
};

export const deleteApp = async (id: string) => {
  ensureObjectId(id, 'appId');
  const app = await AppItemModel.findByIdAndDelete(id);
  if (!app) {
    throw new Error('app not found');
  }
  const uploadDir = path.join(appUploadRoot, app.slug);
  if (fs.existsSync(uploadDir)) {
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
  return { id };
};
