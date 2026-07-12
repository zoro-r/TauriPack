import type Router from '@koa/router';
import {
  createDevLoginTokens,
  createLoginState,
  exchangeLoginCode,
  getLoginStatus,
  getCurrentUser,
  getNavMenus,
  getWechatClientSuccessUrl,
  handleWechatCallback,
  logout,
  refreshTokens
} from '@/services/authService';
import { error as errorResponse, fail, success } from '@/utils/tool';

const buildCookieOptions = (ctx: Router.RouterContext, maxAge?: number) => {
  const forwardedProto = String(ctx.get('x-forwarded-proto') || '').toLowerCase();
  const isSecureRequest = ctx.secure || forwardedProto.includes('https');
  const sameSite = isSecureRequest ? 'none' : 'lax';
  return {
    httpOnly: true,
    sameSite,
    secure: isSecureRequest,
    overwrite: true,
    path: '/',
    ...(typeof maxAge === 'number' ? { maxAge } : {})
  } as const;
};

const clearSessionCookies = (ctx: Router.RouterContext) => {
  const options = buildCookieOptions(ctx, 0);
  ctx.cookies.set('accessToken', '', options);
  ctx.cookies.set('refreshToken', '', options);
};

export const getWechatQr = async (ctx: Router.RouterContext) => {
  try {
    const payload = await createLoginState();
    ctx.body = success(payload);
  } catch (err) {
    console.error('WeChat QR failed:', err);
    ctx.body = errorResponse('微信二维码失败', err);
  }
};

export const wechatCallback = async (ctx: Router.RouterContext) => {
  const code = String(ctx.query.code || '');
  const state = String(ctx.query.state || '');
  console.info('[wechatCallback] received', {
    codePresent: Boolean(code),
    state,
    ip: ctx.ip,
    ua: ctx.get('user-agent')
  });
  if (!code || !state) {
    ctx.body = fail('code and state are required');
    return;
  }
  const startedAt = Date.now();
  await handleWechatCallback(code, state);
  console.info('[wechatCallback] success', {
    state,
    durationMs: Date.now() - startedAt
  });
  ctx.redirect(getWechatClientSuccessUrl(state));
};

export const getWechatStatus = async (ctx: Router.RouterContext) => {
  const state = String(ctx.query.state || '');
  if (!state) {
    ctx.body = fail('state is required');
    return;
  }
  ctx.body = success(await getLoginStatus(state));
};

export const exchangeToken = async (ctx: Router.RouterContext) => {
  const body = ctx.request.body as
    | { loginCode?: string; deviceId?: string; deviceType?: string }
    | undefined;
  if (!body?.loginCode) {
    ctx.body = fail('loginCode is required');
    return;
  }
  try {
    const tokenData = await exchangeLoginCode(body.loginCode, {
      deviceId: body.deviceId,
      deviceType: body.deviceType,
      userAgent: ctx.get('user-agent'),
      ip: ctx.ip
    });
    ctx.cookies.set(
      'accessToken',
      tokenData.accessToken,
      buildCookieOptions(ctx, tokenData.expiresIn * 1000)
    );
    ctx.cookies.set(
      'refreshToken',
      tokenData.refreshToken,
      buildCookieOptions(ctx, tokenData.expiresIn * 1000)
    );
    ctx.body = success(tokenData);
  } catch (err) {
    console.error('[auth.exchangeToken] failed', {
      loginCode: body.loginCode,
      ip: ctx.ip,
      ua: ctx.get('user-agent'),
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    });
    clearSessionCookies(ctx);
    ctx.body = errorResponse('登录失败，请重新扫码后再试', err);
  }
};

export const refreshToken = async (ctx: Router.RouterContext) => {
  const body = ctx.request.body as { refreshToken?: string } | undefined;
  const refreshTokenValue = body?.refreshToken || String(ctx.cookies.get('refreshToken') || '');
  if (!refreshTokenValue) {
    ctx.body = fail('refreshToken is required');
    return;
  }
  try {
    const tokenData = await refreshTokens(refreshTokenValue);
    ctx.cookies.set(
      'accessToken',
      tokenData.accessToken,
      buildCookieOptions(ctx, tokenData.expiresIn * 1000)
    );
    ctx.cookies.set(
      'refreshToken',
      tokenData.refreshToken,
      buildCookieOptions(ctx, tokenData.expiresIn * 1000)
    );
    ctx.body = success(tokenData);
  } catch (err) {
    clearSessionCookies(ctx);
    ctx.body = errorResponse('登录已过期，请重新登录', err);
  }
};

export const logoutToken = async (ctx: Router.RouterContext) => {
  const body = ctx.request.body as { refreshToken?: string } | undefined;
  const refreshTokenValue = body?.refreshToken || String(ctx.cookies.get('refreshToken') || '');
  try {
    if (refreshTokenValue) {
      await logout(refreshTokenValue);
    }
    clearSessionCookies(ctx);
    ctx.body = success({ success: true });
  } catch (err) {
    clearSessionCookies(ctx);
    ctx.body = errorResponse('退出登录失败', err);
  }
};

export const devLoginToken = async (ctx: Router.RouterContext) => {
  try {
    const tokenData = await createDevLoginTokens({
      deviceType: 'dev-login',
      userAgent: ctx.get('user-agent'),
      ip: ctx.ip
    });
    ctx.cookies.set(
      'accessToken',
      tokenData.accessToken,
      buildCookieOptions(ctx, tokenData.expiresIn * 1000)
    );
    ctx.cookies.set(
      'refreshToken',
      tokenData.refreshToken,
      buildCookieOptions(ctx, tokenData.expiresIn * 1000)
    );
    ctx.body = success(tokenData);
  } catch (err) {
    clearSessionCookies(ctx);
    ctx.body = errorResponse('测试登录失败', err);
  }
};

export const getMe = async (ctx: Router.RouterContext) => {
  const auth = String(ctx.headers.authorization || '');
  const token = auth.startsWith('Bearer ')
    ? auth.slice(7)
    : String(ctx.cookies.get('accessToken') || '');
  if (!token) {
    ctx.body = fail('未登录');
    return;
  }
  try {
    const user = await getCurrentUser(token);
    ctx.body = success(user);
  } catch (err) {
    ctx.body = errorResponse('登录已过期，请重新登录', err);
  }
};

export const getMenus = async (ctx: Router.RouterContext) => {
  const auth = String(ctx.headers.authorization || '');
  const token = auth.startsWith('Bearer ')
    ? auth.slice(7)
    : String(ctx.cookies.get('accessToken') || '');
  ctx.body = success(await getNavMenus(token));
};
