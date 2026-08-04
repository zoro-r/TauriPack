import type Router from '@koa/router';
import { error as errorResponse, success } from '@/utils/tool';
import {
  authenticateDocumentApiKey,
  createDocumentParseJob,
  createDocumentParseJobFromUrl,
  listDocumentConsumptions,
  getDocumentJobForUser,
  getDocumentWallet,
  registerDocumentApiKey,
  type UploadedDocumentFile
} from '@/services/documentService';
import { requireUser } from '@/middleware/auth';
import { createDocumentCreditOrder } from '@/services/memberService';

const getDocumentClient = async (ctx: Router.RouterContext) =>
  authenticateDocumentApiKey(String(ctx.headers.authorization || ''));

export const postDocumentParse = async (ctx: Router.RouterContext) => {
  try {
    const client = await getDocumentClient(ctx);
    const body = (ctx.request.body || {}) as { modelVersion?: string; url?: string };
    const job = body.url
      ? await createDocumentParseJobFromUrl({ ...client, url: body.url, modelVersion: body.modelVersion })
      : await createDocumentParseJob({ ...client, file: ctx.file as UploadedDocumentFile, modelVersion: body.modelVersion });
    ctx.body = success({ jobId: job._id.toString(), state: job.state, reservedCredits: job.reservedCredits }, 'document parse submitted');
  } catch (err) {
    console.error('[document-controller][parse.error]', { message: err instanceof Error ? err.message : String(err) });
    ctx.body = errorResponse(err instanceof Error ? err.message : 'document parse failed', err);
  }
};

export const getDocumentJob = async (ctx: Router.RouterContext) => {
  try {
    const client = await getDocumentClient(ctx);
    const job = await getDocumentJobForUser(client.userId, String(ctx.params.id || ''));
    ctx.body = success({
      jobId: job._id.toString(), state: job.state, originalName: job.originalName,
      totalPages: job.totalPages, chargedCredits: job.chargedCredits, chargedQuota: job.chargedQuota,
      resultUrl: job.resultUrl, error: job.error, createdAt: job.createdAt, updatedAt: job.updatedAt
    });
  } catch (err) {
    ctx.body = errorResponse(err instanceof Error ? err.message : 'get document parse job failed', err);
  }
};

export const getDocumentWalletForApiKey = async (ctx: Router.RouterContext) => {
  try {
    const client = await getDocumentClient(ctx);
    ctx.body = success(await getDocumentWallet(client.userId));
  } catch (err) {
    ctx.body = errorResponse(err instanceof Error ? err.message : 'get document wallet failed', err);
  }
};

export const getDocumentWalletForSession = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    ctx.body = success(await getDocumentWallet(user._id.toString()));
  } catch (err) {
    ctx.body = errorResponse(err instanceof Error ? err.message : 'get document wallet failed', err);
  }
};

export const getDocumentConsumptionsForSession = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    ctx.body = success(await listDocumentConsumptions(user._id.toString()));
  } catch (err) {
    ctx.body = errorResponse(err instanceof Error ? err.message : 'get document consumptions failed', err);
  }
};

export const postDocumentRechargeOrder = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    const body = (ctx.request.body || {}) as { amount?: unknown };
    const amount = Number(body.amount);
    ctx.body = success(await createDocumentCreditOrder(user._id.toString(), amount), 'document recharge order created');
  } catch (err) {
    ctx.body = errorResponse(err instanceof Error ? err.message : 'create document recharge order failed', err);
  }
};

export const postDocumentApiKeyRegistration = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    const body = (ctx.request.body || {}) as { secret?: unknown };
    await registerDocumentApiKey({ userId: user._id.toString(), secret: String(body.secret || '') });
    ctx.body = success(undefined, 'API Key 已启用文档解析');
  } catch (err) {
    ctx.body = errorResponse(err instanceof Error ? err.message : 'register document API key failed', err);
  }
};
