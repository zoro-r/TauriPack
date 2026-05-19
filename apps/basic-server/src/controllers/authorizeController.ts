import type Router from '@koa/router';
import { buildWechatOauthUrl } from '@/services/wechatOauthService';
import { fail, success } from '@/utils/tool';

export const getAuthorizeUrl = async (ctx: Router.RouterContext) => {
  const body = ctx.request.body as { state?: string } | undefined;
  if (!body?.state) {
    ctx.body = fail('state is required');
    return;
  }
  const authorizeUrl = buildWechatOauthUrl(body.state);
  ctx.body = success({ authorizeUrl });
};
