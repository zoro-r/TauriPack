import type Router from '@koa/router';
import {
  getMemberDebugAccess,
  postMemberDebugSession,
  getAdminOrder,
  getAdminOrders,
  getAdminMemberPlans,
  getAdminUser,
  getAdminUsers,
  postAdminMemberPlan,
  postAdminOrderSync,
  putAdminMemberPlan,
  putAdminUserMember,
  putAdminUserRole
} from '@/controllers/adminController';

export default function adminRouter(router: Router) {
  router.get('/api/admin/member-debug/access', getMemberDebugAccess);
  router.post('/api/admin/users/:id/debug-session', postMemberDebugSession);
  router.get('/api/admin/users', getAdminUsers);
  router.get('/api/admin/users/:id', getAdminUser);
  router.put('/api/admin/users/:id/role', putAdminUserRole);
  router.put('/api/admin/users/:id/member', putAdminUserMember);

  router.get('/api/admin/member/orders', getAdminOrders);
  router.get('/api/admin/member/orders/:id', getAdminOrder);
  router.post('/api/admin/member/orders/:id/sync', postAdminOrderSync);
  router.get('/api/admin/member/plans', getAdminMemberPlans);
  router.post('/api/admin/member/plans', postAdminMemberPlan);
  router.put('/api/admin/member/plans/:id', putAdminMemberPlan);
}
