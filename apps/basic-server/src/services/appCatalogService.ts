import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import AppCategoryModel from '@/models/AppCategory';
import AppItemModel from '@/models/AppItem';
import UserAppEntitlementModel from '@/models/UserAppEntitlement';
import { getMemberAppQuota, isMemberActive } from '@/services/memberService';
import { MEMBER_UPLOAD_CATEGORY_SLUG } from '@/services/memberUploadCategoryService';

/** 会员自助上架数量上限（写死；后续可改为配额表） */
export const MEMBER_MAX_OWN_APPS = 1;

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
  accessLevel?: 'login' | 'member' | 'explicit' | 'owner';
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
  page?: number;
  pageSize?: number;
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

const DEFAULT_APP_LIST_PAGE_SIZE = 12;
const MAX_APP_PAGE_SIZE_NON_ADMIN = 100;
const MAX_APP_PAGE_SIZE_ADMIN = 500;

const normalizeAppListPaging = (
  rawPage?: number,
  rawPageSize?: number,
  isAdminViewer?: boolean
): { page: number; pageSize: number } => {
  let page =
    typeof rawPage === 'number' && Number.isFinite(rawPage) ? Math.floor(rawPage) : 1;
  page = Math.max(1, page);

  let pageSize =
    typeof rawPageSize === 'number' && Number.isFinite(rawPageSize)
      ? Math.floor(rawPageSize)
      : DEFAULT_APP_LIST_PAGE_SIZE;

  const cap = isAdminViewer ? MAX_APP_PAGE_SIZE_ADMIN : MAX_APP_PAGE_SIZE_NON_ADMIN;
  pageSize = Math.min(Math.max(pageSize, 1), cap);
  return { page, pageSize };
};

export const buildAppListFilter = async (query: AppListQuery, viewer?: AppListViewer) => {
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

      const visibilityOr: Record<string, unknown>[] = [
        { accessLevel: 'login' },
        { accessLevel: 'member' },
        ...(entitlementAppIds.length ? [{ _id: { $in: entitlementAppIds } }] : [])
      ];
      if (viewer.userId) {
        visibilityOr.push({ ownerUserId: viewer.userId });
      }

      const visibilityClause = { $or: visibilityOr };
      const andConditions: Record<string, unknown>[] = [visibilityClause];

      /** 「我的应用」分类：仅本人可见本人上架项；他人上架的同分类应用一律不可见（管理员除外已在分支外） */
      const memberUploadCat = await AppCategoryModel.findOne({ slug: MEMBER_UPLOAD_CATEGORY_SLUG })
        .select('_id')
        .lean();
      if (memberUploadCat?._id) {
        const myAppsOid = memberUploadCat._id;
        const viewerOid = new mongoose.Types.ObjectId(viewer.userId);
        andConditions.push({
          $or: [
            { categoryId: { $ne: myAppsOid } },
            { ownerUserId: viewerOid },
            {
              $and: [
                { categoryId: myAppsOid },
                {
                  $or: [{ ownerUserId: { $exists: false } }, { ownerUserId: null }]
                }
              ]
            }
          ]
        });
      }

      filter.$and = andConditions;
    }
  }

  return filter;
};

export const listAppsPaged = async (query: AppListQuery, viewer?: AppListViewer) => {
  const { page, pageSize } = normalizeAppListPaging(
    query.page,
    query.pageSize,
    viewer?.role === 'admin'
  );
  const filter = await buildAppListFilter(query, viewer);
  const skip = (page - 1) * pageSize;

  const [list, total] = await Promise.all([
    AppItemModel.find(filter)
      .populate('categoryId', 'name slug icon sort isActive')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    AppItemModel.countDocuments(filter)
  ]);

  return { list, total, page, pageSize };
};

export const countAppsOwnedByUser = async (userId: string) =>
  AppItemModel.countDocuments({ ownerUserId: userId });

/** 会员上传 zip：新建时校验名额；指定 appId 时校验归属 */
export const authorizeMemberPackageUpload = async (params: {
  userId: string;
  role: 'admin' | 'user';
  appId?: string;
}) => {
  if (params.role === 'admin') {
    return;
  }
  if (!(await isMemberActive(params.userId))) {
    throw new Error('需要有效会员身份');
  }
  if (params.appId) {
    ensureObjectId(params.appId, 'appId');
    const app = await AppItemModel.findById(params.appId).lean();
    if (!app) {
      throw new Error('app not found');
    }
    if (app.ownerUserId?.toString() !== params.userId) {
      throw new Error('无权操作该应用');
    }
    return;
  }
  const quota = await getMemberAppQuota(params.userId);
  if (quota.availableSlotCount <= 0) {
    throw new Error('应用坑位已用完，请先购买坑位套餐');
  }
};

export const assertMemberOwnsAppOrAdmin = async (
  userId: string,
  role: 'admin' | 'user',
  appId: string
) => {
  if (role === 'admin') {
    return;
  }
  if (!(await isMemberActive(userId))) {
    throw new Error('需要有效会员身份');
  }
  ensureObjectId(appId, 'appId');
  const app = await AppItemModel.findById(appId).lean();
  if (!app) {
    throw new Error('app not found');
  }
  if (app.ownerUserId?.toString() !== userId) {
    throw new Error('无权操作该应用');
  }
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
  if (app.accessLevel === 'owner') {
    const ok = app.ownerUserId?.toString() === userId;
    return { allowed: ok, reason: ok ? 'login' : 'owner_required', app };
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
  if (app.accessLevel === 'owner') {
    const ok = app.ownerUserId?.toString() === userId;
    return {
      allowed: ok,
      reason: ok ? 'login' : 'owner_required',
      app
    };
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

/** 按访问级别校验详情可见性（owner 级别需登录且为本人或管理员） */
export const getAppDetailForViewer = async (
  id: string,
  viewer?: { userId: string; role: 'admin' | 'user' }
) => {
  const app = await getAppDetail(id);
  if (viewer?.role === 'admin') {
    return app;
  }
  if (app.accessLevel === 'owner') {
    if (!viewer?.userId || app.ownerUserId?.toString() !== viewer.userId) {
      throw new Error(viewer?.userId ? '无权查看：该应用已设为「仅自己可见」' : '请先登录');
    }
  }
  return app;
};

export const createApp = async (input: AppItemInput, ownerUserId?: string | null) => {
  validateAppInput(input);
  const basePayload = mapAppPayloadForCreate(input);
  const slug = normalizeText(input.slug) || (await buildUniqueAppSlug(basePayload.name));
  await ensureCategoryExists(basePayload.categoryId);
  const existing = await AppItemModel.findOne({ slug }).lean();
  if (existing) {
    throw new Error('app slug already exists');
  }
  const payload = ownerUserId ? { ...basePayload, accessLevel: 'owner' as const } : basePayload;
  if (ownerUserId) {
    ensureObjectId(ownerUserId, 'ownerUserId');
  }
  return AppItemModel.create({
    ...payload,
    slug,
    ...(ownerUserId ? { ownerUserId } : {})
  });
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
