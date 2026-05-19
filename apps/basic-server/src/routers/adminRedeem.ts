import type Router from '@koa/router';
import {
  getAdminRedeemBatches,
  getAdminRedeemCodes,
  postAdminRedeemBatch,
  postAdminRedeemCodesGenerate,
  putAdminRedeemBatch
} from '@/controllers/adminRedeemController';

export default function adminRedeemRouter(router: Router) {
  router.get('/api/admin/redeem/batches', getAdminRedeemBatches);
  router.post('/api/admin/redeem/batches', postAdminRedeemBatch);
  router.put('/api/admin/redeem/batches/:id', putAdminRedeemBatch);
  router.get('/api/admin/redeem/codes', getAdminRedeemCodes);
  router.post('/api/admin/redeem/codes/generate', postAdminRedeemCodesGenerate);
}
