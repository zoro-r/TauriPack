import type Router from '@koa/router';
import {
  exchangeToken,
  getMenus,
  getWechatQr,
  getWechatStatus,
  getMe,
  logoutToken,
  refreshToken,
  wechatCallback
} from '@/controllers/authController';

export default function authRouter(router: Router) {
  router.get('/api/auth/wechat/qr', getWechatQr);
  router.get('/api/auth/wechat/callback', wechatCallback);
  router.get('/api/auth/wechat/status', getWechatStatus);
  router.get('/api/auth/me', getMe);
  router.get('/api/auth/menus', getMenus);
  router.post('/api/auth/token', exchangeToken);
  router.post('/api/auth/refresh', refreshToken);
  router.post('/api/auth/logout', logoutToken);
}
