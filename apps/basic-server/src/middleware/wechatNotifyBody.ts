import type Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import { wechatFail } from '@/utils/tool';

export const wechatNotifyBody: Koa.Middleware = async (ctx, next) => {
  if (ctx.path !== '/api/pay/wechat/notify' || ctx.method.toUpperCase() !== 'POST') {
    return bodyParser()(ctx, next);
  }
  try {
    const chunks: Uint8Array[] = [];
    await new Promise<void>((resolve, reject) => {
      ctx.req.on('data', chunk => chunks.push(new Uint8Array(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))));
      ctx.req.on('end', resolve);
      ctx.req.on('error', reject);
    });
    // Decode once so a network chunk boundary cannot corrupt a multibyte UTF-8 character.
    const rawBody = Buffer.concat(chunks).toString('utf8');
    ctx.state.rawBody = rawBody;
    ctx.request.body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    ctx.body = wechatFail('Invalid notify payload');
    ctx.status = 500;
    return;
  }
  await next();
  // Keep controllers on the shared response contract, while letting WeChat retry failed delivery.
  if (ctx.body && (ctx.body as { code?: string }).code === 'FAIL') ctx.status = 500;
};
