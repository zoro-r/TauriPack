export interface CurrentUser {
  id?: string;
  nickname?: string;
  avatar?: string;
  wechatOpenId?: string;
  role?: 'user' | 'admin';
}

export interface NavMenuItem {
  key: string;
  label: string;
  path?: string;
}

export const getCurrentUserFromStorage = (): CurrentUser | null => {
  try {
    const raw = localStorage.getItem('userInfo');
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as CurrentUser;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

export const nameInitial = (name?: string) => (name || 'U').slice(0, 1).toUpperCase();

export const formatDateTime = (value?: string) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '--';

export const clearAuthStorage = () => {
  localStorage.removeItem('userInfo');
};
