import type Router from '@koa/router';
import {
  getAdminOrderDetail,
  getAdminUserDetail,
  listAdminOrders,
  listAdminUsers,
  syncAdminOrder,
  updateAdminUserMember,
  updateAdminUserRole
} from '@/services/adminService';
import {
  createMemberPlan,
  listAllMemberPlans,
  type MemberPlanInput,
  updateMemberPlan
} from '@/services/memberService';
import { requireAdmin } from '@/middleware/auth';
import { error as errorResponse, fail, success } from '@/utils/tool';

export const getAdminUsers = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    ctx.body = success(await listAdminUsers(ctx.query));
  } catch (err) {
    ctx.body = errorResponse('get admin users failed', err);
  }
};

export const getAdminUser = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    ctx.body = success(await getAdminUserDetail(String(ctx.params.id || '')));
  } catch (err) {
    ctx.body = errorResponse('get admin user failed', err);
  }
};

export const putAdminUserRole = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    const body = (ctx.request.body || {}) as { role?: 'user' | 'admin' };
    if (!body.role) {
      ctx.body = fail('role is required');
      return;
    }
    ctx.body = success(await updateAdminUserRole(String(ctx.params.id || ''), body.role), 'role updated');
  } catch (err) {
    ctx.body = errorResponse('update user role failed', err);
  }
};

export const putAdminUserMember = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    const body = (ctx.request.body || {}) as {
      isMember?: boolean;
      expiredAt?: string;
      memberLevel?: string;
    };
    ctx.body = success(await updateAdminUserMember(String(ctx.params.id || ''), body), 'member updated');
  } catch (err) {
    ctx.body = errorResponse('update member failed', err);
  }
};

export const getAdminOrders = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    ctx.body = success(await listAdminOrders(ctx.query));
  } catch (err) {
    ctx.body = errorResponse('get admin orders failed', err);
  }
};

export const getAdminOrder = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    ctx.body = success(await getAdminOrderDetail(String(ctx.params.id || '')));
  } catch (err) {
    ctx.body = errorResponse('get admin order failed', err);
  }
};

export const postAdminOrderSync = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    ctx.body = success(await syncAdminOrder(String(ctx.params.id || '')), 'order synced');
  } catch (err) {
    ctx.body = errorResponse('sync order failed', err);
  }
};

export const getAdminMemberPlans = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    ctx.body = success(await listAllMemberPlans());
  } catch (err) {
    ctx.body = errorResponse('get member plans failed', err);
  }
};

export const postAdminMemberPlan = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    const body = (ctx.request.body || {}) as MemberPlanInput;
    ctx.body = success(await createMemberPlan(body), 'member plan created');
  } catch (err) {
    ctx.body = errorResponse('create member plan failed', err);
  }
};

export const putAdminMemberPlan = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    const body = (ctx.request.body || {}) as MemberPlanInput;
    ctx.body = success(await updateMemberPlan(String(ctx.params.id || ''), body), 'member plan updated');
  } catch (err) {
    ctx.body = errorResponse('update member plan failed', err);
  }
};
