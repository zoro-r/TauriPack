import type Router from '@koa/router';
import { previewRedeemCode, redeemCode } from '@/services/redeemService';
import { verifyAccessToken } from '@/services/authService';
import { error as errorResponse, fail, success } from '@/utils/tool';

const getUserIdFromContext = async (ctx: Router.RouterContext) => {
  const auth = String(ctx.headers.authorization || '');
  const token = auth.startsWith('Bearer ')
    ? auth.slice(7)
    : String(ctx.cookies.get('accessToken') || '');
  if (!token) {
    throw new Error('未登录');
  }
  const payload = await verifyAccessToken(token);
  return payload.sub;
};

export const postRedeem = async (ctx: Router.RouterContext) => {
  try {
    const userId = await getUserIdFromContext(ctx);
    const body = (ctx.request.body || {}) as { code?: string };
    if (!body.code?.trim()) {
      ctx.body = fail('code is required');
      return;
    }
    ctx.body = success(await redeemCode(userId, body.code), 'redeem success');
  } catch (err) {
    ctx.body = errorResponse('redeem failed', err);
  }
};

export const postRedeemPreview = async (ctx: Router.RouterContext) => {
  try {
    const userId = await getUserIdFromContext(ctx);
    const body = (ctx.request.body || {}) as { code?: string };
    if (!body.code?.trim()) {
      ctx.body = fail('code is required');
      return;
    }
    ctx.body = success(await previewRedeemCode(userId, body.code), 'redeem preview success');
  } catch (err) {
    ctx.body = errorResponse('redeem preview failed', err);
  }
};
