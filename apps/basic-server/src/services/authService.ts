import crypto from 'crypto';
import { httpsGetJson } from '@/services/wechatApi';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import UserModel from '@/models/User';
import WechatLoginStateModel, { type WechatLoginStatus } from '@/models/WechatLoginState';
import RefreshTokenModel from '@/models/RefreshToken';
import UserSessionModel from '@/models/UserSession';

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
const LOGIN_STATE_TTL_MS = 24 * 60 * 60 * 1000;
const DEVICE_LIMIT = 1;

const getRequiredEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing env: ${key}`);
  }
  return value;
};

 

const buildWechatQrUrl = (state: string) => {
  const clientBase = getRequiredEnv('WECHAT_CLIENT_BASE');
  const pageUrl = `${clientBase.replace(/\/$/, '')}/auth?state=${encodeURIComponent(state)}`;
  return pageUrl;
};

const exchangeWechatCode = async (code: string) => {
  const appId = getRequiredEnv('WECHAT_APPID');
  const appSecret = getRequiredEnv('WECHAT_SECRET');
  const url = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${appId}&secret=${appSecret}&code=${code}&grant_type=authorization_code`;
  const response = await httpsGetJson<{
    access_token?: string;
    openid?: string;
    unionid?: string;
    errcode?: number;
    errmsg?: string;
  }>(url);
  if (response.errcode) {
    throw new Error(response.errmsg || 'WeChat access_token error');
  }
  if (!response.access_token || !response.openid) {
    throw new Error('WeChat access_token response missing fields');
  }
  return {
    access_token: response.access_token,
    openid: response.openid,
    unionid: response.unionid
  };
};

const fetchWechatUserInfo = async (accessToken: string, openId: string) => {
  const url = `https://api.weixin.qq.com/sns/userinfo?access_token=${accessToken}&openid=${openId}`;
  const response = await httpsGetJson<{
    nickname?: string;
    headimgurl?: string;
    errcode?: number;
    errmsg?: string;
  }>(url);
  if (response.errcode) {
    return null;
  }
  return response;
};

const createRandomToken = () => crypto.randomBytes(32).toString('hex');

const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

const defaultAdminWechatOpenIds = ['o8yng1Rr9LW8dW1989inQTIIxVGI'];

const getAdminWechatOpenIds = () => [
  ...new Set([
    ...defaultAdminWechatOpenIds,
    ...String(process.env.ADMIN_WECHAT_OPEN_IDS || '')
    .split(',')
    .map((item) => item.trim())
      .filter(Boolean)
  ])
];

const shouldBeAdmin = (wechatOpenId: string) => getAdminWechatOpenIds().includes(wechatOpenId);

const signAccessToken = (userId: string, sessionId: string) => {
  const secret = getRequiredEnv('JWT_ACCESS_SECRET');
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: userId, sid: sessionId, type: 'access' }, secret, {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    jwtid: jti
  });
  return { token, jti };
};

const signRefreshToken = (userId: string, sessionId: string) => {
  const secret = getRequiredEnv('JWT_REFRESH_SECRET');
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: userId, sid: sessionId, type: 'refresh' }, secret, {
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
    jwtid: jti
  });
  return { token, jti };
};

const revokeSession = async (sessionId: string) => {
  await Promise.all([
    UserSessionModel.updateOne(
      { sessionId, status: 'active' },
      { $set: { status: 'revoked', revokedAt: new Date() } }
    ),
    RefreshTokenModel.updateMany(
      { sessionId, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } }
    )
  ]);
};

const createUserSession = async (input: {
  userId: string;
  deviceId?: string;
  deviceType?: string;
  userAgent?: string;
  ip?: string;
}) => {
  const activeSessions = await UserSessionModel.find({
    userId: input.userId,
    status: 'active'
  })
    .sort({ lastActiveAt: 1, createdAt: 1 })
    .lean();

  for (const session of activeSessions.slice(Math.max(0, DEVICE_LIMIT - 1))) {
    await revokeSession(session.sessionId);
  }

  return UserSessionModel.create({
    userId: input.userId,
    sessionId: crypto.randomUUID(),
    deviceId: input.deviceId,
    deviceType: input.deviceType,
    userAgent: input.userAgent,
    ip: input.ip,
    status: 'active',
    lastActiveAt: new Date(),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000)
  });
};

