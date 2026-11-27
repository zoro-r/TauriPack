import type Router from '@koa/router';
import {
  createDevLoginTokens,
  createLoginState,
  createOrangeSession,
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
import { getBearerToken } from '@/middleware/auth';
import { verifyAccessToken } from '@/services/authService';
import { endMemberDebugSession } from '@/services/memberDebugService';
import {
  findOrangeLoginAttempt,
  orangeBindingCookie,
  orangeBindingLifetime,
  orangeLoginOrigin,
  OrangeLoginError,
  startOrangeLogin
} from '@/services/orangeLoginService';

export const buildCookieOptions = (ctx: Router.RouterContext, maxAge?: number) => {
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

const setSessionCookies = (ctx: Router.RouterContext, tokens: Awaited<ReturnType<typeof refreshTokens>>) => {
  const options = buildCookieOptions(ctx, tokens.expiresIn * 1000);
  ctx.cookies.set('accessToken', tokens.accessToken, options);
  ctx.cookies.set('refreshToken', tokens.refreshToken, options);
};

const setOrangeBindingCookie = (ctx: Router.RouterContext, key: string) => {
  ctx.cookies.set(orangeBindingCookie, key, {
    ...buildCookieOptions(ctx, key ? orangeBindingLifetime : 0),
    secure: true,
    sameSite: 'strict'
  });
};

export const openOrangeSession = async (ctx: Router.RouterContext) => {
  ctx.set('Cache-Control', 'no-store');
  if (ctx.get('origin') !== orangeLoginOrigin) {
    ctx.body = fail('请求来源无效');
    return;
  }
  const body = ctx.request.body as { ticket?: unknown } | undefined;
  try {
    const { key, linkedUserId } = await startOrangeLogin(body?.ticket);
    if (!linkedUserId) {
      clearSessionCookies(ctx);
      setOrangeBindingCookie(ctx, key);
      ctx.body = success({ status: 'scan-required' });
      return;
    }
    // A valid existing session already belongs to the bound user.
    const access = ctx.cookies.get('accessToken');
    const current = access ? await verifyAccessToken(access).catch(() => null) : null;
    if (!current || current.sub !== linkedUserId || current.debugSessionId) {
      setSessionCookies(ctx, await createOrangeSession(linkedUserId, {
        userAgent: ctx.get('user-agent'),
        ip: ctx.ip
      }));
    }
    setOrangeBindingCookie(ctx, '');
    ctx.body = success({ status: 'signed-in' });
  } catch (err) {
    ctx.body = fail(err instanceof OrangeLoginError ? err.message : '橙子登录失败，请重试');
  }
};

export const getWechatQr = async (ctx: Router.RouterContext) => {
  try {
    const orangeAttempt = ctx.query.bindOrange === '1'
      ? await findOrangeLoginAttempt(ctx.cookies.get(orangeBindingCookie))
      : undefined;
    const payload = await createLoginState(orangeAttempt);
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
    | { loginCode?: string; deviceId?: string; deviceType?: string; bindOrange?: boolean }
    | undefined;
  if (!body?.loginCode) {
    ctx.body = fail('loginCode is required');
    return;
  }
  try {
    const bindOrange = body.bindOrange === true;
    if (bindOrange && ctx.get('origin') !== orangeLoginOrigin) {
      ctx.body = fail('请求来源无效');
      return;
    }
    const orangeAttempt = bindOrange ? await findOrangeLoginAttempt(ctx.cookies.get(orangeBindingCookie)) : undefined;
    const tokenData = await exchangeLoginCode(body.loginCode, {
      deviceId: body.deviceId,
      deviceType: orangeAttempt ? 'orange-desktop' : body.deviceType,
      userAgent: ctx.get('user-agent'),
      ip: ctx.ip
    }, orangeAttempt);
    setSessionCookies(ctx, tokenData);
    if (orangeAttempt) setOrangeBindingCookie(ctx, '');
    ctx.body = success(orangeAttempt ? { status: 'signed-in' } : tokenData);
  } catch (err) {
    if (body.bindOrange === true) {
      ctx.body = fail(err instanceof OrangeLoginError ? err.message : '绑定失败，请刷新二维码后重试');
      return;
    }
    console.error('[auth.exchangeToken] failed', {
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
    setSessionCookies(ctx, tokenData);
    ctx.body = success(tokenData);
  } catch (err) {
    clearSessionCookies(ctx);
    ctx.body = errorResponse('登录已过期，请重新登录', err);
  }
};

export const logoutToken = async (ctx: Router.RouterContext) => {
  const body = ctx.request.body as { refreshToken?: string } | undefined;
  const refreshTokenValue = body?.refreshToken || String(ctx.cookies.get('refreshToken') || '');
  if (ctx.cookies.get(orangeBindingCookie)) setOrangeBindingCookie(ctx, '');
  try {
    const accessToken = getBearerToken(ctx);
    if (accessToken) {
      try {
        const payload = await verifyAccessToken(accessToken);
        if (payload.debugSessionId) await endMemberDebugSession(payload.debugSessionId);
      } catch {
        // Expired access is still cleared below; it cannot issue a refresh token.
      }
    }
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
    setSessionCookies(ctx, tokenData);
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
