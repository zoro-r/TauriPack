import type Koa from 'koa';
import { verifyAccessToken } from '@/services/authService';
import UserModel from '@/models/User';

type AuthContext = Pick<Koa.ParameterizedContext, 'headers' | 'cookies'>;

export const getBearerToken = (ctx: AuthContext) => {
  const auth = String(ctx.headers.authorization || '');
  if (auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  return String(ctx.cookies.get('accessToken') || '');
};

export const requireUser = async (ctx: AuthContext) => {
  const token = getBearerToken(ctx);
  if (!token) {
    throw new Error('未登录');
  }
  const payload = await verifyAccessToken(token);
  const user = await UserModel.findById(payload.sub);
  if (!user) {
    throw new Error('用户不存在');
  }
  return user;
};

export const requireAdmin = async (ctx: AuthContext) => {
  const user = await requireUser(ctx);
  if (user.role !== 'admin') {
    throw new Error('需要管理员权限');
  }
  return user;
};