export const createLoginState = async () => {
  const state = createRandomToken();
  const expiresAt = new Date(Date.now() + LOGIN_STATE_TTL_MS);
  const record = await WechatLoginStateModel.create({
    state,
    status: 'PENDING',
    expiresAt
  });
  return {
    state: record.state,
    expiresAt: record.expiresAt,
    qrUrl: buildWechatQrUrl(record.state)
  };
};

export const getWechatClientSuccessUrl = (state: string) => {
  const clientBase = getRequiredEnv('WECHAT_CLIENT_BASE');
  return `${clientBase.replace(/\/$/, '')}/success?state=${encodeURIComponent(state)}`;
};

export const handleWechatCallback = async (code: string, state: string) => {
  const loginState = await WechatLoginStateModel.findOne({ state });
  if (!loginState) {
    throw new Error('Invalid state');
  }
  if (loginState.expiresAt.getTime() < Date.now()) {
    loginState.status = 'EXPIRED';
    await loginState.save();
    throw new Error('State expired');
  }

  const tokenResponse = await exchangeWechatCode(code);
  const openId = tokenResponse.openid;
  const userInfo = await fetchWechatUserInfo(tokenResponse.access_token, openId);

  const user = await UserModel.findOneAndUpdate(
    { wechatOpenId: openId },
    {
      wechatOpenId: openId,
      wechatUnionId: tokenResponse.unionid,
      nickname: userInfo?.nickname,
      avatar: userInfo?.headimgurl,
      ...(shouldBeAdmin(openId) ? { role: 'admin' } : {})
    },
    { upsert: true, new: true }
  );

  loginState.status = 'SUCCESS';
  loginState.userId = user._id;
  loginState.loginCode = createRandomToken();
  await loginState.save();
};

export const getLoginStatus = async (state: string) => {
  const loginState = await WechatLoginStateModel.findOne({ state });
  if (!loginState) {
    return { status: 'EXPIRED' as WechatLoginStatus };
  }
  if (loginState.expiresAt.getTime() < Date.now()) {
    loginState.status = 'EXPIRED';
    await loginState.save();
  }
  return {
    status: loginState.status,
    loginCode: loginState.status === 'SUCCESS' ? loginState.loginCode : undefined
  };
};

export const exchangeLoginCode = async (
  loginCode: string,
  sessionContext?: { deviceId?: string; deviceType?: string; userAgent?: string; ip?: string }
) => {
  const loginState = await WechatLoginStateModel.findOne({ loginCode, status: 'SUCCESS' });
  if (!loginState || !loginState.userId) {
    throw new Error('Invalid login code');
  }
  const userId = loginState.userId.toString();

  const session = await createUserSession({
    userId,
    deviceId: sessionContext?.deviceId,
    deviceType: sessionContext?.deviceType,
    userAgent: sessionContext?.userAgent,
    ip: sessionContext?.ip
  });

  const access = signAccessToken(userId, session.sessionId);
  const refresh = signRefreshToken(userId, session.sessionId);

  await RefreshTokenModel.create({
    userId: loginState.userId,
    sessionId: session.sessionId,
    jti: refresh.jti,
    tokenHash: hashToken(refresh.token),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000)
  });

  loginState.status = 'EXPIRED';
  loginState.loginCode = undefined;
  await loginState.save();

  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS
  };
};

