import React, { useEffect, useMemo, useState } from 'react';
import {
  Avatar,
  Button,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Typography,
  Upload,
  message
} from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import request from '../utils/request';
import {
  clearAuthStorage,
  formatDateTime,
  getCurrentUserFromStorage,
  nameInitial,
  type CurrentUser
} from '../utils/auth';
import './index.css';

interface AppCategory {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  sort: number;
  isActive: boolean;
}

interface AppItem {
  _id: string;
  name: string;
  slug: string;
  accessLevel: 'login' | 'member' | 'explicit';
  summary?: string;
  description?: string;
  cover?: string;
  publisher?: string;
  content?: string;
  packageName?: string;
  packageUrl?: string;
  entryUrl?: string;
  categoryId:
    | string
    | {
        _id: string;
        name: string;
        slug: string;
      };
}

interface CategoryFormValues {
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  sort?: number;
  isActive: boolean;
}

interface AppFormValues {
  name: string;
  categoryId: string;
  accessLevel: 'login' | 'member' | 'explicit';
  summary?: string;
  description?: string;
  cover?: string;
}

interface AppPackageUploadResult {
  appSlug: string;
  packageName: string;
  packageUrl: string;
  entryUrl: string;
}

interface AppCoverUploadResult {
  coverUrl: string;
}

interface LoginStatePayload {
  state: string;
  expiresAt: string;
  qrUrl: string;
}

interface LoginStatusPayload {
  status: 'PENDING' | 'SCANNED' | 'SUCCESS' | 'EXPIRED';
  loginCode?: string;
}

interface MemberPlan {
  _id: string;
  name: string;
  code: string;
  price: number;
  originalPrice?: number;
  durationDays: number;
  description?: string;
  isVisibleToUser?: boolean;
}

interface MemberInfo {
  isMember: boolean;
  memberLevel: string;
  status: 'active' | 'expired';
  startedAt?: string;
  expiredAt?: string;
}

interface MemberOrderPayload {
  id: string;
  orderNo: string;
  amount: number;
  status: 'pending' | 'paid' | 'closed' | 'refunded';
  payChannel: 'wechat_native';
  codeUrl: string;
}

interface AppAccessPayload {
  allowed: boolean;
  reason: 'login' | 'entitlement' | 'member' | 'explicit_required' | 'member_required';
}

const categoryNameOf = (categoryId: AppItem['categoryId']) =>
  typeof categoryId === 'string' ? '' : categoryId?.name || '';

