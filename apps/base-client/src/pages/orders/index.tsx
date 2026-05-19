import React, { useEffect, useState } from 'react';
import { Button, Descriptions, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import request from '../../utils/request';
import { formatDateTime } from '../../utils/auth';

interface AdminOrderItem {
  _id: string;
  orderNo: string;
  orderType?: 'member' | 'app' | 'recharge' | 'service' | 'redeem';
  bizId?: string;
  amount: number;
  status: 'pending' | 'paid' | 'closed' | 'refunded';
  payChannel: 'wechat_native' | 'redeem_code';
  wechatTransactionId?: string;
  paidAt?: string;
  expiredAt?: string;
  description: string;
  title?: string;
  snapshot?: Record<string, any>;
  createdAt: string;
  updatedAt?: string;
  userId?:
    | string
    | {
        _id: string;
        nickname?: string;
        avatar?: string;
        wechatOpenId?: string;
        role?: 'user' | 'admin';
      };
  planId?:
    | string
    | {
        _id: string;
        name?: string;
        code?: string;
        price?: number;
        durationDays?: number;
      };
}

interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

interface OrderFilters {
  keyword?: string;
  userKeyword?: string;
  status?: AdminOrderItem['status'];
  orderType?: AdminOrderItem['orderType'];
  payChannel?: AdminOrderItem['payChannel'];
}

const orderUserNameOf = (order: AdminOrderItem) =>
  typeof order.userId === 'string' ? '--' : order.userId?.nickname || order.userId?.wechatOpenId || '--';

const orderPlanNameOf = (order: AdminOrderItem) =>
  typeof order.planId === 'string'
    ? order.title || order.snapshot?.name || order.snapshot?.grantSnapshot?.title || order.description || '--'
    : order.planId?.name || order.title || order.snapshot?.name || order.snapshot?.grantSnapshot?.title || order.description || '--';

const orderTypeLabelOf = (type?: AdminOrderItem['orderType']) => {
  if (type === 'app') return '应用订单';
  if (type === 'recharge') return '充值订单';
  if (type === 'service') return '服务订单';
  if (type === 'redeem') return '兑换订单';
  return '会员订单';
};

const orderStatusColorOf = (status: AdminOrderItem['status']) => {
  if (status === 'paid') return 'green';
  if (status === 'closed') return 'default';
  if (status === 'refunded') return 'red';
  return 'gold';
};

const orderStatusLabelOf = (status: AdminOrderItem['status']) => {
  if (status === 'paid') return '已支付';
  if (status === 'closed') return '已关闭';
  if (status === 'refunded') return '已退款';
  return '待支付';
};

const payChannelLabelOf = (payChannel: AdminOrderItem['payChannel']) =>
  payChannel === 'redeem_code' ? '兑换码' : '微信支付';

const OrdersPage: React.FC = () => {
  const [messageApi, contextHolder] = message.useMessage();
  const [orders, setOrders] = useState<AdminOrderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [syncingOrderId, setSyncingOrderId] = useState<string>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<AdminOrderItem | null>(null);
  const [filters, setFilters] = useState<OrderFilters>({
    status: 'paid'
  });

  const loadOrders = async (nextFilters: OrderFilters = filters) => {
    setLoading(true);
    try {
      const data = await request<PagedResult<AdminOrderItem>>('/api/admin/member/orders', {
        params: {
          keyword: nextFilters.keyword?.trim() || undefined,
          userKeyword: nextFilters.userKeyword?.trim() || undefined,
          status: nextFilters.status || undefined,
          orderType: nextFilters.orderType || undefined,
          payChannel: nextFilters.payChannel || undefined
        }
      });
      setOrders(data.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders().catch((error) => messageApi.error(error?.message || '订单列表加载失败'));
  }, []);

  const openDetail = async (order: AdminOrderItem) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const detail = await request<AdminOrderItem>(`/api/admin/member/orders/${order._id}`);
      setSelectedOrder(detail);
    } finally {
      setDetailLoading(false);
    }
  };

  const syncOrderStatus = async (order: AdminOrderItem) => {
    if (order.payChannel !== 'wechat_native') {
      return;
    }
    setSyncingOrderId(order._id);
    try {
      await request(`/api/admin/member/orders/${order._id}/sync`, {
        method: 'POST'
      });
      messageApi.success('订单状态已同步');
      if (selectedOrder?._id === order._id) {
        const detail = await request<AdminOrderItem>(`/api/admin/member/orders/${order._id}`);
        setSelectedOrder(detail);
      }
      await loadOrders(filters);
    } finally {
      setSyncingOrderId(undefined);
    }
  };

  const updateFilters = (patch: Partial<OrderFilters>) => {
    setFilters((current) => ({
      ...current,
      ...patch
    }));
  };

  const submitSearch = async () => {
    await loadOrders(filters);
  };

  const resetSearch = async () => {
    const nextFilters: OrderFilters = {
      status: 'paid'
    };
    setFilters(nextFilters);
    await loadOrders(nextFilters);
  };

  const columns: ColumnsType<AdminOrderItem> = [
    {
      title: '订单号',
      dataIndex: 'orderNo'
    },
    {
      title: '用户',
      render: (_, record) => orderUserNameOf(record)
    },
    {
      title: '订单类型',
      dataIndex: 'orderType',
      render: (value: AdminOrderItem['orderType']) => orderTypeLabelOf(value)
    },
    {
      title: '套餐/标题',
      render: (_, record) => orderPlanNameOf(record)
    },
    {
      title: '金额',
      dataIndex: 'amount',
      render: (amount: number) => `¥${amount}`
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (value: AdminOrderItem['status']) => (
        <Tag color={orderStatusColorOf(value)}>{orderStatusLabelOf(value)}</Tag>
      )
    },
    {
      title: '支付方式',
      dataIndex: 'payChannel',
      render: (value: AdminOrderItem['payChannel']) => payChannelLabelOf(value)
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      render: formatDateTime
    },
    {
      title: '支付时间',
      dataIndex: 'paidAt',
      render: formatDateTime
    },
    {
      title: '操作',
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => openDetail(record)}>
            详情
          </Button>
          {record.payChannel === 'wechat_native' ? (
            <Button
              size="small"
              loading={syncingOrderId === record._id}
              onClick={() => syncOrderStatus(record)}
            >
              同步状态
            </Button>
          ) : null}
        </Space>
      )
    }
  ];

  return (
    <>
      {contextHolder}
      <main className="catalog-main catalog-main--wide">
        <div className="catalog-main__header">
          <Space wrap>
            <Input
              allowClear
              placeholder="搜索订单号/交易号/说明"
              value={filters.keyword}
              onChange={(event) => updateFilters({ keyword: event.target.value })}
              onPressEnter={submitSearch}
              style={{ width: 240 }}
            />
            <Input
              allowClear
              placeholder="搜索用户昵称/OpenID"
              value={filters.userKeyword}
              onChange={(event) => updateFilters({ userKeyword: event.target.value })}
              onPressEnter={submitSearch}
              style={{ width: 220 }}
            />
            <Select
              placeholder="订单状态"
              value={filters.status}
              onChange={(value) => updateFilters({ status: value })}
              style={{ width: 140 }}
              options={[
                { label: '全部状态', value: undefined },
                { label: '已支付', value: 'paid' },
                { label: '待支付', value: 'pending' },
                { label: '已关闭', value: 'closed' },
                { label: '已退款', value: 'refunded' }
              ]}
            />
            <Select
              placeholder="订单类型"
              value={filters.orderType}
              onChange={(value) => updateFilters({ orderType: value })}
              style={{ width: 140 }}
              options={[
                { label: '全部类型', value: undefined },
                { label: '会员订单', value: 'member' },
                { label: '兑换订单', value: 'redeem' },
                { label: '应用订单', value: 'app' },
                { label: '充值订单', value: 'recharge' },
                { label: '服务订单', value: 'service' }
              ]}
            />
            <Select
              placeholder="支付方式"
              value={filters.payChannel}
              onChange={(value) => updateFilters({ payChannel: value })}
              style={{ width: 140 }}
              options={[
                { label: '全部方式', value: undefined },
                { label: '微信支付', value: 'wechat_native' },
                { label: '兑换码', value: 'redeem_code' }
              ]}
            />
            <Button type="primary" onClick={submitSearch}>
              查询
            </Button>
            <Button onClick={resetSearch}>重置</Button>
            <Button onClick={() => loadOrders(filters)}>刷新订单</Button>
          </Space>
        </div>
        <Table
          rowKey="_id"
          columns={columns}
          dataSource={orders}
          loading={loading}
          pagination={false}
          scroll={{ x: 1100 }}
        />
      </main>

      <Modal
        title="订单详情"
        open={detailOpen}
        onCancel={() => {
          setDetailOpen(false);
          setSelectedOrder(null);
        }}
        footer={
          selectedOrder?.payChannel === 'wechat_native'
            ? [
                <Button key="close" onClick={() => setDetailOpen(false)}>
                  关闭
                </Button>,
                <Button
                  key="sync"
                  type="primary"
                  loading={syncingOrderId === selectedOrder._id}
                  onClick={() => syncOrderStatus(selectedOrder)}
                >
                  同步状态
                </Button>
              ]
            : [
                <Button key="close" type="primary" onClick={() => setDetailOpen(false)}>
                  关闭
                </Button>
              ]
        }
        width={820}
        destroyOnClose
      >
        {detailLoading || !selectedOrder ? (
          <Typography.Text type="secondary">加载中...</Typography.Text>
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label="订单号">{selectedOrder.orderNo}</Descriptions.Item>
              <Descriptions.Item label="订单类型">
                {orderTypeLabelOf(selectedOrder.orderType)}
              </Descriptions.Item>
              <Descriptions.Item label="用户">{orderUserNameOf(selectedOrder)}</Descriptions.Item>
              <Descriptions.Item label="用户角色">
                {typeof selectedOrder.userId === 'string' ? '--' : selectedOrder.userId?.role || '--'}
              </Descriptions.Item>
              <Descriptions.Item label="标题">{selectedOrder.title || '--'}</Descriptions.Item>
              <Descriptions.Item label="套餐">
                {orderPlanNameOf(selectedOrder)}
              </Descriptions.Item>
              <Descriptions.Item label="金额">¥{selectedOrder.amount}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={orderStatusColorOf(selectedOrder.status)}>
                  {orderStatusLabelOf(selectedOrder.status)}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="支付方式">
                {payChannelLabelOf(selectedOrder.payChannel)}
              </Descriptions.Item>
              <Descriptions.Item label="微信交易号">
                {selectedOrder.wechatTransactionId || '--'}
              </Descriptions.Item>
              <Descriptions.Item label="业务ID">{selectedOrder.bizId || '--'}</Descriptions.Item>
              <Descriptions.Item label="过期时间">
                {formatDateTime(selectedOrder.expiredAt)}
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {formatDateTime(selectedOrder.createdAt)}
              </Descriptions.Item>
              <Descriptions.Item label="支付时间">
                {formatDateTime(selectedOrder.paidAt)}
              </Descriptions.Item>
              <Descriptions.Item label="说明" span={2}>
                {selectedOrder.description || '--'}
              </Descriptions.Item>
              <Descriptions.Item label="快照" span={2}>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    maxHeight: 280,
                    overflow: 'auto'
                  }}
                >
                  {selectedOrder.snapshot
                    ? JSON.stringify(selectedOrder.snapshot, null, 2)
                    : '--'}
                </pre>
              </Descriptions.Item>
            </Descriptions>
          </Space>
        )}
      </Modal>
    </>
  );
};

export default OrdersPage;
