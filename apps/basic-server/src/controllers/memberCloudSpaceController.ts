import type Router from '@koa/router';
import { requireUser } from '@/middleware/auth';
import { authenticateDocumentApiKey } from '@/services/documentService';
import UserModel from '@/models/User';
import { deleteMemberCloudPackage, getMemberCloudQuota, listMemberCloudPackages } from '@/services/memberCloudSpaceService';
import { error as errorResponse, success } from '@/utils/tool';

// 现有平台注册的 API Key 使用 sk- 前缀；JWT/会话 cookie 继续走商城原有流程。
export const isApiKeyRequest = (ctx: Router.RouterContext) => /^Bearer\s+sk-/i.test(String(ctx.headers.authorization || ''));

const cloudUserId = async (ctx: Router.RouterContext) => {
  if (isApiKeyRequest(ctx)) {
    const { userId } = await authenticateDocumentApiKey(String(ctx.headers.authorization));
    if (!(await UserModel.findById(userId))) throw new Error('API Key 关联的用户不存在');
    return userId;
  }
  // 会员过期后仍可查询和删除自己的数据，新增上传仍要求有效会员。
  return (await requireUser(ctx))._id.toString();
};

export const getCloudPackageList = async (ctx: Router.RouterContext) => {
  try {
    ctx.body = success(await listMemberCloudPackages(await cloudUserId(ctx), ctx.query));
  } catch (err) {
    ctx.body = errorResponse('get cloud packages failed', err);
  }
};
export const getCloudQuota = async (ctx: Router.RouterContext) => {
  try {
    ctx.body = success(await getMemberCloudQuota(await cloudUserId(ctx)));
  } catch (err) {
    ctx.body = errorResponse('get cloud quota failed', err);
  }
};
export const removeCloudPackage = async (ctx: Router.RouterContext) => {
  try {
    ctx.body = success(await deleteMemberCloudPackage(await cloudUserId(ctx), String(ctx.params.slug || ctx.params.id || '')));
  } catch (err) {
    ctx.body = errorResponse('delete cloud package failed', err);
  }
};
