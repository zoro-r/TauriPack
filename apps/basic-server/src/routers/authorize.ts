import Router from '@koa/router';
import { getAuthorizeUrl } from '@/controllers/authorizeController';

export default function authorizeRouter(router: Router) {
  router.post('/api/auth/wechat/authorize-url', getAuthorizeUrl);
}
