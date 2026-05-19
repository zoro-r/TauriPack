import type Router from '@koa/router';
import {
  getAppAccess,
  getAppById,
  getAppList,
  getCategoryList,
  postApp,
  postAppCover,
  postAppPackage,
  postCategory,
  putApp,
  putCategory,
  removeApp,
  removeCategory
} from '@/controllers/appCatalogController';
import { appCoverUpload } from '@/services/appCoverService';
import { appPackageUpload } from '@/services/appPackageService';

export default function appCatalogRouter(router: Router) {
  router.get('/api/app-categories', getCategoryList);
  router.post('/api/app-categories', postCategory);
  router.put('/api/app-categories/:id', putCategory);
  router.delete('/api/app-categories/:id', removeCategory);

  router.get('/api/apps', getAppList);
  router.get('/api/apps/:id/access', getAppAccess);
  router.get('/api/apps/:id', getAppById);
  router.post('/api/apps/upload-cover', appCoverUpload.single('file'), postAppCover);
  router.post('/api/apps/upload-package', appPackageUpload.single('file'), postAppPackage);
  router.post('/api/apps', postApp);
  router.put('/api/apps/:id', putApp);
  router.delete('/api/apps/:id', removeApp);
}
