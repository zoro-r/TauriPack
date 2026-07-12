import type Router from '@koa/router';
import { requireAdmin } from '@/middleware/auth';
import {
  buildRedeemCodesExportXlsx,
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

export const getAdminRedeemCodesExport = async (ctx: Router.RouterContext) => {
  try {
    await requireAdmin(ctx);
    const { buffer, rowCount, totalMatching, truncated } = await buildRedeemCodesExportXlsx(ctx.query as any);
    const filename = `redeem-codes-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.xlsx`;
    ctx.set(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    ctx.set('X-Export-Row-Count', String(rowCount));
    ctx.set('X-Export-Total-Matching', String(totalMatching));
    ctx.set('X-Export-Truncated', truncated ? '1' : '0');
    ctx.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    ctx.body = buffer;
  } catch (err) {
    ctx.body = errorResponse('export redeem codes failed', err);
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
