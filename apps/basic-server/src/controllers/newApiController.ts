import type Router from '@koa/router';
import { requireUser } from '@/middleware/auth';
import {
  createNewApiKey,
  getNewApiKeySecret,
  listNewApiUsage,
  listNewApiModels,
  proxyNewApiOpenAiRequest,
  getNewApiWallet as getNewApiWalletOverview,
  deleteNewApiKey,
  getNewApiAccountOverview,
  listNewApiKeys,
  provisionNewApiAccount
} from '@/services/newApiService';
import { createApiRechargeOrder } from '@/services/memberService';
import { error as errorResponse, success } from '@/utils/tool';

export const getNewApiAccount = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    ctx.body = success(await getNewApiAccountOverview(user._id.toString()));
  } catch (err) {
    ctx.body = errorResponse('get new-api account failed', err);
  }
};

export const postNewApiAccountProvision = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    ctx.body = success(
      await provisionNewApiAccount({
        _id: user._id,
        nickname: user.nickname
      }),
      'new-api account provisioned'
    );
  } catch (err) {
    ctx.body = errorResponse('provision new-api account failed', err);
  }
};

export const getNewApiKeys = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    ctx.body = success(await listNewApiKeys(user._id.toString()));
  } catch (err) {
    ctx.body = errorResponse('get new-api keys failed', err);
  }
};

export const getNewApiWallet = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    ctx.body = success(await getNewApiWalletOverview(user._id.toString()));
  } catch (err) {
    ctx.body = errorResponse('get API wallet failed', err);
  }
};

export const postNewApiRechargeOrder = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    const body = (ctx.request.body || {}) as { amount?: unknown };
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      ctx.body = errorResponse('充值金额无效');
      return;
    }
    ctx.body = success(await createApiRechargeOrder(user._id.toString(), amount), 'recharge order created');
  } catch (err) {
    ctx.body = errorResponse('create recharge order failed', err);
  }
};

export const getNewApiUsage = async (ctx: Router.RouterContext) => {
  try { const user = await requireUser(ctx); ctx.body = success(await listNewApiUsage(user._id.toString())); }
  catch (err) { ctx.body = errorResponse('get API usage failed', err); }
};

export const getNewApiModels = async (ctx: Router.RouterContext) => {
  try { const user = await requireUser(ctx); ctx.body = success(await listNewApiModels(user._id.toString())); }
  catch (err) { ctx.body = errorResponse('get API models failed', err); }
};

export const postNewApiKey = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    const body = (ctx.request.body || {}) as Parameters<typeof createNewApiKey>[1];
    ctx.body = success(await createNewApiKey(user._id.toString(), body), 'new-api key created');
  } catch (err) {
    ctx.body = errorResponse('create new-api key failed', err);
  }
};

export const postNewApiKeySecret = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    ctx.body = success(await getNewApiKeySecret(user._id.toString(), String(ctx.params.id || '')));
  } catch (err) {
    ctx.body = errorResponse('get API key secret failed', err);
  }
};

export const postNewApiChatCompletion = async (ctx: Router.RouterContext) => {
  try {
    ctx.respond = false;
    await proxyNewApiOpenAiRequest({
      method: 'POST',
      path: '/v1/chat/completions',
      authorization: String(ctx.headers.authorization || ''),
      body: ctx.request.body || {}
    }, ctx.res);
  } catch (err) {
    ctx.respond = false;
    ctx.res.writeHead(401, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ error: { message: err instanceof Error ? err.message : 'Chat completion failed', type: 'invalid_request_error', param: null, code: null } }));
  }
};

export const getNewApiOpenAiModels = async (ctx: Router.RouterContext) => {
  try {
    ctx.respond = false;
    await proxyNewApiOpenAiRequest({ method: 'GET', path: '/v1/models', authorization: String(ctx.headers.authorization || '') }, ctx.res);
  } catch (err) {
    ctx.respond = false;
    ctx.res.writeHead(401, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ error: { message: err instanceof Error ? err.message : 'Models request failed', type: 'invalid_request_error', param: null, code: null } }));
  }
};

export const deleteNewApiKeyById = async (ctx: Router.RouterContext) => {
  try {
    const user = await requireUser(ctx);
    ctx.body = success(
      await deleteNewApiKey(user._id.toString(), String(ctx.params.id || '')),
      'new-api key deleted'
    );
  } catch (err) {
    ctx.body = errorResponse('delete new-api key failed', err);
  }
};
