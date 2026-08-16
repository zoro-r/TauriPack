import type Router from '@koa/router';
import {
  assertMemberOwnsAppOrAdmin,
  authorizeMemberPackageUpload,
  canUserAccessApp,
  createApp,
  createCategory,
  deleteApp,
  deleteCategory,
  getAppDetailForViewer,
  listAppsPaged,
  listCategories,
  updateApp,
  updateCategory,
  type AppItemInput,
  type AppListQuery,
  type CategoryInput
} from '@/services/appCatalogService';
import { type UploadedCoverFile, uploadAppCover } from '@/services/appCoverService';
import {
  type UploadedCatalogMediaFile,
  normalizeCatalogMediaKind,
  uploadAppCatalogMedia
} from '@/services/appCatalogMediaService';
import { type UploadedPackageFile, uploadAppPackage } from '@/services/appPackageService';
import { getBearerToken, requireAdmin, requireUser } from '@/middleware/auth';
import UserModel from '@/models/User';
import { verifyAccessToken } from '@/services/authService';
import { isMemberActive } from '@/services/memberService';
import { getMemberAppQuota } from '@/services/memberService';
import { ensureMemberUploadCategoryId } from '@/services/memberUploadCategoryService';
import { error as errorResponse, success } from '@/utils/tool';

export const getCategoryList = async (ctx: Router.RouterContext) => {
  try {
    ctx.body = success(await listCategories());
  } catch (err) {
    ctx.body = errorResponse('get categories failed', err);
  }
};

export const postCategory = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    const body = (ctx.request.body || {}) as CategoryInput;
    ctx.body = success(await createCategory(body), 'category created');
  } catch (err) {
    ctx.body = errorResponse('create category failed', err);
  }
};

export const putCategory = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    const body = (ctx.request.body || {}) as CategoryInput;
    ctx.body = success(await updateCategory(String(ctx.params.id || ''), body), 'category updated');
  } catch (err) {
    ctx.body = errorResponse('update category failed', err);
  }
};

export const removeCategory = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    ctx.body = success(await deleteCategory(String(ctx.params.id || '')), 'category deleted');
  } catch (err) {
    ctx.body = errorResponse('delete category failed', err);
  }
};

export const getAppList = async (ctx: Router.RouterContext) => {
  try {
    const query = ctx.query as unknown as AppListQuery & { page?: string; pageSize?: string };
    const token = getBearerToken(ctx);
    let viewer:
      | {
          userId?: string;
          role?: 'user' | 'admin';
        }
      | undefined;

    if (token) {
      try {
        const payload = await verifyAccessToken(token);
        const user = await requireUser(ctx);
        viewer = { userId: payload.sub, role: user.role };
      } catch {
        viewer = undefined;
      }
    }

    const pageParsed = query.page !== undefined ? Number(query.page) : undefined;
    const pageSizeParsed = query.pageSize !== undefined ? Number(query.pageSize) : undefined;

    ctx.body = success(
      await listAppsPaged(
        {
          categoryId: query.categoryId,
          keyword: query.keyword,
          page: pageParsed !== undefined && Number.isFinite(pageParsed) ? pageParsed : undefined,
          pageSize:
            pageSizeParsed !== undefined && Number.isFinite(pageSizeParsed) ? pageSizeParsed : undefined
        },
        viewer
      )
    );
  } catch (err) {
    ctx.body = errorResponse('get apps failed', err);
  }
};

export const getAppById = async (ctx: Router.RouterContext) => {
  try {
    const id = String(ctx.params.id || '');
    const token = getBearerToken(ctx);
    let viewer: { userId: string; role: 'admin' | 'user' } | undefined;
    if (token) {
      try {
        const payload = await verifyAccessToken(token);
        const user = await UserModel.findById(payload.sub).lean();
        if (user) {
          viewer = { userId: user._id.toString(), role: user.role };
        }
      } catch {
        viewer = undefined;
      }
    }
    ctx.body = success(await getAppDetailForViewer(id, viewer));
  } catch (err) {
    ctx.body = errorResponse('get app failed', err);
  }
};

export const getAppAccess = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    ctx.body = success(await canUserAccessApp(user._id.toString(), String(ctx.params.id || '')));
  } catch (err) {
    ctx.body = errorResponse('get app access failed', err);
  }
};

export const postApp = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    const body = (ctx.request.body || {}) as AppItemInput;
    if (user.role === 'admin') {
      ctx.body = success(await createApp(body), 'app created');
      return;
    }
    if (!(await isMemberActive(user._id.toString()))) {
      throw new Error('需要有效会员身份');
    }
    const quota = await getMemberAppQuota(user._id.toString());
    if (quota.availableSlotCount <= 0) {
      throw new Error('应用坑位已用完，请先购买坑位套餐');
    }
    const categoryId = await ensureMemberUploadCategoryId();
    ctx.body = success(
      await createApp({ ...body, categoryId }, user._id.toString()),
      'app created'
    );
  } catch (err) {
    ctx.body = errorResponse('create app failed', err);
  }
};

export const postAppPackage = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    const file = ctx.file as UploadedPackageFile | undefined;
    const body = (ctx.request.body || {}) as { appName?: string; appId?: string };
    const appId = body.appId ? String(body.appId) : undefined;
    await authorizeMemberPackageUpload({
      userId: user._id.toString(),
      role: user.role,
      appId
    });
    ctx.body = success(
      await uploadAppPackage({
        file: file as UploadedPackageFile,
        appName: String(body.appName || ''),
        appId
      }),
      'app package uploaded'
    );
  } catch (err) {
    ctx.body = errorResponse('upload app package failed', err);
  }
};

export const postAppCover = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    if (user.role !== 'admin' && !(await isMemberActive(user._id.toString()))) {
      throw new Error('需要有效会员身份');
    }
    const file = ctx.file as UploadedCoverFile | undefined;
    ctx.body = success(await uploadAppCover(file), 'app cover uploaded');
  } catch (err) {
    ctx.body = errorResponse('upload app cover failed', err);
  }
};

export const postAppCatalogMedia = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    if (user.role !== 'admin' && !(await isMemberActive(user._id.toString()))) {
      throw new Error('需要有效会员身份');
    }
    const file = ctx.file as UploadedCatalogMediaFile | undefined;
    const body = (ctx.request.body || {}) as { fileType?: string };
    const kind = normalizeCatalogMediaKind(body.fileType);
    ctx.body = success(await uploadAppCatalogMedia(file, kind), 'media uploaded');
  } catch (err) {
    ctx.body = errorResponse('upload catalog media failed', err);
  }
};

export const putApp = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    const id = String(ctx.params.id || '');
    await assertMemberOwnsAppOrAdmin(user._id.toString(), user.role, id);
    const body = (ctx.request.body || {}) as AppItemInput;
    if (user.role !== 'admin') {
      body.accessLevel = 'owner';
      body.categoryId = await ensureMemberUploadCategoryId();
    }
    ctx.body = success(await updateApp(id, body), 'app updated');
  } catch (err) {
    ctx.body = errorResponse('update app failed', err);
  }
};

export const removeApp = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    const id = String(ctx.params.id || '');
    await assertMemberOwnsAppOrAdmin(user._id.toString(), user.role, id);
    ctx.body = success(await deleteApp(id), 'app deleted');
  } catch (err) {
    ctx.body = errorResponse('delete app failed', err);
  }
};
