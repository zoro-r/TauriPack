import Router from '@koa/router';
import type Koa from 'koa';
import basicRouter from './basic';
import authRouter from './auth';
import authorizeRouter from './authorize';
import appCatalogRouter from './appCatalog';
import memberRouter from './member';
import adminRouter from './admin';
import redeemRouter from './redeem';
import adminRedeemRouter from './adminRedeem';
import newApiRouter from './newApi';
import documentRouter from './documents';

export const initRouter = (app: Koa) => {
  const router = new Router();

  basicRouter(router);
  authRouter(router);
  authorizeRouter(router);
  appCatalogRouter(router);
  memberRouter(router);
  adminRouter(router);
  redeemRouter(router);
  adminRedeemRouter(router);
  newApiRouter(router);
  documentRouter(router);

  app.use(router.routes());
  app.use(router.allowedMethods());
};
