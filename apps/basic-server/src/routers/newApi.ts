import type Router from '@koa/router';
import {
  deleteNewApiKeyById,
  getNewApiAccount,
  getNewApiWallet,
  getNewApiUsage,
  getNewApiModels,
  getNewApiKeys,
  postNewApiAccountProvision,
  postNewApiRechargeOrder,
  postNewApiKey,
  postNewApiKeySecret,
  postNewApiChatCompletion,
  postNewApiImageGeneration,
  getNewApiOpenAiModels
} from '@/controllers/newApiController';

export default function newApiRouter(router: Router) {
  router.get('/api/newapi/account', getNewApiAccount);
  router.post('/api/newapi/account/provision', postNewApiAccountProvision);
  router.get('/api/newapi/keys', getNewApiKeys);
  router.get('/api/newapi/wallet', getNewApiWallet);
  router.get('/api/newapi/usage', getNewApiUsage);
  router.get('/api/newapi/models', getNewApiModels);
  router.post('/api/newapi/recharge-orders', postNewApiRechargeOrder);
  router.post('/api/newapi/keys', postNewApiKey);
  router.post('/api/newapi/keys/:id/secret', postNewApiKeySecret);
  router.post('/api/newapi/v1/chat/completions', postNewApiChatCompletion);
  router.post('/api/newapi/v1/images/generations', postNewApiImageGeneration);
  router.get('/api/newapi/v1/models', getNewApiOpenAiModels);
  router.delete('/api/newapi/keys/:id', deleteNewApiKeyById);
}
