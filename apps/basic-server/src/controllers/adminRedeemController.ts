import type Router from '@koa/router';
import { requireAdmin, requireUser } from '@/middleware/auth';
import {
  createRedeemBatch,
  generateRedeemCodes,
  listRedeemBatches,
  listRedeemCodes,
  type RedeemBatchInput,
  updateRedeemBatch
} from '@/services/redeemService';
import { error as errorResponse, fail, success } from '@/utils/tool';

export const getAdminRedeemBatches = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    ctx.body = success(await listRedeemBatches());
  } catch (err) {
    ctx.body = errorResponse('get redeem batches failed', err);
  }
};

export const postAdminRedeemBatch = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireAdmin(ctx);
    const body = (ctx.request.body || {}) as RedeemBatchInput;
    ctx.body = success(await createRedeemBatch(body, user._id.toString()), 'redeem batch created');
  } catch (err) {
    ctx.body = errorResponse('create redeem batch failed', err);
  }
};

export const putAdminRedeemBatch = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    const body = (ctx.request.body || {}) as RedeemBatchInput;
    ctx.body = success(await updateRedeemBatch(String(ctx.params.id || ''), body), 'redeem batch updated');
  } catch (err) {
    ctx.body = errorResponse('update redeem batch failed', err);
  }
};

export const getAdminRedeemCodes = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    ctx.body = success(await listRedeemCodes(ctx.query as any));
  } catch (err) {
    ctx.body = errorResponse('get redeem codes failed', err);
  }
};

export const postAdminRedeemCodesGenerate = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    const body = (ctx.request.body || {}) as { batchId?: string; count?: number };
    if (!body.batchId) {
      ctx.body = fail('batchId is required');
      return;
    }
    ctx.body = success(
      await generateRedeemCodes(String(body.batchId), Number(body.count) || 1),
      'redeem codes generated'
    );
  } catch (err) {
    ctx.body = errorResponse('generate redeem codes failed', err);
  }
};
