import axios, { type AxiosRequestConfig } from 'axios';
import { message } from 'antd';
import { clearAuthStorage } from './auth';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions extends AxiosRequestConfig {
  method?: HttpMethod;
  data?: any;
  params?: Record<string, any>;
  alert?: boolean;
}

export const apiBase =
  process.env.NODE_ENV === 'development'
    ? 'http://127.0.0.1:3001'
    : window.location.origin;

const AUTH_ERROR_MESSAGES = ['未登录', '登录已过期，请重新登录', '会话已在其他设备登录，请重新登录'];
const AUTH_REFRESH_BYPASS_URLS = ['/api/auth/me', '/api/auth/menus', '/api/member/me', '/api/member/orders'];

let refreshPromise: Promise<boolean> | null = null;

const isAuthErrorMessage = (value?: string) =>
  Boolean(value && AUTH_ERROR_MESSAGES.some((item) => value.includes(item)));

const shouldBypassAuthRecovery = (url: string) =>
  AUTH_REFRESH_BYPASS_URLS.includes(url);

const getApiErrorMessage = (payload: { message?: unknown; error?: unknown }) => {
  const messageText = typeof payload.message === 'string' ? payload.message : '';
  const detailText = typeof payload.error === 'string' ? payload.error : '';
  if (messageText && detailText && messageText !== detailText) {
    return `${messageText}: ${detailText}`;
  }
  return messageText || detailText || '请求失败';
};

const logoutBySessionInvalid = (errorMessage?: string) => {
  clearAuthStorage();
  if (errorMessage) {
    message.error(errorMessage);
  }
  if (typeof window !== 'undefined') {
    window.location.href = '/';
  }
};

const refreshAccessToken = async () => {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = axios
    .post(`${apiBase}/api/auth/refresh`, {}, { withCredentials: true })
    .then((res) => {
      const payload = res.data;
      if (payload?.code !== 200) {
        throw new Error(payload?.message || '刷新登录态失败');
      }
      return true;
    })
    .catch((error) => {
      const errorMessage = error?.response?.data?.message || error?.message || '登录已失效';
      logoutBySessionInvalid(errorMessage);
      return false;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
};

export default function request<T = any>(url: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    alert = true,
    data,
    params,
    headers,
    ...rest
  } = options;
  const requestUrl = /^https?:\/\//i.test(url) ? url : `${apiBase}${url}`;

  const sendRequest = () =>
    axios({
      url: requestUrl,
      method,
      data,
      params,
      headers: {
        ...(headers || {})
      },
      withCredentials: true,
      ...rest
    });

  return sendRequest()
    .then((res) => {
      const payload = res.data;
      if (payload && typeof payload === 'object') {
        const { code, success } = payload as {
          code?: number;
          success?: boolean;
        };
        const isSuccess = success === true || code === 200 || code === undefined;
        if (!isSuccess) {
          const errorMessage = getApiErrorMessage(payload);
          if (
            !shouldBypassAuthRecovery(url) &&
            url !== '/api/auth/refresh' &&
            url !== '/api/auth/token' &&
            isAuthErrorMessage(errorMessage)
          ) {
            return refreshAccessToken().then((refreshed) => {
              if (!refreshed) {
                return Promise.reject(new Error(errorMessage));
              }
              return sendRequest().then((retryRes) => {
                const retryPayload = retryRes.data;
                if (retryPayload && typeof retryPayload === 'object') {
                  const retrySuccess =
                    retryPayload.success === true ||
                    retryPayload.code === 200 ||
                    retryPayload.code === undefined;
                  if (!retrySuccess) {
                    const retryErrorMessage = getApiErrorMessage(retryPayload);
                    return Promise.reject(new Error(retryErrorMessage));
                  }
                  return (retryPayload.data ?? retryPayload) as T;
                }
                return retryPayload as T;
              });
            });
          }
          return Promise.reject(new Error(errorMessage));
        }
        return (payload.data ?? payload) as T;
      }
      return payload as T;
    })
    .catch((error) => {
      const errorMessage =
        error?.response?.data?.message || error?.message || '请求失败';
      if (
        !shouldBypassAuthRecovery(url) &&
        url !== '/api/auth/refresh' &&
        url !== '/api/auth/token' &&
        isAuthErrorMessage(errorMessage)
      ) {
        logoutBySessionInvalid(errorMessage);
      }
      if (alert) message.error(errorMessage);
      return Promise.reject(error);
    });
}
