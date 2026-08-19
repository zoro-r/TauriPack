import crypto from 'crypto';
import http from 'http';
import https from 'https';
import mongoose from 'mongoose';
import type { IncomingHttpHeaders } from 'http';
import type { ServerResponse } from 'http';
import type { UserDocument } from '@/models/User';
import BillingTransactionModel from '@/models/BillingTransaction';
import NewApiAccountModel from '@/models/NewApiAccount';
import NewApiRechargeModel from '@/models/NewApiRecharge';
import { rememberDocumentApiKey } from '@/services/documentService';

interface NewApiConfig {
  baseUrl: string;
  adminToken: string;
  adminUserId: string;
  consoleUrl: string;
  usernamePrefix: string;
  managedUserSecret: string;
}

interface NewApiRequestOptions {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  bearerToken?: string;
  newApiUser?: string;
  cookie?: string;
  body?: unknown;
}

interface NewApiResponse<T> {
  statusCode: number;
  headers: IncomingHttpHeaders;
  data: T | null;
}

export interface NewApiAccountOverview {
  provisioned: boolean;
  suggestedUsername: string;
  consoleUrl: string;
  account?: {
    newApiUserId: string;
    username: string;
    displayName?: string;
    status: 'provisioned' | 'sync_error';
    lastSyncedAt?: string;
    lastError?: string;
  };
  remoteUser?: {
    id: string;
    username: string;
    displayName?: string;
    statusText?: string;
  };
}

export interface NewApiTokenItem {
  id: string;
  name: string;
  maskedKey: string;
  statusText: string;
  createdAt?: string;
  expiredAt?: string;
  usedQuota: number;
  documentUsedQuota?: number;
}

export interface CreatedNewApiTokenResult {
  token: NewApiTokenItem;
  secret?: string;
}

export interface NewApiChatCompletionInput {
  authorization: string;
  body: unknown;
}

export interface NewApiWalletOverview {
  provisioned: boolean;
  quota?: number;
  usedQuota?: number;
  availableQuota?: number;
  rechargeOptions: Array<{ amount: number; quota: number }>;
  customRechargeMinAmount: number;
  customRechargeMaxAmount: number;
}

export interface NewApiUsageItem { id: string; tokenId: string; model: string; tokenName: string; quota: number; createdAt?: string; }

export interface NewApiQuotaChargeResult {
  quota: number;
  availableQuota: number;
}

interface NewApiRemoteUserSummary {
  id: string;
  username: string;
  displayName?: string;
  status?: number;
}

interface ManagedSessionCacheEntry {
  cookie: string;
  expiresAt: number;
}

const logNewApi = (event: string, payload?: Record<string, unknown>) => {
  console.info(`[newApiService] ${event}`, payload || {});
};

