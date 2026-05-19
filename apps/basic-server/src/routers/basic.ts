import Router from '@koa/router';
import { iconUpload } from '@/services/iconService';
import { convertIcon, getHealth, getRoot } from '@/controllers/basicController';

export default function basicRouter(router: Router) {
  router.get('/api', getRoot);
  router.get('/api/health', getHealth);
  router.post('/api/convert-icon', iconUpload.single('file'), convertIcon);
}
