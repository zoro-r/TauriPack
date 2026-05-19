import type Router from '@koa/router';
import {
  getMe,
  getOrders,
  getOrderStatus,
  getPlans,
  postOrder,
  wechatPayNotify
} from '@/controllers/memberController';

export default function memberRouter(router: Router) {
  router.get('/api/member/plans', getPlans);
  router.get('/api/member/me', getMe);
  router.get('/api/member/orders', getOrders);
  router.post('/api/member/orders', postOrder);
  router.get('/api/member/orders/:id', getOrderStatus);
  router.post('/api/pay/wechat/notify', wechatPayNotify);
}