const logNewApiError = (event: string, error: unknown, payload?: Record<string, unknown>) => {
  console.error(`[newApiService] ${event}`, {
    ...(payload || {}),
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
};

const managedSessionCache = new Map<string, ManagedSessionCacheEntry>();
const managedSessionInflight = new Map<string, Promise<string>>();
const managedSessionRateLimitUntil = new Map<string, number>();
const DEFAULT_MANAGED_SESSION_CACHE_TTL_MS = 30 * 60 * 1000;
const MIN_MANAGED_SESSION_CACHE_TTL_MS = 60 * 1000;
const MAX_MANAGED_SESSION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MANAGED_SESSION_RATE_LIMIT_COOLDOWN_MS = 30 * 1000;

const getManagedSessionCacheTtlMs = () => {
  const configuredTtl = Number(process.env.NEW_API_MANAGED_SESSION_CACHE_TTL_MS);
  if (!Number.isFinite(configuredTtl)) {
    return DEFAULT_MANAGED_SESSION_CACHE_TTL_MS;
  }
  return Math.min(
    MAX_MANAGED_SESSION_CACHE_TTL_MS,
    Math.max(MIN_MANAGED_SESSION_CACHE_TTL_MS, configuredTtl)
  );
};

const getRequiredEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing env: ${key}`);
  }
  return value;
};

const getConfig = (): NewApiConfig => {
  const baseUrl = getRequiredEnv('NEW_API_BASE_URL').replace(/\/+$/, '');
  return {
    baseUrl,
    adminToken: getRequiredEnv('NEW_API_ADMIN_KEY'),
    adminUserId: getRequiredEnv('NEW_API_ADMIN_USER_ID'),
    consoleUrl: (process.env.NEW_API_CONSOLE_URL || baseUrl).replace(/\/+$/, ''),
    usernamePrefix: (process.env.NEW_API_USER_PREFIX || 'tp').replace(/[^a-zA-Z0-9_]/g, '') || 'tp',
    managedUserSecret: process.env.NEW_API_MANAGED_USER_SECRET || getRequiredEnv('JWT_ACCESS_SECRET')
  };
};

const getRechargeOptions = () => {
  const quotaPerYuan = Number(process.env.NEW_API_QUOTA_PER_YUAN || 0);
  const amounts = String(process.env.NEW_API_RECHARGE_AMOUNTS || '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0)
    .filter((item, index, list) => list.indexOf(item) === index)
    .sort((a, b) => a - b);
  if (!Number.isFinite(quotaPerYuan) || quotaPerYuan <= 0 || amounts.length === 0) {
    return [];
  }
  return amounts.map((amount) => ({ amount, quota: Math.round(amount * quotaPerYuan) })).filter((item) => item.quota > 0);
};

const getCustomRechargeRange = () => ({
  min: Number(process.env.NEW_API_RECHARGE_MIN_AMOUNT || 1),
  max: Number(process.env.NEW_API_RECHARGE_MAX_AMOUNT || 10000)
});

const requestNewApi = <T>(options: NewApiRequestOptions): Promise<NewApiResponse<T>> =>
  new Promise((resolve, reject) => {
    const config = getConfig();
    const url = new URL(options.path, `${config.baseUrl}/`);
    const bodyText = options.body === undefined ? '' : JSON.stringify(options.body);
    const startedAt = Date.now();
    logNewApi('request.start', {
      method: options.method,
      path: options.path,
      hasBearerToken: Boolean(options.bearerToken),
      hasCookie: Boolean(options.cookie),
      newApiUser: options.newApiUser || undefined,
      hasBody: options.body !== undefined
    });
    const requestOptions = {
      method: options.method,
      headers: {
        Accept: 'application/json',
        ...(bodyText
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(bodyText)
            }
          : {}),
        ...(options.bearerToken ? { Authorization: `Bearer ${options.bearerToken}` } : {}),
        ...(options.newApiUser ? { 'New-Api-User': options.newApiUser } : {}),
        ...(options.cookie ? { Cookie: options.cookie } : {})
      }
    };

    const handleResponse = (res: http.IncomingMessage) => {
      const chunks: Uint8Array[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(new Uint8Array(chunk)));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        let parsed: T | null = null;
        if (raw) {
          try {
            parsed = JSON.parse(raw) as T;
          } catch {
            logNewApi('request.invalidJson', {
              method: options.method,
              path: options.path,
              statusCode: res.statusCode || 0,
              durationMs: Date.now() - startedAt
            });
            reject(new Error(`new-api returned invalid JSON: ${raw.slice(0, 300)}`));
            return;
          }
        }
        logNewApi('request.finish', {
          method: options.method,
          path: options.path,
          statusCode: res.statusCode || 0,
          durationMs: Date.now() - startedAt,
          errorMessage:
            (res.statusCode || 0) >= 400 ? extractErrorMessage(parsed, 'new-api request failed') : undefined
        });
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          data: parsed
        });
      });
    };

    const req =
      url.protocol === 'https:'
        ? https.request(url, requestOptions as any, handleResponse)
        : http.request(url, requestOptions, handleResponse);

    req.on('error', (error) => {
      logNewApiError('request.error', error, {
        method: options.method,
        path: options.path,
        durationMs: Date.now() - startedAt
      });
      reject(error);
    });
    if (bodyText) {
      req.write(bodyText);
    }
    req.end();
  });

const unwrapResponseData = <T>(value: any): T => {
  if (value && typeof value === 'object' && 'data' in value) {
    return value.data as T;
  }
  return value as T;
};

const extractErrorMessage = (payload: any, fallback: string) => {
  if (payload && typeof payload === 'object') {
    const candidate = payload.message || payload.error;
    if (candidate && typeof candidate === 'object') {
      return String(candidate.message || candidate.detail || fallback);
    }
    return String(candidate || fallback);
  }
  return fallback;
};

const assertNewApiSuccess = <T>(response: NewApiResponse<T>, fallback: string) => {
  if (response.statusCode >= 400) {
    throw new Error(extractErrorMessage(response.data, fallback));
  }
  const payload = response.data as any;
  if (
    payload &&
    typeof payload === 'object' &&
    (
      (typeof payload.success === 'boolean' && payload.success === false) ||
      (typeof payload.code === 'number' && payload.code !== 200 && payload.code !== 0)
    )
  ) {
    throw new Error(extractErrorMessage(payload, fallback));
  }
  return unwrapResponseData<any>(payload);
};

const NEW_API_MANAGED_USERNAME_MAX_LENGTH = 12;
const NEW_API_MANAGED_PASSWORD_MAX_LENGTH = 12;
const NEW_API_MAX_KEYS_PER_USER = 5;

const buildManagedUsername = (userId: string) => {
  const { usernamePrefix } = getConfig();
  const safePrefix = usernamePrefix.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2) || 'tp';
  const suffix = crypto
    .createHash('sha256')
    .update(`new-api-username:${userId}`)
    .digest('hex')
    .slice(0, NEW_API_MANAGED_USERNAME_MAX_LENGTH - safePrefix.length);
  return `${safePrefix}${suffix}`.slice(0, NEW_API_MANAGED_USERNAME_MAX_LENGTH);
};

const buildManagedPassword = (userId: string) => {
  const { managedUserSecret } = getConfig();
  const digest = crypto
    .createHmac('sha256', managedUserSecret)
    .update(`new-api:${userId}`)
    .digest('hex')
    .slice(0, NEW_API_MANAGED_PASSWORD_MAX_LENGTH - 4);
  return `${digest}Aa1!`;
};

const buildManagedDisplayName = (user: Pick<UserDocument, '_id' | 'nickname'>) =>
  (user.nickname || `用户${String(user._id).slice(-6)}`).slice(0, 32);

const toIsoTime = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof value === 'string' && value) {
    const asNum = Number(value);
    if (Number.isFinite(asNum)) {
      return toIsoTime(asNum);
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return undefined;
};

const toExpirationTime = (value: unknown) => {
  if (typeof value === 'number' && value <= 0) {
    return undefined;
  }
  if (typeof value === 'string' && Number(value) <= 0) {
    return undefined;
  }
  return toIsoTime(value);
};

const maskTokenValue = (value?: string) => {
  if (!value) {
    return '--';
  }
  if (value.length <= 10) {
    return `sk-${value.slice(0, 2)}****${value.slice(-2)}`;
  }
  return `sk-${value.slice(0, 6)}****${value.slice(-4)}`;
};

const withApiKeyPrefix = (value: string) => (value.startsWith('sk-') ? value : `sk-${value}`);

const statusTextOfToken = (value: any) => {
  if (value?.status === 2 || value?.enabled === false || value?.is_enabled === false) {
    return '已禁用';
  }
  if (value?.expired === true) {
    return '已过期';
  }
  return '可用';
};

const normalizeTokenItem = (value: any): NewApiTokenItem => {
  const rawSecret =
    typeof value?.key === 'string'
      ? value.key
      : typeof value?.token === 'string'
        ? value.token
        : typeof value?.value === 'string'
          ? value.value
          : undefined;
  return {
    id: String(value?.id || value?._id || value?.token_id || ''),
    name: String(value?.name || value?.display_name || '未命名密钥'),
    maskedKey:
      typeof value?.masked_key === 'string'
        ? withApiKeyPrefix(value.masked_key)
        : typeof value?.key_preview === 'string'
          ? withApiKeyPrefix(value.key_preview)
          : maskTokenValue(rawSecret),
    statusText: statusTextOfToken(value),
    createdAt: toIsoTime(value?.created_at ?? value?.createdAt ?? value?.created_time),
    expiredAt: toExpirationTime(value?.expired_at ?? value?.expiredAt ?? value?.expired_time),
    usedQuota: Number(value?.used_quota ?? value?.usedQuota ?? 0)
  };
};

const isAlreadyExistsError = (message: string) =>
  ['already exists', 'already existed', 'duplicate', '已存在'].some((item) =>
    message.toLowerCase().includes(item.toLowerCase())
  );

const requestNewApiAsAdmin = <T>(options: Omit<NewApiRequestOptions, 'bearerToken' | 'newApiUser'>) => {
  const config = getConfig();
  return requestNewApi<T>({
    ...options,
    bearerToken: config.adminToken,
    newApiUser: config.adminUserId
  });
};

const toCookieHeader = (setCookie: string[] | undefined) =>
  (setCookie || [])
    .map((value) => value.split(';', 1)[0])
    .filter(Boolean)
    .join('; ');

const loginManagedUserSession = async (userId: string, remoteUserId: string) => {
  const username = buildManagedUsername(userId);
  const cached = managedSessionCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    logNewApi('loginManagedUserSession.cacheHit', { userId, remoteUserId, username });
    return cached.cookie;
  }

  const rateLimitUntil = managedSessionRateLimitUntil.get(userId) || 0;
  if (rateLimitUntil > Date.now()) {
    throw new Error('API 账户登录过于频繁，请稍后重试');
  }

  const inflight = managedSessionInflight.get(userId);
  if (inflight) {
    logNewApi('loginManagedUserSession.join', { userId, remoteUserId, username });
    return inflight;
  }

  const loginPromise = (async () => {
    logNewApi('loginManagedUserSession.start', { userId, remoteUserId, username });
    const response = await requestNewApi<any>({
      method: 'POST',
      path: '/api/user/login',
      body: {
        username,
        password: buildManagedPassword(userId)
      }
    });
    if (response.statusCode === 429) {
      managedSessionRateLimitUntil.set(userId, Date.now() + MANAGED_SESSION_RATE_LIMIT_COOLDOWN_MS);
      throw new Error('API 账户登录过于频繁，请稍后重试');
    }
    assertNewApiSuccess(response, '登录 new-api 托管用户失败');
    const cookie = toCookieHeader(response.headers['set-cookie']);
    if (!cookie) {
      throw new Error('new-api 登录成功但未返回会话 Cookie');
    }
    logNewApi('loginManagedUserSession.success', {
      userId,
      remoteUserId,
      username,
      cookieLength: cookie.length
    });
    managedSessionRateLimitUntil.delete(userId);
    managedSessionCache.set(userId, {
      cookie,
      expiresAt: Date.now() + getManagedSessionCacheTtlMs()
    });
    return cookie;
  })();

  managedSessionInflight.set(userId, loginPromise);
  try {
    return await loginPromise;
  } finally {
    if (managedSessionInflight.get(userId) === loginPromise) {
      managedSessionInflight.delete(userId);
    }
  }
};

const requestNewApiInUserContext = async <T>(
  userId: string,
  remoteUserId: string,
  options: Omit<NewApiRequestOptions, 'bearerToken' | 'newApiUser' | 'cookie'>
) => {
  const cookie = await loginManagedUserSession(userId, remoteUserId);
  const response = await requestNewApi<T>({
    ...options,
    newApiUser: remoteUserId,
    cookie
  });
  if (response.statusCode === 401) {
    // The remote session may have expired before its local cache TTL.
    managedSessionCache.delete(userId);
    logNewApi('requestNewApiInUserContext.retryAfterUnauthorized', {
      userId,
      remoteUserId,
      method: options.method,
      path: options.path
    });
    const refreshedCookie = await loginManagedUserSession(userId, remoteUserId);
    const retryResponse = await requestNewApi<T>({
      ...options,
      newApiUser: remoteUserId,
      cookie: refreshedCookie
    });
    if (retryResponse.statusCode === 401) {
      managedSessionCache.delete(userId);
    }
    return retryResponse;
  }
  return response;
};

const getNewApiSelf = async (userId: string, remoteUserId: string) => {
  const response = await requestNewApiInUserContext<any>(userId, remoteUserId, {
    method: 'GET',
    path: '/api/user/self'
  });
  return assertNewApiSuccess<any>(response, '获取 API 账户余额失败');
};

const normalizeRemoteUserSummary = (value: any): NewApiRemoteUserSummary => ({
  id: String(value?.id || value?._id || value?.user_id || ''),
  username: String(value?.username || value?.name || ''),
  displayName:
    typeof value?.display_name === 'string'
      ? value.display_name
      : typeof value?.displayName === 'string'
        ? value.displayName
        : undefined,
  status: typeof value?.status === 'number' ? value.status : undefined
});

const fetchRemoteUserByUsernameAsAdmin = async (username: string): Promise<NewApiRemoteUserSummary> => {
  logNewApi('fetchRemoteUserByUsername.start', { username });
  const response = await requestNewApiAsAdmin<any>({
    method: 'GET',
    path: `/api/user/search?keyword=${encodeURIComponent(username)}&p=1&page_size=20`
  });
  const payload = assertNewApiSuccess<any>(response, '搜索 new-api 用户失败');
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.data?.items)
        ? payload.data.items
        : [];
  const matched = items
    .map(normalizeRemoteUserSummary)
    .find((item: NewApiRemoteUserSummary) => item.username === username || item.id === username);

  if (!matched?.id) {
    throw new Error(`new-api 用户不存在: ${username}`);
  }

  logNewApi('fetchRemoteUserByUsername.success', {
    username,
    remoteUserId: matched.id
  });
  return matched;
};

const fetchRemoteUserByIdAsAdmin = async (remoteUserId: string): Promise<NewApiRemoteUserSummary> => {
  const response = await requestNewApiAsAdmin<any>({
    method: 'GET',
    path: `/api/user/${encodeURIComponent(remoteUserId)}`
  });
  const payload = assertNewApiSuccess<any>(response, '获取 new-api 用户信息失败');
  return normalizeRemoteUserSummary(payload);
};

const resolveRemoteUser = async (input: { userId: string; username?: string; remoteUserId?: string }) => {
  if (input.remoteUserId) {
    try {
      const remoteUser = await fetchRemoteUserByIdAsAdmin(input.remoteUserId);
      if (remoteUser.id) {
        return remoteUser;
      }
    } catch (error) {
      logNewApiError('resolveRemoteUser.byIdFailed', error, input);
    }
  }

  const username = input.username || buildManagedUsername(input.userId);
  return fetchRemoteUserByUsernameAsAdmin(username);
};

const syncAccountRecord = async (userId: string, remoteUser: any) => {
  const remoteId = String(remoteUser?.id || remoteUser?._id || remoteUser?.user_id || '');
  const username = String(remoteUser?.username || remoteUser?.name || buildManagedUsername(userId));
  const displayName =
    typeof remoteUser?.display_name === 'string'
      ? remoteUser.display_name
      : typeof remoteUser?.displayName === 'string'
        ? remoteUser.displayName
        : undefined;

  return NewApiAccountModel.findOneAndUpdate(
    { userId },
    {
      $set: {
        newApiUserId: remoteId || username,
        username,
        displayName,
        status: 'provisioned',
        lastSyncedAt: new Date(),
        lastError: undefined
      }
    },
    { upsert: true, new: true }
  );
};

const normalizeOverview = (input: {
  userId: string;
  remoteUser?: any;
  lastError?: string;
  status?: 'provisioned' | 'sync_error';
}) => {
  const config = getConfig();
  return NewApiAccountModel.findOne({ userId: input.userId }).lean().then((account) => ({
    provisioned: Boolean(account),
    suggestedUsername: buildManagedUsername(input.userId),
    consoleUrl: config.consoleUrl,
    ...(account
      ? {
          account: {
            newApiUserId: account.newApiUserId,
            username: account.username,
            displayName: account.displayName,
            status: input.status || account.status,
            lastSyncedAt: account.lastSyncedAt?.toISOString(),
            lastError: input.lastError || account.lastError
          }
        }
      : {}),
    ...(input.remoteUser
      ? {
          remoteUser: {
            id: String(
              input.remoteUser.id || input.remoteUser._id || input.remoteUser.user_id || account?.newApiUserId || ''
            ),
            username: String(input.remoteUser.username || input.remoteUser.name || account?.username || ''),
            displayName:
              input.remoteUser.display_name || input.remoteUser.displayName || account?.displayName,
            statusText:
              typeof input.remoteUser.status === 'number'
                ? input.remoteUser.status === 1
                  ? '正常'
                  : '禁用'
                : undefined
          }
        }
      : {})
  }));
};

const ensureProvisionedAccount = async (userId: string) => {
  const account = await NewApiAccountModel.findOne({ userId }).lean();
  if (!account) {
    throw new Error('当前尚未开通 API 账户');
  }
  return account;
};

export const getNewApiAccountOverview = async (userId: string): Promise<NewApiAccountOverview> => {
  logNewApi('getOverview.start', { userId });
  const account = await NewApiAccountModel.findOne({ userId }).lean();
  if (!account) {
    logNewApi('getOverview.notProvisioned', { userId });
    return {
      provisioned: false,
      suggestedUsername: buildManagedUsername(userId),
      consoleUrl: getConfig().consoleUrl
    };
  }

  try {
    const remoteUser = await resolveRemoteUser({
      userId,
      username: account.username,
      remoteUserId: account.newApiUserId
    });
    await syncAccountRecord(userId, remoteUser);
    logNewApi('getOverview.success', {
      userId,
      remoteUserId: remoteUser.id,
      username: remoteUser.username || account.username || ''
    });
    return normalizeOverview({ userId, remoteUser, status: 'provisioned' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'new-api 同步失败';
    logNewApiError('getOverview.failed', error, { userId });
    await NewApiAccountModel.updateOne(
      { userId },
      { $set: { status: 'sync_error', lastError: message, lastSyncedAt: new Date() } }
    );
    return normalizeOverview({ userId, lastError: message, status: 'sync_error' });
  }
};

export const provisionNewApiAccount = async (
  user: Pick<UserDocument, '_id' | 'nickname'>
): Promise<NewApiAccountOverview> => {
  const userId = String(user._id);
  const username = buildManagedUsername(userId);
  const displayName = buildManagedDisplayName(user);
  logNewApi('provision.start', {
    userId,
    username,
    displayName
  });

  try {
    const password = buildManagedPassword(userId);
    const createResponse = await requestNewApiAsAdmin({
      method: 'POST',
      path: '/api/user/',
      body: {
        username,
        password,
        display_name: displayName
      }
    });
    assertNewApiSuccess(createResponse, '创建 new-api 用户失败');
    logNewApi('provision.createUser.success', {
      userId,
      username
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建 new-api 用户失败';
    if (!isAlreadyExistsError(message)) {
      logNewApiError('provision.createUser.failed', error, {
        userId,
        username,
        displayName
      });
      throw error;
    }
    logNewApi('provision.createUser.exists', {
      userId,
      username,
      message
    });
  }

  const remoteUser = await resolveRemoteUser({ userId, username });
  await syncAccountRecord(userId, remoteUser);
  logNewApi('provision.success', {
    userId,
    remoteUserId: remoteUser.id,
    username: remoteUser.username || username
  });
  return normalizeOverview({ userId, remoteUser, status: 'provisioned' });
};

export const getNewApiWallet = async (userId: string): Promise<NewApiWalletOverview> => {
  const account = await NewApiAccountModel.findOne({ userId }).lean();
  const rechargeOptions = getRechargeOptions();
  if (!account) {
    const range = getCustomRechargeRange();
    return { provisioned: false, rechargeOptions, customRechargeMinAmount: range.min, customRechargeMaxAmount: range.max };
  }
  const remoteUser = await resolveRemoteUser({
    userId,
    username: account.username,
    remoteUserId: account.newApiUserId
  });
  const self = await getNewApiSelf(userId, remoteUser.id);
  const quota = Number(self?.quota || 0);
  const usedQuota = Number(self?.used_quota || self?.usedQuota || 0);
  return {
    provisioned: true,
    quota,
    usedQuota,
    availableQuota: Math.max(0, quota - usedQuota),
    rechargeOptions,
    customRechargeMinAmount: getCustomRechargeRange().min,
    customRechargeMaxAmount: getCustomRechargeRange().max
  };
};

export const chargeNewApiQuota = async (input: { userId: string; quota: number }): Promise<NewApiQuotaChargeResult> => {
  const quota = Math.floor(Number(input.quota));
  if (!Number.isFinite(quota) || quota <= 0) throw new Error('扣除额度必须大于 0');

  const account = await ensureProvisionedAccount(input.userId);
  const remoteUser = await resolveRemoteUser({ userId: input.userId, remoteUserId: account.newApiUserId });
  const self = await getNewApiSelf(input.userId, remoteUser.id);
  const availableQuota = Math.max(0, Number(self?.quota || 0) - Number(self?.used_quota || self?.usedQuota || 0));
  if (availableQuota < quota) throw new Error(`New-API 余额不足，本次解析需 ${quota} 额度`);

  const response = await requestNewApiAsAdmin({
    method: 'POST',
    path: '/api/user/manage',
    body: { id: Number(remoteUser.id), action: 'add_quota', mode: 'subtract', value: quota }
  });
  assertNewApiSuccess(response, '扣除 New-API 额度失败');
  logNewApi('document.quotaCharge.success', { userId: input.userId, remoteUserId: remoteUser.id, quota });
  return { quota, availableQuota: availableQuota - quota };
};

export const createNewApiRechargeOrder = async (userId: string, amount: number) => {
  const quotaPerYuan = Number(process.env.NEW_API_QUOTA_PER_YUAN || 0);
  const range = getCustomRechargeRange();
  const option = getRechargeOptions().find((item) => item.amount === amount) ||
    (Number.isFinite(quotaPerYuan) && quotaPerYuan > 0 && amount >= range.min && amount <= range.max
      ? { amount, quota: Math.round(amount * quotaPerYuan) }
      : undefined);
  if (!option) throw new Error(`充值金额需在 ¥${range.min} - ¥${range.max} 之间`);
  const account = await ensureProvisionedAccount(userId);
  return { amount: option.amount, quota: option.quota, remoteUserId: account.newApiUserId };
};

export const listNewApiUsage = async (userId: string): Promise<NewApiUsageItem[]> => {
  const account = await ensureProvisionedAccount(userId);
  const remoteUser = await resolveRemoteUser({ userId, remoteUserId: account.newApiUserId });
  const response = await requestNewApiInUserContext<any>(userId, remoteUser.id, { method: 'GET', path: '/api/log/self?p=1&page_size=50' });
  const payload = assertNewApiSuccess<any>(response, '获取消费明细失败');
  const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
  return items
    .filter((item: any) => Number(item.quota || 0) > 0)
    .map((item: any) => ({ id: String(item.id || ''), tokenId: String(item.token_id || ''), model: String(item.model_name || '--'), tokenName: String(item.token_name || '--'), quota: Number(item.quota || 0), createdAt: toIsoTime(item.created_at) }));
};

export const listNewApiModels = async (userId: string): Promise<string[]> => {
  const account = await ensureProvisionedAccount(userId);
  const remoteUser = await resolveRemoteUser({ userId, remoteUserId: account.newApiUserId });
  const response = await requestNewApiInUserContext<any>(userId, remoteUser.id, { method: 'GET', path: '/api/user/models' });
  const payload = assertNewApiSuccess<any>(response, '获取可用模型失败');
  const items = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  return items.map((item: any) => typeof item === 'string' ? item : String(item?.id || item?.model || '')).filter(Boolean);
};

export const creditNewApiRecharge = async (input: {
  orderId: string;
  userId: string;
  quota: number;
  remoteUserId: string;
}) => {
  let recharge = await NewApiRechargeModel.findOne({ orderId: input.orderId });
  if (!recharge) {
    try {
      recharge = await NewApiRechargeModel.create({
        orderId: input.orderId,
        userId: input.userId,
        remoteUserId: input.remoteUserId,
        quota: input.quota,
        status: 'pending'
      });
    } catch {
      recharge = await NewApiRechargeModel.findOne({ orderId: input.orderId });
    }
  }
  if (!recharge) {
    throw new Error('创建充值入账记录失败');
  }
  if (recharge.status === 'credited') {
    logNewApi('wallet.credit.idempotent', { orderId: input.orderId, userId: input.userId, quota: recharge.quota });
    return recharge;
  }

  const configuredCreditingTimeoutMs = Number(process.env.NEW_API_RECHARGE_CREDITING_TIMEOUT_MS);
  const creditingTimeoutMs = Number.isFinite(configuredCreditingTimeoutMs)
    ? Math.max(60_000, configuredCreditingTimeoutMs)
    : 10 * 60 * 1000;
  if (recharge.status === 'crediting') {
    const creditingStartedAt = recharge.updatedAt.getTime();
    if (Date.now() - creditingStartedAt < creditingTimeoutMs) {
      throw new Error('充值正在处理中');
    }

    const recoveredRecharge = await NewApiRechargeModel.findOneAndUpdate(
      {
        _id: recharge._id,
        status: 'crediting',
        updatedAt: { $lte: new Date(Date.now() - creditingTimeoutMs) }
      },
      {
        $set: {
          status: 'failed',
          error: '充值入账超时，已由订单同步自动恢复'
        }
      },
      { new: true }
    );
    if (!recoveredRecharge) {
      throw new Error('充值正在处理中');
    }
    recharge = recoveredRecharge;
    logNewApi('wallet.credit.timeoutRecovered', {
      orderId: input.orderId,
      userId: input.userId,
      timeoutMs: creditingTimeoutMs
    });
  }

  const lockedRecharge = await NewApiRechargeModel.findOneAndUpdate(
    { _id: recharge._id, status: { $in: ['pending', 'failed'] } },
    { $set: { status: 'crediting', error: undefined } },
    { new: true }
  );
  if (!lockedRecharge) {
    throw new Error('充值正在处理中');
  }
  recharge = lockedRecharge;
  const remoteUser = await resolveRemoteUser({ userId: input.userId, remoteUserId: input.remoteUserId });
  try {
    const response = await requestNewApiAsAdmin({
      method: 'POST',
      path: '/api/user/manage',
      body: { id: Number(remoteUser.id), action: 'add_quota', mode: 'add', value: recharge.quota }
    });
    assertNewApiSuccess(response, 'API 账户充值失败');
    recharge.status = 'credited';
    recharge.creditedAt = new Date();
    recharge.error = undefined;
    await recharge.save();
    logNewApi('wallet.credit.success', { orderId: input.orderId, userId: input.userId, quota: recharge.quota });
    return recharge;
  } catch (error) {
    recharge.status = 'failed';
    recharge.error = error instanceof Error ? error.message : String(error);
    await recharge.save();
    logNewApiError('wallet.credit.failed', error, { orderId: input.orderId, userId: input.userId, quota: recharge.quota });
    throw error;
  }
};

export type RechargeReconciliation = 'credited' | 'not_credited';

/**
 * Reconciles an interrupted recharge only after an administrator has checked
 * the remote New-API balance. This must not be inferred automatically because
 * the remote quota update may have succeeded before this service stopped.
 */
export const reconcileNewApiRecharge = async (input: {
  orderId: string;
  resolution: RechargeReconciliation;
}) => {
  const recharge = await NewApiRechargeModel.findOne({ orderId: input.orderId });
  if (!recharge) {
    throw new Error('未找到充值入账记录');
  }
  if (recharge.status !== 'crediting') {
    throw new Error(`当前充值入账状态为 ${recharge.status}，无需人工核对`);
  }

  if (input.resolution === 'credited') {
    recharge.status = 'credited';
    recharge.creditedAt = new Date();
    recharge.error = undefined;
    await recharge.save();
    logNewApi('wallet.credit.reconciled', { orderId: input.orderId, resolution: input.resolution });
    return recharge;
  }

  recharge.status = 'failed';
  recharge.error = '管理员核对远端额度后确认未入账，允许重新执行';
  await recharge.save();
  logNewApi('wallet.credit.reconciled', { orderId: input.orderId, resolution: input.resolution });
  return recharge;
};

export const listNewApiKeys = async (userId: string): Promise<NewApiTokenItem[]> => {
  logNewApi('listKeys.start', { userId });
  await ensureProvisionedAccount(userId);
  const remoteUser = await resolveRemoteUser({ userId });
  const response = await requestNewApiInUserContext<any>(userId, remoteUser.id, {
    method: 'GET',
    path: '/api/token/'
  });
  const payload = assertNewApiSuccess<any>(response, '获取 new-api 密钥列表失败');
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.data)
      ? payload.data
        : [];
  logNewApi('listKeys.success', {
    userId,
    count: list.length
  });
  const tokens: NewApiTokenItem[] = list.map(normalizeTokenItem).filter((item: NewApiTokenItem) => item.id);
  const documentUsage = await BillingTransactionModel.aggregate<{ _id: string; quota: number }>([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        businessType: 'document_parse',
        currency: 'new_api_quota',
        direction: 'debit',
        status: 'succeeded',
        apiKeyId: { $exists: true, $ne: '' }
      }
    },
    { $group: { _id: '$apiKeyId', quota: { $sum: '$amount' } } }
  ]);
  const documentQuotaByKeyId = new Map(documentUsage.map((item: { _id: string; quota: number }) => [String(item._id), Number(item.quota || 0)]));
  return tokens.map((item: NewApiTokenItem) => {
    const documentUsedQuota = documentQuotaByKeyId.get(item.id) || 0;
    return { ...item, documentUsedQuota };
  });
};

export const createNewApiKey = async (
  userId: string,
  input: {
    name?: string;
    expiresInSeconds?: number;
    unlimitedQuota?: boolean;
    remainQuota?: number;
    allowIps?: string;
    modelLimitsEnabled?: boolean;
    modelLimits?: string;
    crossGroupRetry?: boolean;
  }
): Promise<CreatedNewApiTokenResult> => {
  logNewApi('createKey.start', {
    userId,
    name: String(input.name || '').trim() || undefined
  });
  const existingKeys = await listNewApiKeys(userId);
  if (existingKeys.length >= NEW_API_MAX_KEYS_PER_USER) {
    throw new Error(`每个账户最多创建 ${NEW_API_MAX_KEYS_PER_USER} 个 API 密钥`);
  }
  await ensureProvisionedAccount(userId);
  const remoteUser = await resolveRemoteUser({ userId });
  const remoteSelf = await getNewApiSelf(userId, remoteUser.id);
  const group = typeof remoteSelf?.group === 'string' && remoteSelf.group.trim() ? remoteSelf.group.trim() : 'default';
  const unlimitedQuota = input.unlimitedQuota !== false;
  const expiresInSeconds = Number(input.expiresInSeconds || 0);
  const remainQuota = Math.floor(Number(input.remainQuota || 0));
  if (!unlimitedQuota && (!Number.isFinite(remainQuota) || remainQuota <= 0)) {
    throw new Error('请填写大于 0 的密钥额度');
  }
  const response = await requestNewApiInUserContext<any>(userId, remoteUser.id, {
    method: 'POST',
    path: '/api/token/',
    body: {
      name: String(input.name || '').trim() || `默认密钥 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      expired_time: Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? Math.floor(Date.now() / 1000) + expiresInSeconds : -1,
      remain_quota: unlimitedQuota ? 0 : remainQuota,
      unlimited_quota: unlimitedQuota,
      model_limits_enabled: input.modelLimitsEnabled === true,
      model_limits: String(input.modelLimits || '').trim(),
      allow_ips: String(input.allowIps || '').trim(),
      group,
      cross_group_retry: input.crossGroupRetry === true
    }
  });
  const payload = assertNewApiSuccess<any>(response, '创建 new-api 密钥失败');
  let token = normalizeTokenItem(payload);
  if (!token.id) {
    const existingKeyIds = new Set(existingKeys.map((item) => item.id));
    const listResponse = await requestNewApiInUserContext<any>(userId, remoteUser.id, {
      method: 'GET',
      path: '/api/token/'
    });
    const listPayload = assertNewApiSuccess<any>(listResponse, '获取新建 API 密钥失败');
    const items = Array.isArray(listPayload)
      ? listPayload
      : Array.isArray(listPayload?.items)
        ? listPayload.items
        : Array.isArray(listPayload?.data)
          ? listPayload.data
          : [];
    const created = items.map(normalizeTokenItem).find((item: NewApiTokenItem) => item.id && !existingKeyIds.has(item.id));
    if (!created) {
      throw new Error('密钥已创建，但无法识别新密钥');
    }
    token = created;
  }
  const secret = (await getNewApiKeySecret(userId, token.id)).secret;
  await rememberDocumentApiKey({ userId, keyId: token.id, secret, name: token.name });
  logNewApi('createKey.success', {
    userId,
    tokenId: token.id,
    tokenName: token.name,
    hasSecret: true
  });
  return {
    token,
    secret
  };
};

