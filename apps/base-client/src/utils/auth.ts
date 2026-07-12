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

/** 顶栏头像副文案等与账号身份对齐：未登录 · 管理员 · 会员 · 普通用户（互斥）；会员态由服务端 /api/member/me 汇总为 isMember */
export type CatalogAccountKindLabel = '未登录' | '管理员' | '会员' | '普通用户';

export const catalogAccountKindLabelOf = (
  user: CurrentUser | null | undefined,
  member: { isMember?: boolean } | null | undefined
): CatalogAccountKindLabel => {
  if (!user) {
    return '未登录';
  }
  if (user.role === 'admin') {
    return '管理员';
  }
  if (member?.isMember) {
    return '会员';
  }
  return '普通用户';
};
