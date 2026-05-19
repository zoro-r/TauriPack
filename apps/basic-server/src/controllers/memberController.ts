import type Router from '@koa/router';
import {
  createMemberOrder,
  getMemberMe,
  listMemberOrders,
  listMemberPlans,
  settleMemberOrderByWechatCallback,
  syncMemberOrderStatus
} from '@/services/memberService';
import { verifyAccessToken } from '@/services/authService';
import {
  decryptWechatPayCallbackResource,
  type WechatPayCallbackPayload,
  verifyWechatPayCallbackSignature
} from '@/services/wechatPayService';
import { error as errorResponse, fail, success, wechatSuccess } from '@/utils/tool';

const payControllerLog = (tag: string, payload: Record<string, unknown>) => {
  console.info(`[member-controller][${tag}]`, payload);
};

const getUserIdFromContext = async (ctx: Router.RouterContext) => {
  const auth = String(ctx.headers.authorization || '');
  const token = auth.startsWith('Bearer ')
    ? auth.slice(7)
    : String(ctx.cookies.get('accessToken') || '');
  if (!token) {
    throw new Error('未登录');
  }
  const payload = await verifyAccessToken(token);
  return payload.sub;
};

export const getPlans = async (ctx: Router.RouterContext) => {
  try {
    ctx.body = success(await listMemberPlans());
  } catch (err) {
    ctx.body = errorResponse('get member plans failed', err);
  }
};

export const getMe = async (ctx: Router.RouterContext) => {
  try {
    const userId = await getUserIdFromContext(ctx);
    ctx.body = success(await getMemberMe(userId));
  } catch (err) {
    ctx.body = errorResponse('get member info failed', err);
  }
};

export const getOrders = async (ctx: Router.RouterContext) => {
  try {
    const userId = await getUserIdFromContext(ctx);
    ctx.body = success(await listMemberOrders(userId));
  } catch (err) {
    ctx.body = errorResponse('get member orders failed', err);
  }
};

export const postOrder = async (ctx: Router.RouterContext) => {
  try {
    const userId = await getUserIdFromContext(ctx);
    const body = ctx.request.body as { planCode?: string } | undefined;
    if (!body?.planCode) {
      ctx.body = fail('planCode is required');
      return;
    }
    payControllerLog('postOrder.request', {
      userId,
      planCode: body.planCode
    });
    ctx.body = success(await createMemberOrder(userId, body.planCode), 'member order created');
  } catch (err) {
    payControllerLog('postOrder.error', {
      message: err instanceof Error ? err.message : String(err)
    });
    const message = err instanceof Error ? err.message : 'create member order failed';
    ctx.body = errorResponse(message, err);
  }
};

export const getOrderStatus = async (ctx: Router.RouterContext) => {
  try {
    const userId = await getUserIdFromContext(ctx);
    payControllerLog('getOrderStatus.request', {
      userId,
      orderId: String(ctx.params.id || '')
    });
    ctx.body = success(await syncMemberOrderStatus(userId, String(ctx.params.id || '')));
  } catch (err) {
    payControllerLog('getOrderStatus.error', {
      message: err instanceof Error ? err.message : String(err)
    });
    const message = err instanceof Error ? err.message : 'get member order failed';
    ctx.body = errorResponse(message, err);
  }
};

export const wechatPayNotify = async (ctx: Router.RouterContext) => {
  try {
    const rawBody = String(ctx.state.rawBody || '');
    const timestamp = String(ctx.headers['wechatpay-timestamp'] || '');
    const nonce = String(ctx.headers['wechatpay-nonce'] || '');
    const signature = String(ctx.headers['wechatpay-signature'] || '');

    if (!rawBody || !timestamp || !nonce || !signature) {
      payControllerLog('notify.invalidHeaders', {
        hasBody: Boolean(rawBody),
        hasTimestamp: Boolean(timestamp),
        hasNonce: Boolean(nonce),
        hasSignature: Boolean(signature)
      });
      ctx.body = fail('invalid notify headers');
      return;
    }

    const valid = verifyWechatPayCallbackSignature({
      timestamp,
      nonce,
      body: rawBody,
      signature
    });
    if (!valid) {
      payControllerLog('notify.invalidSignature', {
        timestamp,
        nonce
      });
      ctx.body = fail('invalid notify signature');
      return;
    }

    const body = ctx.request.body as WechatPayCallbackPayload;
    const transaction = decryptWechatPayCallbackResource(body.resource);
    payControllerLog('notify.transaction', {
      outTradeNo: transaction.out_trade_no,
      tradeState: transaction.trade_state,
      transactionId: transaction.transaction_id
    });
    await settleMemberOrderByWechatCallback({
      orderNo: transaction.out_trade_no,
      tradeState: transaction.trade_state,
      transactionId: transaction.transaction_id,
      successTime: transaction.success_time
    });

    ctx.body = wechatSuccess('成功');
  } catch (err) {
    console.error('[wechatPayNotify] failed', err);
    payControllerLog('notify.error', {
      message: err instanceof Error ? err.message : String(err)
    });
    ctx.body = fail('notify handle failed');
  }
};
