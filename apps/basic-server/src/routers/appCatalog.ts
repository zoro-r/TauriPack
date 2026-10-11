import type Router from '@koa/router';
import {
  getAppAccess,
  getAppById,
  getAppList,
  getCategoryList,
  getHomeFeaturedApps,
  postApp,
  postAppCatalogMedia,
  postAppCover,
  postAppPackage,
  postAppPackageWithApiKey,
  postCategory,
  patchAppDisplaySettings,
  putApp,
  putCategory,
  removeApp,
  removeCategory
} from '@/controllers/appCatalogController';
import { appCatalogMediaUpload } from '@/services/appCatalogMediaService';
import { appCoverUpload } from '@/services/appCoverService';
import { appPackageUpload } from '@/services/appPackageService';
import {
  deleteAppTemporaryLink,
  getAppTemporaryLinks,
  getTemporaryLinkPreview,
  postAppTemporaryLink,
  postTemporaryLinkClaim
} from '@/controllers/appTemporaryLinkController';

export default function appCatalogRouter(router: Router) {
  router.get('/api/app-categories', getCategoryList);
  router.post('/api/app-categories', postCategory);
  router.put('/api/app-categories/:id', putCategory);
  router.delete('/api/app-categories/:id', removeCategory);

  router.get('/api/apps', getAppList);
  router.get('/api/apps/home-featured', getHomeFeaturedApps);
  router.get('/api/apps/:id/access', getAppAccess);
  router.get('/api/apps/:id/temporary-links', getAppTemporaryLinks);
  router.post('/api/apps/:id/temporary-links', postAppTemporaryLink);
  router.delete('/api/apps/:id/temporary-links/:linkId', deleteAppTemporaryLink);
  router.post('/api/temporary-links/preview', getTemporaryLinkPreview);
  router.post('/api/temporary-links/claim', postTemporaryLinkClaim);
  router.get('/api/apps/:id', getAppById);
  router.post('/api/apps/upload-cover', appCoverUpload.single('file'), postAppCover);
  router.post(
    '/api/apps/upload-media',
    appCatalogMediaUpload.single('file'),
    postAppCatalogMedia
  );
  router.post('/api/apps/upload-package', appPackageUpload.single('file'), postAppPackage);
  router.post('/api/apps/upload-package/api-key', appPackageUpload.single('file'), postAppPackageWithApiKey);
  router.post('/api/apps', postApp);
  router.put('/api/apps/:id', putApp);
  router.patch('/api/apps/:id/display-settings', patchAppDisplaySettings);
  router.delete('/api/apps/:id', removeApp);
}
