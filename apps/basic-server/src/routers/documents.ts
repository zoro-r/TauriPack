import type Router from '@koa/router';
import { getDocumentConsumptionsForSession, getDocumentJob, getDocumentWalletForApiKey, getDocumentWalletForSession, postDocumentApiKeyRegistration, postDocumentParse, postDocumentRechargeOrder } from '@/controllers/documentController';
import { documentUpload } from '@/services/documentService';

export default function documentRouter(router: Router) {
  router.post('/api/v1/documents/parse', documentUpload.single('file'), postDocumentParse);
  router.get('/api/v1/documents/jobs/:id', getDocumentJob);
  router.get('/api/v1/documents/wallet', getDocumentWalletForApiKey);
  router.get('/api/documents/wallet', getDocumentWalletForSession);
  router.get('/api/documents/consumptions', getDocumentConsumptionsForSession);
  router.post('/api/documents/recharge-orders', postDocumentRechargeOrder);
  router.post('/api/documents/api-key-registration', postDocumentApiKeyRegistration);
}