const resolveAppAssetUrl = (value?: string) => {
  if (!value) {
    return '';
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.pathname.startsWith('/static/')) {
        return `${window.location.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      return value;
    }
    return value;
  }
  if (value.startsWith('/')) {
    return `${window.location.origin}${value}`;
  }
  return value;
};

const qrImageOf = (value: string) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(value)}`;

const HomePage: React.FC = () => {
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<AppCategory[]>([]);
  const [apps, setApps] = useState<AppItem[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string>('all');
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryManageOpen, setCategoryManageOpen] = useState(false);
  const [appModalOpen, setAppModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<AppCategory | null>(null);
  const [editingApp, setEditingApp] = useState<AppItem | null>(null);
  const [selectedApp, setSelectedApp] = useState<AppItem | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [memberInfo, setMemberInfo] = useState<MemberInfo | null>(null);
  const [memberPlans, setMemberPlans] = useState<MemberPlan[]>([]);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [memberLoading, setMemberLoading] = useState(false);
  const [payingPlanCode, setPayingPlanCode] = useState('');
  const [memberOrder, setMemberOrder] = useState<MemberOrderPayload | null>(null);
  const [memberPayStatus, setMemberPayStatus] = useState('请选择会员套餐');
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginState, setLoginState] = useState<LoginStatePayload | null>(null);
  const [loginStatusText, setLoginStatusText] = useState('请使用微信扫码登录');
  const activeTopNav = 'apps';
  const [appPackageFile, setAppPackageFile] = useState<File | null>(null);
  const [appPackageInfo, setAppPackageInfo] = useState<AppPackageUploadResult | null>(null);
  const [appCoverFile, setAppCoverFile] = useState<File | null>(null);
  const [appCoverUploading, setAppCoverUploading] = useState(false);
  const [categoryForm] = Form.useForm<CategoryFormValues>();
  const [appForm] = Form.useForm<AppFormValues>();
  const isAdmin = currentUser?.role === 'admin';

  const loadData = async () => {
    setLoading(true);
    try {
      const [nextCategories, nextApps] = await Promise.all([
        request<AppCategory[]>('/api/app-categories'),
        request<AppItem[]>('/api/apps')
      ]);
      setCategories(nextCategories);
      setApps(nextApps);
    } finally {
      setLoading(false);
    }
  };

  const fetchCurrentUser = async () => {
    const user = await request<CurrentUser>('/api/auth/me', { alert: false });
    localStorage.setItem('userInfo', JSON.stringify(user));
    setCurrentUser(user);
    return user;
  };

  const fetchMemberInfo = async () => {
    const data = await request<MemberInfo>('/api/member/me', { alert: false });
    setMemberInfo(data);
    return data;
  };

  const fetchMemberPlans = async () => {
    const data = await request<MemberPlan[]>('/api/member/plans');
    setMemberPlans(data);
    return data;
  };

  useEffect(() => {
    const cachedUser = getCurrentUserFromStorage();
    setCurrentUser(cachedUser);
    fetchCurrentUser()
      .then(() => {
        fetchMemberInfo().catch(() => {
          setMemberInfo(null);
        });
      })
      .catch(() => {
        clearAuthStorage();
        setCurrentUser(null);
        setMemberInfo(null);
      });
    fetchMemberPlans().catch(() => undefined);
    loadData().catch((error) => {
      messageApi.error(error?.message || '数据加载失败');
    });
  }, [messageApi]);

  const refreshCurrentUser = () => {
    fetchCurrentUser().catch((error) => {
      messageApi.error(error?.message || '刷新用户信息失败');
    });
    fetchMemberInfo().catch(() => undefined);
  };

  const finalizeLogin = async (loginCode: string) => {
    await request('/api/auth/token', {
      method: 'POST',
      data: { loginCode },
      alert: false
    });
    window.location.reload();
  };

  useEffect(() => {
    if (!loginModalOpen || !loginState?.state) {
      return undefined;
    }

    let stopped = false;
    const timer = window.setInterval(async () => {
      if (stopped) {
        return;
      }

      try {
        const statusData = await request<LoginStatusPayload>('/api/auth/wechat/status', {
          params: { state: loginState.state },
          alert: false
        });

        if (statusData.status === 'SUCCESS' && statusData.loginCode) {
          stopped = true;
          window.clearInterval(timer);
          setLoginStatusText('授权完成，正在登录...');
          await finalizeLogin(statusData.loginCode);
          return;
        }

        if (statusData.status === 'EXPIRED') {
          stopped = true;
          window.clearInterval(timer);
          setLoginStatusText('二维码已过期，请刷新后重新扫码');
          return;
        }

        if (statusData.status === 'SCANNED') {
          setLoginStatusText('已扫码，请在手机上确认授权');
          return;
        }

        setLoginStatusText('请使用微信扫码登录');
      } catch {
        setLoginStatusText('登录状态查询失败，请稍后重试');
      }
    }, 2000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [loginModalOpen, loginState]);

  const handleLoginEntry = async () => {
    setLoginLoading(true);
    try {
      const data = await request<LoginStatePayload>('/api/auth/wechat/qr', { alert: false });
      setLoginState(data);
      setLoginStatusText('请使用微信扫码登录');
      setLoginModalOpen(true);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    request('/api/auth/logout', {
      method: 'POST',
      alert: false
    }).catch(() => undefined);
    clearAuthStorage();
    setCurrentUser(null);
    setMemberInfo(null);
    messageApi.success('已退出当前账号');
  };

  useEffect(() => {
    if (!memberModalOpen || !memberOrder?.id || !currentUser) {
      return undefined;
    }

    let stopped = false;
    const timer = window.setInterval(async () => {
      if (stopped) {
        return;
      }
      try {
        const order = await request<{
          status: MemberOrderPayload['status'];
          paidAt?: string;
        }>(`/api/member/orders/${memberOrder.id}`);

        if (order.status === 'paid') {
          stopped = true;
          window.clearInterval(timer);
          setMemberPayStatus('支付成功，会员已到账');
          await fetchMemberInfo().catch(() => undefined);
          return;
        }

        if (order.status === 'closed' || order.status === 'refunded') {
          stopped = true;
          window.clearInterval(timer);
          setMemberPayStatus('订单已关闭，请重新发起支付');
          return;
        }

        setMemberPayStatus('请使用微信扫码完成支付');
      } catch {
        setMemberPayStatus('订单状态查询失败，请稍后重试');
      }
    }, 3000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [memberModalOpen, memberOrder, currentUser]);

  const openMemberCenter = async () => {
    if (!currentUser) {
      await handleLoginEntry();
      return;
    }
    setMemberModalOpen(true);
    setMemberOrder(null);
    setMemberPayStatus('请选择会员套餐');
    fetchMemberPlans().catch(() => undefined);
    fetchMemberInfo().catch(() => undefined);
  };

  const createMemberOrder = async (planCode: string) => {
    setPayingPlanCode(planCode);
    try {
      const order = await request<MemberOrderPayload>('/api/member/orders', {
        method: 'POST',
        data: { planCode }
      });
      setMemberOrder(order);
      setMemberPayStatus('请使用微信扫码完成支付');
    } catch (error) {
      setMemberPayStatus(error instanceof Error ? error.message : '创建会员订单失败');
    } finally {
      setPayingPlanCode('');
    }
  };

  const visibleApps = useMemo(() => {
    if (activeCategoryId === 'all') {
      return apps;
    }
    return apps.filter((item) => {
      if (typeof item.categoryId === 'string') {
        return item.categoryId === activeCategoryId;
      }
      return item.categoryId?._id === activeCategoryId;
    });
  }, [activeCategoryId, apps]);

  const openCategoryCreate = () => {
    setEditingCategory(null);
    categoryForm.setFieldsValue({
      name: '',
      slug: '',
      description: '',
      icon: '',
      sort: 0,
      isActive: true
    });
    setCategoryModalOpen(true);
  };

  const openCategoryManage = async () => {
    if (!memberInfo?.isMember) {
      messageApi.info('分类管理仅会员可用，请先开通会员');
      await openMemberCenter();
      return;
    }
    setCategoryManageOpen(true);
  };

  const openCategoryEdit = (category: AppCategory) => {
    setEditingCategory(category);
    categoryForm.setFieldsValue({
      name: category.name,
      slug: category.slug,
      description: category.description,
      icon: category.icon,
      sort: category.sort,
      isActive: category.isActive
    });
    setCategoryModalOpen(true);
  };

  const openAppCreate = () => {
    setEditingApp(null);
    setAppPackageFile(null);
    setAppPackageInfo(null);
    setAppCoverFile(null);
    appForm.setFieldsValue({
      name: '',
      categoryId:
        activeCategoryId !== 'all' ? activeCategoryId : categories.find((item) => item.isActive)?._id,
      accessLevel: 'login',
      summary: '',
      description: '',
      cover: ''
    });
    setAppModalOpen(true);
  };

  const openAppEdit = (app: AppItem) => {
    setEditingApp(app);
    setSelectedApp(null);
    setAppPackageFile(null);
    setAppCoverFile(null);
    setAppPackageInfo(
      app.packageUrl && app.entryUrl
        ? {
            appSlug: app.slug,
            packageName: app.packageName || `${app.slug}.zip`,
            packageUrl: app.packageUrl,
            entryUrl: app.entryUrl
          }
        : null
    );
    appForm.setFieldsValue({
      name: app.name,
      categoryId: typeof app.categoryId === 'string' ? app.categoryId : app.categoryId._id,
      accessLevel: app.accessLevel || 'member',
      summary: app.summary,
      description: app.description,
      cover: app.cover
    });
    setAppModalOpen(true);
  };

  const uploadAppCover = async (file: File) => {
    setAppCoverUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const data = await request<AppCoverUploadResult>('/api/apps/upload-cover', {
        method: 'POST',
        data: formData,
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      appForm.setFieldValue('cover', data.coverUrl);
      setAppCoverFile(file);
      messageApi.success('封面已上传');
      return false;
    } finally {
      setAppCoverUploading(false);
    }
  };

  const submitCategory = async () => {
    const values = await categoryForm.validateFields();
    setSaving(true);
    try {
      if (editingCategory) {
        await request(`/api/app-categories/${editingCategory._id}`, {
          method: 'PUT',
          data: values
        });
        messageApi.success('分类已更新');
      } else {
        await request('/api/app-categories', {
          method: 'POST',
          data: values
        });
        messageApi.success('分类已创建');
      }
      setCategoryModalOpen(false);
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  const submitApp = async () => {
    const values = await appForm.validateFields();
    if (!editingApp && !appPackageFile) {
      messageApi.error('请上传 zip 安装包');
      return;
    }

    setSaving(true);
    try {
      let packageInfo = appPackageInfo;

      if (appPackageFile) {
        const formData = new FormData();
        formData.append('file', appPackageFile);
        formData.append('appName', values.name);
        if (editingApp?._id) {
          formData.append('appId', editingApp._id);
        }
        packageInfo = await request<AppPackageUploadResult>('/api/apps/upload-package', {
          method: 'POST',
          data: formData,
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        });
        setAppPackageInfo(packageInfo);
      }

      const payload = {
        ...values,
        publisher: currentUser?.nickname || '',
        slug: packageInfo?.appSlug,
        packageName: packageInfo?.packageName,
        packageUrl: packageInfo?.packageUrl,
        entryUrl: packageInfo?.entryUrl
      };

      if (editingApp) {
        await request(`/api/apps/${editingApp._id}`, {
          method: 'PUT',
          data: payload
        });
        messageApi.success('应用已更新');
      } else {
        await request('/api/apps', {
          method: 'POST',
          data: payload
        });
        messageApi.success('应用已创建');
      }
      setAppModalOpen(false);
      setAppPackageFile(null);
      setAppPackageInfo(null);
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = async (id: string) => {
    await request(`/api/app-categories/${id}`, { method: 'DELETE' });
    if (activeCategoryId === id) {
      setActiveCategoryId('all');
    }
    messageApi.success('分类已删除');
    await loadData();
  };

  const deleteApp = async (id: string) => {
    await request(`/api/apps/${id}`, { method: 'DELETE' });
    messageApi.success('应用已删除');
    if (selectedApp?._id === id) {
      setSelectedApp(null);
    }
    await loadData();
  };

  const handleVisitApp = async (app: AppItem) => {
    if (!app.entryUrl) {
      messageApi.info('当前应用暂无访问入口');
      return;
    }

    if (!currentUser) {
      messageApi.info('访问应用需要先登录');
      await handleLoginEntry();
      return;
    }

    if (!isAdmin) {
      const access = await request<AppAccessPayload>(`/api/apps/${app._id}/access`);
      if (!access.allowed) {
        if (access.reason === 'member_required') {
          messageApi.info('该应用需要会员权限，请先开通会员');
          await openMemberCenter();
          return;
        }
        if (access.reason === 'explicit_required') {
          messageApi.info('该应用需要单独授权或兑换码');
          return;
        }
        messageApi.info('当前账号暂无访问权限');
        return;
      }
    }

    window.open(resolveAppAssetUrl(app.entryUrl), '_blank', 'noopener,noreferrer');
  };

  const handleOpenAppDetail = async (app: AppItem) => {
    if (!currentUser) {
      messageApi.info('查看应用需要先登录');
      await handleLoginEntry();
      return;
    }
    if (app.accessLevel === 'member' && !isAdmin && !memberInfo?.isMember) {
      messageApi.info('该应用需要会员权限，请先开通会员');
      await openMemberCenter();
      return;
    }
    setSelectedApp(app);
  };


  return (
    <>
      {contextHolder}
      <div className="catalog-layout">
            <aside className="catalog-sidebar">
              <div className="catalog-sidebar__header">
                {isAdmin ? (
                  <Button size="small" onClick={openCategoryManage}>
                    分类管理
                  </Button>
                ) : null}
              </div>

              <button
                type="button"
                className={`catalog-category ${activeCategoryId === 'all' ? 'is-active' : ''}`}
                onClick={() => setActiveCategoryId('all')}
              >
                全部应用
              </button>

              <div className="catalog-category-list">
                {categories.map((category) => (
                  <button
                    key={category._id}
                    type="button"
                    className={`catalog-category ${activeCategoryId === category._id ? 'is-active' : ''}`}
                    onClick={() => setActiveCategoryId(category._id)}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            </aside>

            <main className="catalog-main">
              <div className="catalog-main__header">
                {isAdmin && activeTopNav === 'apps' ? (
                  <Button type="primary" onClick={openAppCreate}>
                    新建应用
                  </Button>
                ) : null}
              </div>

              {activeTopNav === 'categories' ? (
                <div className="catalog-empty">
                  <Empty description="请通过左上角分类管理查看和维护分类" />
                </div>
              ) : (
                <Spin spinning={loading}>
                  {visibleApps.length ? (
                    <div className="catalog-app-list">
                      {visibleApps.map((app) => (
                        <div key={app._id} className="catalog-app-list__item">
                          <div
                            className="catalog-app-card"
                            onClick={() => void handleOpenAppDetail(app)}
                          >
                            <div className="catalog-app-card__cover">
                              {app.cover ? (
                                <img src={app.cover} alt={app.name} />
                              ) : (
                                <div className="catalog-app-card__cover-fallback">{app.name.slice(0, 1)}</div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="catalog-empty">
                      <Empty description="当前分类下暂无应用" />
                    </div>
                  )}
                </Spin>
              )}
            </main>
      </div>

      <Modal
        title="分类管理"
        open={categoryManageOpen}
        onCancel={() => setCategoryManageOpen(false)}
        footer={
          isAdmin
            ? [
                <Button key="create" type="primary" onClick={openCategoryCreate}>
                  新增分类
                </Button>
              ]
            : null
        }
        width={760}
      >
        <Spin spinning={loading}>
          {categories.length ? (
            <div className="admin-card-list">
              {categories.map((category) => (
                <div key={category._id} className="admin-card">
                  <div>
                    <div className="admin-card__title">{category.name}</div>
                    <div className="admin-card__meta">
                      {category.slug} · {category.isActive ? '启用' : '停用'}
                    </div>
                    <div className="admin-card__desc">{category.description || '--'}</div>
                  </div>
                  {isAdmin ? (
                    <Space>
                      <Button size="small" onClick={() => openCategoryEdit(category)}>
                        编辑
                      </Button>
                      <Popconfirm
                        title="确认删除该分类？"
                        onConfirm={() => deleteCategory(category._id)}
                      >
                        <Button size="small" danger>
                          删除
                        </Button>
                      </Popconfirm>
                    </Space>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="catalog-empty">
              <Empty description="暂无分类" />
            </div>
          )}
        </Spin>
      </Modal>

      <Modal
        title={selectedApp?.name || '应用详情'}
        className="catalog-app-detail-modal"
        open={!!selectedApp}
        onCancel={() => setSelectedApp(null)}
        width={640}
        footer={
          selectedApp
            ? [
                selectedApp.entryUrl ? (
                  <Button key="visit" onClick={() => void handleVisitApp(selectedApp)}>
                    访问应用
                  </Button>
                ) : null,
                isAdmin ? (
                  <Popconfirm
                    key="delete"
                    title="确认删除该应用？"
                    onConfirm={async () => deleteApp(selectedApp._id)}
                  >
                    <Button danger>删除</Button>
                  </Popconfirm>
                ) : null,
                isAdmin ? (
                  <Button
                    key="edit"
                    type="primary"
                    onClick={() => selectedApp && openAppEdit(selectedApp)}
                  >
                    编辑
                  </Button>
                ) : null
              ]
            : null
        }
      >
        {selectedApp ? (
          <div className="catalog-app-detail">
            <div className="catalog-app-detail__hero">
              <div className="catalog-app-detail__cover">
                {selectedApp.cover ? (
                  <img src={selectedApp.cover} alt={selectedApp.name} />
                ) : (
                  <div className="catalog-app-detail__cover-fallback">{selectedApp.name.slice(0, 1)}</div>
                )}
              </div>
              <div className="catalog-app-detail__meta">
                <div className="catalog-app-detail__item">
                  <span>分类</span>
                  <strong>{categoryNameOf(selectedApp.categoryId) || '--'}</strong>
                </div>
                <div className="catalog-app-detail__item">
                  <span>访问级别</span>
                  <strong>
                    {selectedApp.accessLevel === 'login'
                      ? '登录可用'
                      : selectedApp.accessLevel === 'explicit'
                        ? '单独授权'
                        : '会员'}
                  </strong>
                </div>
                <div className="catalog-app-detail__item">
                  <span>发布者</span>
                  <strong>{selectedApp.publisher || '--'}</strong>
                </div>
              </div>
            </div>

            <div className="catalog-app-detail__section">
              <div className="catalog-app-detail__item">
                <span>摘要</span>
                <strong>{selectedApp.summary || '--'}</strong>
              </div>
              <div className="catalog-app-detail__item">
                <span>详细描述</span>
                <strong>{selectedApp.description || '--'}</strong>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        title="微信扫码登录"
        open={loginModalOpen}
        onCancel={() => {
          setLoginModalOpen(false);
          setLoginState(null);
          setLoginStatusText('请使用微信扫码登录');
        }}
        footer={[
          <Button
            key="refresh"
            type="primary"
            loading={loginLoading}
            onClick={handleLoginEntry}
          >
            刷新二维码
          </Button>
        ]}
        width={420}
      >
        <div className="catalog-login">
          {loginState?.qrUrl ? (
            <>
              <div className="catalog-login__qr">
                <img src={qrImageOf(loginState.qrUrl)} alt="微信扫码登录二维码" />
              </div>
              <div className="catalog-login__status">{loginStatusText}</div>
              <Typography.Text className="catalog-login__tip">
                微信扫码后在手机端确认，页面会自动完成登录
              </Typography.Text>
            </>
          ) : (
            <Spin spinning={loginLoading}>
              <div className="catalog-login__empty">正在生成登录二维码...</div>
            </Spin>
          )}
        </div>
      </Modal>

      <Modal
        title="会员中心"
        open={memberModalOpen}
        onCancel={() => {
          setMemberModalOpen(false);
          setMemberOrder(null);
          setMemberPayStatus('请选择会员套餐');
        }}
        footer={null}
        width={760}
      >
        <div className="member-panel">
          <div className="member-panel__hero">
            <div>
              <div className="member-panel__title">
                {memberInfo?.isMember ? '会员已开通' : '开通会员'}
              </div>
              <div className="member-panel__subtitle">
                {memberInfo?.isMember
                  ? `当前会员到期时间：${formatDateTime(memberInfo.expiredAt)}`
                  : '选择套餐后使用微信扫码支付，支付成功自动到账'}
              </div>
            </div>
            <div className={`member-panel__badge ${memberInfo?.isMember ? 'is-active' : ''}`}>
              {memberInfo?.isMember ? 'VIP' : '普通用户'}
            </div>
          </div>

          <div className="member-plan-list">
            {memberPlans.map((plan) => (
              <div key={plan.code} className="member-plan-card">
                <div className="member-plan-card__name">{plan.name}</div>
                <div className="member-plan-card__price">
                  <strong>¥{plan.price}</strong>
                  {plan.originalPrice ? <span>¥{plan.originalPrice}</span> : null}
                </div>
                <div className="member-plan-card__desc">
                  {plan.description || `${plan.durationDays} 天会员时长`}
                </div>
                <Button
                  type="primary"
                  htmlType="button"
                  block
                  loading={payingPlanCode === plan.code}
                  onClick={() => createMemberOrder(plan.code)}
                >
                  立即开通
                </Button>
              </div>
            ))}
          </div>

          <div className="member-pay-section">
            <div className="member-pay-section__header">
              <span>微信支付</span>
              <Typography.Text type="secondary">{memberPayStatus}</Typography.Text>
            </div>

            {memberPayStatus === '支付成功，会员已到账' ? (
              <div className="member-pay-success">
                <div className="member-pay-success__icon">✓</div>
                <div className="member-pay-success__title">开通成功</div>
                <div className="member-pay-success__desc">
                  会员权益已立即到账，现在可以返回继续访问会员应用。
                </div>
                <div className="member-pay-success__meta">
                  {memberInfo?.expiredAt
                    ? `当前会员有效期至 ${formatDateTime(memberInfo.expiredAt)}`
                    : '会员状态已同步更新'}
                </div>
              </div>
            ) : memberOrder ? (
              <div className="member-pay-section__body">
                <div className="member-pay-section__qr">
                  <img src={qrImageOf(memberOrder.codeUrl)} alt="会员充值二维码" />
                </div>
                <div className="member-pay-section__meta">
                  <div>订单号：{memberOrder.orderNo}</div>
                  <div>支付金额：¥{memberOrder.amount}</div>
                  <div>支付方式：微信扫码支付</div>
                </div>
              </div>
            ) : (
              <div className="member-pay-section__empty">选择套餐后，这里会显示支付二维码</div>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        title="个人中心"
        open={profileModalOpen}
        onCancel={() => setProfileModalOpen(false)}
        footer={
          currentUser
            ? [
                <Button key="refresh" onClick={refreshCurrentUser}>
                  刷新资料
                </Button>,
                <Button key="logout" danger onClick={handleLogout}>
                  退出登录
                </Button>
              ]
            : [
                <Button key="login" type="primary" onClick={handleLoginEntry}>
                  去登录
                </Button>
              ]
        }
      >
        <div className="catalog-profile">
          <div className="catalog-profile__card">
            <div className="catalog-profile__hero">
              <Avatar size={60} src={currentUser?.avatar} className="catalog-user-panel__avatar">
                {nameInitial(currentUser?.nickname)}
              </Avatar>
              <div>
                <div className="catalog-profile__name">{currentUser?.nickname || '游客访问'}</div>
                <div className="catalog-profile__status">
                  {currentUser?.wechatOpenId ? '微信账号已登录' : '当前未登录'}
                </div>
              </div>
            </div>
            <div className="catalog-profile__badge">
              {currentUser?.wechatOpenId ? '已登录' : '未登录'}
            </div>
          </div>

          <Divider />

          <div className="catalog-profile__member-entry">
            <div>
              <div className="catalog-profile__section-title">会员服务</div>
              <div className="catalog-profile__member-text">
                {memberInfo?.isMember
                  ? `会员有效期至 ${formatDateTime(memberInfo.expiredAt)}`
                  : '开通会员后可获得更完整的服务权益'}
              </div>
            </div>
            <Button type="primary" onClick={openMemberCenter}>
              {memberInfo?.isMember ? '会员中心' : '立即开通会员'}
            </Button>
          </div>

          <Divider />

          <div className="catalog-profile__summary">
            <div className="catalog-profile__summary-item">
              <span>账户类型</span>
              <strong>{currentUser?.wechatOpenId ? '微信用户' : '游客访问'}</strong>
            </div>
            <div className="catalog-profile__summary-item">
              <span>授权状态</span>
              <strong>{currentUser?.wechatOpenId ? '已授权登录' : '未授权'}</strong>
            </div>
          </div>

          <div className="catalog-profile__section-title">账户资料</div>
          <div className="catalog-profile__grid">
            <div className="catalog-profile__item">
              <span>用户昵称</span>
              <strong>{currentUser?.nickname || '未获取'}</strong>
            </div>
            <div className="catalog-profile__item">
              <span>头像来源</span>
              <strong>{currentUser?.avatar ? '微信头像' : '默认头像'}</strong>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        title={editingCategory ? '编辑分类' : '新建分类'}
        open={categoryModalOpen}
        onCancel={() => setCategoryModalOpen(false)}
        onOk={submitCategory}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={categoryForm} layout="vertical">
          <Form.Item label="分类名称" name="name" rules={[{ required: true, message: '请输入分类名称' }]}>
            <Input placeholder="例如：效率工具" />
          </Form.Item>
          <Form.Item label="分类标识" name="slug" rules={[{ required: true, message: '请输入 slug' }]}>
            <Input placeholder="efficiency-tools" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} placeholder="分类说明" />
          </Form.Item>
          <Form.Item label="图标地址" name="icon">
            <Input placeholder="https://example.com/icon.png" />
          </Form.Item>
          <Form.Item label="排序" name="sort">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="数值越小越靠前" />
          </Form.Item>
          <Form.Item label="启用" name="isActive" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingApp ? '编辑应用' : '新建应用'}
        open={appModalOpen}
        onCancel={() => {
          setAppModalOpen(false);
          setAppPackageFile(null);
          setAppPackageInfo(null);
          setAppCoverFile(null);
        }}
        onOk={submitApp}
        confirmLoading={saving}
        destroyOnClose
        width={760}
      >
        <Form form={appForm} layout="vertical">
          <div className="catalog-form-grid">
            <Form.Item label="应用名称" name="name" rules={[{ required: true, message: '请输入应用名称' }]}>
              <Input placeholder="请输入应用名称" />
            </Form.Item>
            <Form.Item label="分类" name="categoryId" rules={[{ required: true, message: '请选择分类' }]}>
              <Select
                placeholder="请选择所属分类"
                options={categories.map((item) => ({
                  label: item.name,
                  value: item._id
                }))}
              />
            </Form.Item>
          </div>

          <Form.Item label="访问级别" name="accessLevel" rules={[{ required: true, message: '请选择访问级别' }]}>
            <Select
              options={[
                { label: '登录可用', value: 'login' },
                { label: '会员', value: 'member' },
                { label: '单独授权', value: 'explicit' }
              ]}
            />
          </Form.Item>

          <Form.Item label="摘要" name="summary">
            <Input.TextArea rows={2} placeholder="请输入简短摘要，用于卡片展示" />
          </Form.Item>
          <Form.Item label="详细描述" name="description">
            <Input.TextArea rows={4} placeholder="请输入应用的详细描述" />
          </Form.Item>

          <div className="catalog-form-grid catalog-form-grid--single">
            <Form.Item label="应用封面">
              <Upload
                accept=".png,.jpg,.jpeg,.webp"
                maxCount={1}
                beforeUpload={(file) => {
                  const isImage = /\.(png|jpg|jpeg|webp)$/i.test(file.name);
                  if (!isImage) {
                    messageApi.error('只能上传 png/jpg/jpeg/webp 图片');
                    return Upload.LIST_IGNORE;
                  }
                  void uploadAppCover(file);
                  return false;
                }}
                onRemove={() => {
                  setAppCoverFile(null);
                  appForm.setFieldValue('cover', '');
                }}
                fileList={
                  appCoverFile
                    ? [
                        {
                          uid: appCoverFile.uid,
                          name: appCoverFile.name,
                          status: appCoverUploading ? 'uploading' : 'done',
                          originFileObj: appCoverFile
                        } as UploadFile
                      ]
                    : []
                }
              >
                <Button loading={appCoverUploading}>上传封面图片</Button>
              </Upload>
            </Form.Item>
            <Form.Item noStyle shouldUpdate>
              {({ getFieldValue }) =>
                typeof getFieldValue('cover') === 'string' && getFieldValue('cover') ? (
                  <div style={{ marginTop: 8 }}>
                    <img
                      src={resolveAppAssetUrl(getFieldValue('cover'))}
                      alt="应用封面预览"
                      style={{ width: 180, borderRadius: 12, border: '1px solid #e5e7eb' }}
                    />
                  </div>
                ) : null
              }
            </Form.Item>
            <Form.Item hidden name="cover">
              <Input />
            </Form.Item>
          </div>
          <Form.Item
            label="zip 安装包"
            required={!editingApp}
            extra="上传后会统一解压到固定入口 web/index.html"
          >
            <Upload
              accept=".zip"
              maxCount={1}
              beforeUpload={(file) => {
                const isZip = file.name.toLowerCase().endsWith('.zip');
                if (!isZip) {
                  messageApi.error('只能上传 .zip 文件');
                  return Upload.LIST_IGNORE;
                }
                setAppPackageFile(file);
                setAppPackageInfo(null);
                return false;
              }}
              onRemove={() => {
                setAppPackageFile(null);
                if (!editingApp) {
                  setAppPackageInfo(null);
                }
              }}
              fileList={
                appPackageFile
                  ? [
                      {
                        uid: appPackageFile.uid,
                        name: appPackageFile.name,
                        status: 'done',
                        originFileObj: appPackageFile
                      } as UploadFile
                    ]
                  : []
              }
            >
              <Button>选择 zip 文件</Button>
            </Upload>
            {appPackageInfo ? (
              <div style={{ marginTop: 8 }}>
                <div>当前安装包：{appPackageInfo.packageName}</div>
              </div>
            ) : null}
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default HomePage;