export const refreshTokens = async (refreshToken: string) => {
  const secret = getRequiredEnv('JWT_REFRESH_SECRET');
  const payload = jwt.verify(refreshToken, secret) as JwtPayload & {
    sub?: string;
    sid?: string;
    jti?: string;
    type?: string;
  };
  if (payload.type !== 'refresh' || !payload.sub || !payload.sid || !payload.jti) {
    throw new Error('Invalid refresh token');
  }
  const session = await UserSessionModel.findOne({
    sessionId: payload.sid,
    userId: payload.sub,
    status: 'active'
  });
  if (!session || session.expiresAt.getTime() <= Date.now()) {
    throw new Error('会话已在其他设备登录，请重新登录');
  }
  const tokenRecord = await RefreshTokenModel.findOne({
    jti: payload.jti,
    userId: payload.sub,
    sessionId: payload.sid
  });
  if (!tokenRecord || tokenRecord.revokedAt) {
    throw new Error('Refresh token revoked');
  }
  if (tokenRecord.tokenHash !== hashToken(refreshToken)) {
    throw new Error('Refresh token mismatch');
  }

  tokenRecord.revokedAt = new Date();
  await tokenRecord.save();

  session.lastActiveAt = new Date();
  session.expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  await session.save();

  const access = signAccessToken(payload.sub, payload.sid);
  const refresh = signRefreshToken(payload.sub, payload.sid);
  await RefreshTokenModel.create({
    userId: payload.sub,
    sessionId: payload.sid,
    jti: refresh.jti,
    tokenHash: hashToken(refresh.token),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000)
  });

  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS
  };
};

export const logout = async (refreshToken: string) => {
  const secret = getRequiredEnv('JWT_REFRESH_SECRET');
  const payload = jwt.verify(refreshToken, secret) as JwtPayload & {
    sub?: string;
    sid?: string;
    jti?: string;
    type?: string;
  };
  if (payload.type !== 'refresh' || !payload.jti || !payload.sid) {
    throw new Error('Invalid refresh token');
  }
  await revokeSession(payload.sid);
};

export const getCurrentUser = async (accessToken: string) => {
  const payload = await verifyAccessToken(accessToken);
  const user = await UserModel.findById(payload.sub).lean();
  if (!user) {
    throw new Error('User not found');
  }
  const role = user.role === 'admin' || shouldBeAdmin(user.wechatOpenId) ? 'admin' : 'user';
  if (role === 'admin' && user.role !== 'admin') {
    await UserModel.updateOne({ _id: user._id }, { $set: { role: 'admin' } });
  }
  return {
    id: user._id.toString(),
    nickname: user.nickname,
    avatar: user.avatar,
    wechatOpenId: user.wechatOpenId,
    role
  };
};

export const getNavMenus = async (accessToken?: string) => {
  const baseMenus = [{ key: 'apps', label: '应用广场', path: '/' }];
  if (!accessToken) {
    return baseMenus;
  }

  try {
    const payload = await verifyAccessToken(accessToken);
    const user = await UserModel.findById(payload.sub).lean();
    const role = user && (user.role === 'admin' || shouldBeAdmin(user.wechatOpenId)) ? 'admin' : 'user';
    if (user && role === 'admin' && user.role !== 'admin') {
      await UserModel.updateOne({ _id: user._id }, { $set: { role: 'admin' } });
    }
    if (role === 'admin') {
      return [
        ...baseMenus,
        { key: 'users', label: '会员管理', path: '/members' },
        { key: 'orders', label: '订单管理', path: '/orders' },
        { key: 'redeemCodes', label: '兑换码管理', path: '/redeem-codes' }
      ];
    }
  } catch {
    return baseMenus;
  }

  return baseMenus;
};

export const verifyAccessToken = async (accessToken: string) => {
  const secret = getRequiredEnv('JWT_ACCESS_SECRET');
  const payload = jwt.verify(accessToken, secret) as JwtPayload & {
    sub?: string;
    sid?: string;
    type?: string;
  };
  if (payload.type !== 'access' || !payload.sub || !payload.sid) {
    throw new Error('Invalid access token');
  }
  const session = await UserSessionModel.findOne({
    sessionId: payload.sid,
    userId: payload.sub,
    status: 'active'
  });
  if (!session || session.expiresAt.getTime() <= Date.now()) {
    throw new Error('会话已在其他设备登录，请重新登录');
  }
  await UserSessionModel.updateOne(
    { sessionId: payload.sid },
    { $set: { lastActiveAt: new Date() } }
  );
  return payload as JwtPayload & { sub: string; sid: string; type: string };
};
