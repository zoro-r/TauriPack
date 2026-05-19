import type Router from '@koa/router';
import { postRedeem, postRedeemPreview } from '@/controllers/redeemController';

export default function redeemRouter(router: Router) {
  router.post('/api/redeem/preview', postRedeemPreview);
  router.post('/api/redeem/submit', postRedeem);
}