export const deleteNewApiKey = async (userId: string, keyId: string) => {
  logNewApi('deleteKey.start', {
    userId,
    keyId
  });
  await ensureProvisionedAccount(userId);
  const remoteUser = await resolveRemoteUser({ userId });
  const response = await requestNewApiInUserContext(userId, remoteUser.id, {
    method: 'DELETE',
    path: `/api/token/${encodeURIComponent(keyId)}`
  });
  assertNewApiSuccess(response, '删除 new-api 密钥失败');
  logNewApi('deleteKey.success', {
    userId,
    keyId
  });
  return { id: keyId };
};

export const getNewApiKeySecret = async (userId: string, keyId: string) => {
  if (!keyId) {
    throw new Error('密钥 ID 不可为空');
  }
  await ensureProvisionedAccount(userId);
  const remoteUser = await resolveRemoteUser({ userId });
  const response = await requestNewApiInUserContext<any>(userId, remoteUser.id, {
    method: 'POST',
    path: `/api/token/${encodeURIComponent(keyId)}/key`
  });
  const payload = assertNewApiSuccess<any>(response, '获取完整 API 密钥失败');
  const secret =
    typeof payload === 'string'
      ? payload
      : typeof payload?.key === 'string'
        ? payload.key
        : typeof payload?.token === 'string'
          ? payload.token
          : typeof payload?.value === 'string'
            ? payload.value
            : '';
  if (!secret) {
    throw new Error('服务未返回完整 API 密钥');
  }
  logNewApi('getKeySecret.success', { userId, keyId });
  const normalizedSecret = secret.startsWith('sk-') ? secret : `sk-${secret}`;
  await rememberDocumentApiKey({ userId, keyId, secret: normalizedSecret });
  return { secret: normalizedSecret };
};

