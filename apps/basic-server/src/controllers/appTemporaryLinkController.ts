import type Router from '@koa/router';
import { requireUser } from '@/middleware/auth';
import {
  claimAppTemporaryLink,
  createAppTemporaryLink,
  listAppTemporaryLinks,
  previewAppTemporaryLink,
  revokeAppTemporaryLink,
  temporaryAppCookieName
} from '@/services/appTemporaryLinkService';
import { error as errorResponse, fail, success } from '@/utils/tool';

export const postAppTemporaryLink = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    const body = (ctx.request.body || {}) as { expiresAt?: string; remark?: string };
    if (!body.expiresAt) {
      ctx.body = fail('expiresAt is required');
      return;
    }
    ctx.body = success(
      await createAppTemporaryLink({
        appId: String(ctx.params.id || ''),
        userId: user._id.toString(),
        role: user.role,
        expiresAt: body.expiresAt,
        remark: body.remark
      }),
      '临时链接已生成'
    );
  } catch (err) {
    ctx.body = errorResponse('create temporary app link failed', err);
  }
};

export const getAppTemporaryLinks = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    ctx.body = success(
      await listAppTemporaryLinks({
        appId: String(ctx.params.id || ''),
        userId: user._id.toString(),
        role: user.role
      })
    );
  } catch (err) {
    ctx.body = errorResponse('get temporary app links failed', err);
  }
};

export const deleteAppTemporaryLink = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    ctx.body = success(
      await revokeAppTemporaryLink({
        appId: String(ctx.params.id || ''),
        linkId: String(ctx.params.linkId || ''),
        userId: user._id.toString(),
        role: user.role
      }),
      '临时链接已失效'
    );
  } catch (err) {
    ctx.body = errorResponse('revoke temporary app link failed', err);
  }
};

export const getTemporaryLinkPreview = async (ctx: Router.RouterContext) => {
  try {
    const body = (ctx.request.body || {}) as { token?: string };
    ctx.body = success(await previewAppTemporaryLink(String(body.token || '')));
  } catch (err) {
    ctx.body = errorResponse('preview temporary app link failed', err);
  }
};

export const postTemporaryLinkClaim = async (ctx: Router.RouterContext) => {
  try {
    const body = (ctx.request.body || {}) as { token?: string };
    const token = String(body.token || '');
    const result = await claimAppTemporaryLink(token);
    const remainingMs = Math.max(0, new Date(result.expiresAt).getTime() - Date.now());
    ctx.cookies.set(temporaryAppCookieName(result.appId), token, {
      httpOnly: true,
      // Koa 会在当前请求未被识别为 HTTPS 时拒绝写入 Secure Cookie。
      // 部署在 Nginx 后且未传 X-Forwarded-Proto 时 ctx.secure 为 false，
      // 因此以 Koa 实际识别的协议为准，HttpOnly/SameSite/路径限制仍然生效。
      secure: ctx.secure,
      sameSite: 'lax',
      overwrite: true,
      path: `/static/apps/`,
      maxAge: remainingMs
    });
    ctx.body = success({ entryUrl: result.entryUrl, expiresAt: result.expiresAt }, '临时访问权限已生效');
  } catch (err) {
    ctx.body = errorResponse('claim temporary app link failed', err);
  }
};
