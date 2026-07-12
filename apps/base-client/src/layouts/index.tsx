import React, { useEffect, useState } from 'react';
import { Avatar, Button, Dropdown, Form, Input, MenuProps, Modal, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Outlet, history, useLocation } from '@umijs/max';
import request from '../utils/request';
import { serialColumn } from '../utils/tableColumns';
import {
  clearAuthStorage,
  catalogAccountKindLabelOf,
  formatDateTime,
  getCurrentUserFromStorage,
  nameInitial,
  type CurrentUser,
  type NavMenuItem
} from '../utils/auth';
import '../pages/index.css';

const defaultMenus: NavMenuItem[] = [{ key: 'apps', label: '应用广场', path: '/' }];
const plainLayoutPaths = ['/auth', '/forbidden', '/login', '/success'];
const qrImageOf = (value: string) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(value)}`;

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

interface RedeemResult {
  success: boolean;
  message: string;
  benefit?: {
    title?: string;
    description?: string;
    expiredAt?: string;
  };
}

interface RedeemPreview {
  code: string;
  grantType: 'member' | 'app';
  batchName: string;
  ownership?: {
    alreadyOwned: boolean;
    statusText: string;
    currentExpiredAt?: string;
    nextExpiredAt?: string;
  };
  benefit?: {
    title?: string;
    description?: string;
    durationDays?: number;
    durationLabel?: string;
    appName?: string;
    expiredAt?: string;
  };
}

interface MemberOrderPayload {
  id: string;
  orderNo: string;
  amount: number;
  status: 'pending' | 'paid' | 'closed' | 'refunded';
  payChannel: 'wechat_native';
  codeUrl: string;
}

interface UserOrderItem {
  _id: string;
  orderNo: string;
  orderType?: 'member' | 'app' | 'recharge' | 'service' | 'redeem';
  amount: number;
  status: 'pending' | 'paid' | 'closed' | 'refunded';
  payChannel: 'wechat_native' | 'redeem_code';
  title?: string;
  description?: string;
  snapshot?: Record<string, any>;
  wechatTransactionId?: string;
  paidAt?: string;
  expiredAt?: string;
  createdAt: string;
  planId?:
    | string
    | {
        _id: string;
        name?: string;
        code?: string;
        durationDays?: number;
      };
}

const userOrderTypeLabelOf = (value?: UserOrderItem['orderType']) => {
  if (value === 'redeem') return '兑换码';
  if (value === 'app') return '应用订单';
  if (value === 'recharge') return '充值订单';
  if (value === 'service') return '服务订单';
  return '会员订单';
};

const userOrderAmountLabelOf = (order: UserOrderItem) =>
  order.orderType === 'redeem' ? '--' : `¥${order.amount}`;

interface LoginStatePayload {
  state: string;
  expiresAt: string;
  qrUrl: string;
}

interface LoginStatusPayload {
  status: 'PENDING' | 'SCANNED' | 'SUCCESS' | 'EXPIRED';
  loginCode?: string;
}

const RootLayout: React.FC = () => {
  const [messageApi, contextHolder] = message.useMessage();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(() => getCurrentUserFromStorage());
  const [menus, setMenus] = useState<NavMenuItem[]>(defaultMenus);
  const [memberInfo, setMemberInfo] = useState<MemberInfo | null>(null);
  const [memberPlans, setMemberPlans] = useState<MemberPlan[]>([]);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [payingPlanCode, setPayingPlanCode] = useState('');
  const [memberOrder, setMemberOrder] = useState<MemberOrderPayload | null>(null);
  const [memberPayStatus, setMemberPayStatus] = useState('请选择会员套餐');
  const [userOrdersOpen, setUserOrdersOpen] = useState(false);
  const [userOrdersLoading, setUserOrdersLoading] = useState(false);
  const [userOrders, setUserOrders] = useState<UserOrderItem[]>([]);
  const [redeemModalOpen, setRedeemModalOpen] = useState(false);
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [redeemPreviewLoading, setRedeemPreviewLoading] = useState(false);
  const [redeemPreview, setRedeemPreview] = useState<RedeemPreview | null>(null);
  const [redeemResult, setRedeemResult] = useState<RedeemResult | null>(null);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginState, setLoginState] = useState<LoginStatePayload | null>(null);
  const [loginStatusText, setLoginStatusText] = useState('请使用微信扫码登录');
  const location = useLocation();
  const [redeemForm] = Form.useForm<{ code: string }>();

  const isPlainLayout = plainLayoutPaths.some((path) => location.pathname.startsWith(path));

  const fetchCurrentUser = async () => {
    const user = await request<CurrentUser>('/api/auth/me', { alert: false });
    localStorage.setItem('userInfo', JSON.stringify(user));
    setCurrentUser(user);
    return user;
  };

  const fetchMenus = async () => {
    const data = await request<NavMenuItem[]>('/api/auth/menus', { alert: false });
    setMenus(data.length ? data : defaultMenus);
  };

  const fetchMemberInfo = async () => {
    const data = await request<MemberInfo>('/api/member/me', { alert: false });
    setMemberInfo(data);
    return data;
  };

  const fetchMemberPlans = async () => {
    const data = await request<MemberPlan[]>('/api/member/plans', { alert: false });
    setMemberPlans(data);
    return data;
  };

  useEffect(() => {
    if (isPlainLayout) {
      return;
    }
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
    fetchMenus().catch(() => undefined);
  }, [isPlainLayout]);

  useEffect(() => {
    if (isPlainLayout) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('openMemberCenter') !== '1') {
      return;
    }
    openMemberCenter();
    params.delete('openMemberCenter');
    const nextQuery = params.toString();
    history.replace(`${location.pathname}${nextQuery ? `?${nextQuery}` : ''}`);
  }, [currentUser, isPlainLayout, location.pathname]);

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
          await request('/api/auth/token', {
            method: 'POST',
            data: { loginCode: statusData.loginCode },
            alert: false
          });
          window.location.reload();
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
        }>(`/api/member/orders/${memberOrder.id}`, { alert: false });

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

  const openMemberCenter = () => {
    if (!currentUser) {
      handleLoginEntry();
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
    setMenus(defaultMenus);
    history.replace('/');
    messageApi.success('已退出当前账号');
  };

  const loadUserOrders = async () => {
    setUserOrdersLoading(true);
    try {
      const data = await request<UserOrderItem[]>('/api/member/orders');
      setUserOrders(data);
    } finally {
      setUserOrdersLoading(false);
    }
  };

  const openUserOrders = async () => {
    if (!currentUser) {
      handleLoginEntry();
      return;
    }
    setUserOrdersOpen(true);
    await loadUserOrders();
  };

  const openRedeemCenter = () => {
    if (!currentUser) {
      handleLoginEntry();
      return;
    }
    setRedeemResult(null);
    setRedeemPreview(null);
    redeemForm.setFieldsValue({ code: '' });
    setRedeemModalOpen(true);
  };

  const previewRedeem = async () => {
    const values = await redeemForm.validateFields();
    setRedeemPreviewLoading(true);
    try {
      const data = await request<RedeemPreview>('/api/redeem/preview', {
        method: 'POST',
        data: values
      });
      setRedeemPreview(data);
      setRedeemResult(null);
    } finally {
      setRedeemPreviewLoading(false);
    }
  };

  const submitRedeem = async () => {
    const values = await redeemForm.validateFields();
    setRedeemLoading(true);
    try {
      const data = await request<RedeemResult>('/api/redeem/submit', {
        method: 'POST',
        data: values
      });
      setRedeemResult(data);
      setRedeemPreview(null);
      await fetchMemberInfo().catch(() => undefined);
      messageApi.success('兑换成功');
    } finally {
      setRedeemLoading(false);
    }
  };

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'orders',
      label: '我的订单'
    },
    {
      key: 'redeem',
      label: '兑换中心'
    },
    {
      key: 'member',
      label: '会员中心'
    },
    {
      key: 'logout',
      label: '退出登录',
      danger: true
    }
  ];

  if (isPlainLayout) {
    return <Outlet />;
  }

  return (
    <>
      {contextHolder}
      <div className="catalog-page">
        <div className="catalog-page__inner">
          <div className="catalog-page__hero">
            <div className="catalog-page__hero-left">
              <div className="catalog-brand">
                <img
                  className="catalog-brand__logo-image"
                  src="https://yun.cbysaas.com/yzd_kp/uniacid1/u0/img/2026/4/15/1776242248057637290.png"
                  alt="应用管理台"
                />
              </div>
              <nav className="catalog-topnav" aria-label="主导航">
                {menus.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`catalog-topnav__item ${location.pathname === (item.path || '/') ? 'is-active' : ''}`}
                    onClick={() => history.push(item.path || '/')}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>
            <div className="catalog-page__hero-right">
              <div className="catalog-user-panel">
                <Avatar size={42} src={currentUser?.avatar} className="catalog-user-panel__avatar">
                  {nameInitial(currentUser?.nickname)}
                </Avatar>
                <div className="catalog-user-panel__meta">
                  <div className="catalog-user-panel__name">
                    {currentUser?.nickname || '游客访问'}
                  </div>
                  <div className="catalog-user-panel__sub">
                    {catalogAccountKindLabelOf(currentUser, memberInfo)}
                  </div>
                </div>
                {currentUser ? (
                  <Space.Compact>
                    <Button onClick={openMemberCenter}>
                      {memberInfo?.isMember ? '会员' : '开通会员'}
                    </Button>
                    <Dropdown
                      menu={{
                        items: userMenuItems,
                        onClick: ({ key }) => {
                          if (key === 'orders') {
                            openUserOrders().catch(() => undefined);
                            return;
                          }
                          if (key === 'redeem') {
                            openRedeemCenter();
                            return;
                          }
                          if (key === 'member') {
                            openMemberCenter();
                            return;
                          }
                          if (key === 'logout') {
                            handleLogout();
                          }
                        }
                      }}
                      trigger={['click']}
                    >
                      <Button>个人中心</Button>
                    </Dropdown>
                  </Space.Compact>
                ) : (
                  <Button onClick={handleLoginEntry}>登录</Button>
                )}
              </div>
            </div>
          </div>
          <Outlet />
        </div>
      </div>

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
            <div className="catalog-login__empty">正在生成登录二维码...</div>
          )}
        </div>
      </Modal>

      <Modal
        title="我的订单"
        open={userOrdersOpen}
        onCancel={() => {
          setUserOrdersOpen(false);
        }}
        footer={null}
        width={920}
      >
        <Table<UserOrderItem>
          rowKey="_id"
          dataSource={userOrders}
          loading={userOrdersLoading}
          pagination={false}
          scroll={{ x: 860 }}
          columns={
            [
              serialColumn<UserOrderItem>(),
              {
                title: '订单号',
                dataIndex: 'orderNo'
              },
              {
                title: '类型',
                dataIndex: 'orderType',
                render: (value: UserOrderItem['orderType']) => userOrderTypeLabelOf(value)
              },
              {
                title: '标题',
                render: (_, record) =>
                  typeof record.planId === 'string'
                    ? record.title || record.description || '--'
                    : record.planId?.name || record.title || record.description || '--'
              },
              {
                title: '金额',
                render: (_, record) => userOrderAmountLabelOf(record)
              },
              {
                title: '状态',
                dataIndex: 'status',
                render: (value: UserOrderItem['status'], record) => (
                  <Tag color={value === 'paid' ? 'green' : value === 'pending' ? 'gold' : value === 'refunded' ? 'red' : 'default'}>
                    {record.orderType === 'redeem'
                      ? '已兑换'
                      : value === 'paid'
                        ? '已支付'
                        : value === 'pending'
                          ? '待支付'
                          : value === 'refunded'
                            ? '已退款'
                            : '已关闭'}
                  </Tag>
                )
              },
              {
                title: '创建时间',
                dataIndex: 'createdAt',
                render: formatDateTime
              }
            ] as ColumnsType<UserOrderItem>
          }
        />
      </Modal>

      <Modal
        title="兑换中心"
        open={redeemModalOpen}
        onCancel={() => {
          setRedeemModalOpen(false);
          setRedeemPreview(null);
          setRedeemResult(null);
        }}
        footer={null}
        width={520}
      >
        <div className="redeem-panel redeem-panel--modal">
          <div className="redeem-panel__hero">
            <div>
              <Typography.Title level={4}>输入兑换码，确认权益后再兑换</Typography.Title>
              <Typography.Paragraph type="secondary">
                先核对到账内容，再完成本次兑换。
              </Typography.Paragraph>
            </div>
          </div>

          <Form form={redeemForm} layout="vertical">
            <div className="redeem-panel__form-row">
              <Form.Item
                className="redeem-panel__form-item"
                label="兑换码"
                name="code"
                rules={[{ required: true, message: '请输入兑换码' }]}
              >
                <Input placeholder="请输入兑换码" size="large" />
              </Form.Item>
              <Button type="default" size="large" loading={redeemPreviewLoading} onClick={previewRedeem}>
                查询兑换内容
              </Button>
            </div>
          </Form>

        {redeemPreview ? (
          <div className="redeem-card redeem-card--preview">
            <div className="redeem-card__head">
              <div>
                <div className="redeem-card__eyebrow">兑换内容预览</div>
                <Typography.Title level={5}>{redeemPreview.benefit?.title || '待兑换权益'}</Typography.Title>
              </div>
              <Tag color={redeemPreview.grantType === 'app' ? 'blue' : 'gold'}>
                {redeemPreview.grantType === 'app' ? '单应用权限' : '会员权益'}
              </Tag>
            </div>
            <Typography.Paragraph className="redeem-card__desc">
              {redeemPreview.benefit?.description || '请确认兑换内容后再提交兑换'}
            </Typography.Paragraph>
            {redeemPreview.ownership?.statusText && !redeemPreview.ownership?.currentExpiredAt ? (
              <Typography.Paragraph type="secondary" className="redeem-card__hint">
                {redeemPreview.ownership.statusText}
              </Typography.Paragraph>
            ) : null}
            {redeemPreview.ownership?.currentExpiredAt ? (
              <div className="redeem-card__notice">
                <span className="redeem-card__notice-label">续期提醒</span>
                <strong>
                  当前有效至 {formatDateTime(redeemPreview.ownership.currentExpiredAt)}，确认兑换后将在此基础上顺延
                </strong>
              </div>
            ) : null}
            <div className="redeem-card__meta">
              <div className="redeem-card__meta-item">
                <span>兑换活动</span>
                <strong>{redeemPreview.batchName}</strong>
              </div>
              {redeemPreview.grantType === 'member' ? (
                <>
                  <div className="redeem-card__meta-item">
                    <span>兑换时长</span>
                    <strong>
                      {redeemPreview.benefit?.durationLabel || `${redeemPreview.benefit?.durationDays || 0} 天`}
                    </strong>
                  </div>
                </>
              ) : (
                <>
                  <div className="redeem-card__meta-item">
                    <span>应用权限</span>
                    <strong>{redeemPreview.benefit?.appName || '--'}</strong>
                  </div>
                  <div className="redeem-card__meta-item">
                    <span>兑换时长</span>
                    <strong>
                      {redeemPreview.benefit?.durationLabel || `${redeemPreview.benefit?.durationDays || 0} 天`}
                    </strong>
                  </div>
                </>
              )}
            </div>
            <Space className="redeem-card__actions">
              <Button type="primary" size="large" loading={redeemLoading} onClick={submitRedeem}>
                确认兑换
              </Button>
              <Typography.Text type="secondary">确认后将立即到账，无法撤销</Typography.Text>
            </Space>
          </div>
        ) : null}

        {redeemResult?.benefit ? (
          <div className="redeem-card redeem-card--success">
            <div className="redeem-card__head">
              <div>
                <div className="redeem-card__eyebrow">兑换成功</div>
                <Typography.Title level={5}>{redeemResult.benefit.title || '权益已到账'}</Typography.Title>
              </div>
              <Tag color="green">已到账</Tag>
            </div>
            <Typography.Paragraph className="redeem-card__desc">
              {redeemResult.benefit.description || '会员权益已到账'}
            </Typography.Paragraph>
            {redeemResult.benefit.expiredAt ? (
              <div className="redeem-card__meta">
                <div className="redeem-card__meta-item">
                  <span>到期时间</span>
                  <strong>{formatDateTime(redeemResult.benefit.expiredAt)}</strong>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
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
            <div
              className={`member-panel__badge ${
                memberInfo?.isMember || currentUser?.role === 'admin' ? 'is-active' : ''
              }`}
            >
              {catalogAccountKindLabelOf(currentUser, memberInfo)}
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
    </>
  );
};

export default RootLayout;
