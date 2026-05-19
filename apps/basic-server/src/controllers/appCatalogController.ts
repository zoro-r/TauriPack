import type Router from '@koa/router';
import {
  canUserAccessApp,
  createApp,
  createCategory,
  deleteApp,
  deleteCategory,
  getAppDetail,
  listApps,
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
import { verifyAccessToken } from '@/services/authService';
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
    const query = ctx.query as unknown as AppListQuery;
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

    ctx.body = success(
      await listApps({
        categoryId: query.categoryId,
        keyword: query.keyword
      }, viewer)
    );
  } catch (err) {
    ctx.body = errorResponse('get apps failed', err);
  }
};

export const getAppById = async (ctx: Router.RouterContext) => {
  try {
    ctx.body = success(await getAppDetail(String(ctx.params.id || '')));
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
    await requireAdmin(ctx);
    const body = (ctx.request.body || {}) as AppItemInput;
    ctx.body = success(await createApp(body), 'app created');
  } catch (err) {
    ctx.body = errorResponse('create app failed', err);
  }
};

export const postAppPackage = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    const file = ctx.file as UploadedPackageFile | undefined;
    const body = (ctx.request.body || {}) as { appName?: string; appId?: string };
    ctx.body = success(
      await uploadAppPackage({
        file: file as UploadedPackageFile,
        appName: String(body.appName || ''),
        appId: body.appId ? String(body.appId) : undefined
      }),
      'app package uploaded'
    );
  } catch (err) {
    ctx.body = errorResponse('upload app package failed', err);
  }
};

export const postAppCover = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    const file = ctx.file as UploadedCoverFile | undefined;
    ctx.body = success(await uploadAppCover(file), 'app cover uploaded');
  } catch (err) {
    ctx.body = errorResponse('upload app cover failed', err);
  }
};

export const postAppCatalogMedia = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
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
    await requireAdmin(ctx);
    const body = (ctx.request.body || {}) as AppItemInput;
    ctx.body = success(await updateApp(String(ctx.params.id || ''), body), 'app updated');
  } catch (err) {
    ctx.body = errorResponse('update app failed', err);
  }
};

export const removeApp = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    ctx.body = success(await deleteApp(String(ctx.params.id || '')), 'app deleted');
  } catch (err) {
    ctx.body = errorResponse('delete app failed', err);
  }
};