export const relayNewApiChatCompletion = async (input: NewApiChatCompletionInput) => {
  const authorization = String(input.authorization || '').trim();
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    throw new Error('Authorization Bearer API Key 不可为空');
  }
  const response = await requestNewApi<any>({
    method: 'POST',
    path: '/v1/chat/completions',
    bearerToken: token,
    body: input.body
  });
  if (response.statusCode >= 400) {
    throw new Error(extractErrorMessage(response.data, '模型请求失败'));
  }
  return response.data;
};

export const proxyNewApiOpenAiRequest = async (input: {
  method: 'GET' | 'POST';
  path: string;
  authorization: string;
  body?: unknown;
  rawBody?: NodeJS.ReadableStream;
  contentType?: string;
  contentLength?: string;
}, output: ServerResponse) => {
  const token = String(input.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    throw new Error('Authorization Bearer API Key 不可为空');
  }
  const config = getConfig();
  const url = new URL(input.path, `${config.baseUrl}/`);
  const bodyText = input.rawBody || input.body === undefined ? '' : JSON.stringify(input.body);
  await new Promise<void>((resolve, reject) => {
    const requestOptions = {
      method: input.method,
      headers: {
        Accept: 'application/json, text/event-stream',
        ...(input.rawBody
          ? {
              ...(input.contentType ? { 'Content-Type': input.contentType } : {}),
              ...(input.contentLength ? { 'Content-Length': input.contentLength } : {})
            }
          : bodyText ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyText) } : {}),
        Authorization: `Bearer ${token}`
      }
    };
    const proxyRequest = url.protocol === 'https:'
      ? https.request(url, requestOptions as any, (response) => {
          output.writeHead(response.statusCode || 502, response.headers);
          response.pipe(output);
          response.on('end', resolve);
        })
      : http.request(url, requestOptions, (response) => {
          output.writeHead(response.statusCode || 502, response.headers);
          response.pipe(output);
          response.on('end', resolve);
    });
    proxyRequest.on('error', reject);
    if (input.rawBody) {
      input.rawBody.on('error', reject);
      input.rawBody.pipe(proxyRequest);
    } else {
      if (bodyText) proxyRequest.write(bodyText);
      proxyRequest.end();
    }
  });
};
