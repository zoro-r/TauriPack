import React, { useEffect, useState } from 'react';
import { CopyOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Empty, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Spin, Switch, Table, Tabs, Tag, Tooltip, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import request, { apiBase } from '../../utils/request';
import { formatDateTime, getCurrentUserFromStorage } from '../../utils/auth';
import './index.less';

interface NewApiAccountOverview {
  provisioned: boolean;
  suggestedUsername: string;
  consoleUrl: string;
  account?: {
    newApiUserId: string;
    username: string;
    displayName?: string;
    status: 'provisioned' | 'sync_error';
    lastSyncedAt?: string;
    lastError?: string;
  };
  remoteUser?: {
    id: string;
    username: string;
    displayName?: string;
    statusText?: string;
  };
}

interface NewApiTokenItem {
  id: string;
  name: string;
  maskedKey: string;
  statusText: string;
  createdAt?: string;
  expiredAt?: string;
  usedQuota: number;
}

interface CreatedNewApiTokenResult {
  token: NewApiTokenItem;
  secret?: string;
}

interface ApiWallet {
  provisioned: boolean;
  quota?: number;
  usedQuota?: number;
  availableQuota?: number;
  rechargeOptions: Array<{ amount: number; quota: number }>;
  customRechargeMinAmount: number;
  customRechargeMaxAmount: number;
}
interface UsageItem { id: string; tokenId: string; model: string; tokenName: string; quota: number; createdAt?: string; }

interface RechargeOrder {
  id: string;
  amount: number;
  quota: number;
  status: 'pending' | 'paid' | 'closed' | 'refunded';
  codeUrl: string;
}

interface RechargeOrderItem {
  _id: string;
  orderType?: string;
  amount: number;
  status: 'pending' | 'paid' | 'closed' | 'refunded';
  snapshot?: { quota?: number };
  paidAt?: string;
  createdAt: string;
}

const qrImageOf = (value: string) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(value)}`;

const ApiKeysPage: React.FC = () => {
  const [messageApi, contextHolder] = message.useMessage();
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [keyLoading, setKeyLoading] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createdSecret, setCreatedSecret] = useState('');
  const [secretModalOpen, setSecretModalOpen] = useState(false);
  const [overview, setOverview] = useState<NewApiAccountOverview | null>(null);
  const [keys, setKeys] = useState<NewApiTokenItem[]>([]);
  const [wallet, setWallet] = useState<ApiWallet | null>(null);
  const [rechargeOrder, setRechargeOrder] = useState<RechargeOrder | null>(null);
  const [rechargeLoading, setRechargeLoading] = useState(false);
  const [keySearch, setKeySearch] = useState('');
  const [usageGuideOpen, setUsageGuideOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [rechargeOrdersOpen, setRechargeOrdersOpen] = useState(false);
  const [rechargeOrdersLoading, setRechargeOrdersLoading] = useState(false);
  const [rechargeOrders, setRechargeOrders] = useState<RechargeOrderItem[]>([]);
  const [usageItems, setUsageItems] = useState<UsageItem[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [keyUsageOpen, setKeyUsageOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<NewApiTokenItem | null>(null);
  const [customAmount, setCustomAmount] = useState<number | null>(null);
  const currentUser = getCurrentUserFromStorage();
  const [form] = Form.useForm<{ name: string; expiresInSeconds: number; unlimitedQuota: boolean; remainQuota?: number; allowIps?: string; modelLimitsEnabled: boolean; modelLimits?: string; crossGroupRetry: boolean }>();
  const keyLimitReached = keys.length >= 5;

  const loadOverview = async () => {
    setOverviewLoading(true);
    try {
      const data = await request<NewApiAccountOverview>('/api/newapi/account');
      setOverview(data);
      if (data.provisioned) {
        setKeyLoading(true);
        try {
          const keyData = await request<NewApiTokenItem[]>('/api/newapi/keys');
          setKeys(keyData);
          await loadWallet();
        } finally {
          setKeyLoading(false);
        }
      } else {
        setKeys([]);
        setWallet(null);
      }
    } finally {
      setOverviewLoading(false);
    }
  };

  const loadKeys = async () => {
    setKeyLoading(true);
    try {
      const data = await request<NewApiTokenItem[]>('/api/newapi/keys');
      setKeys(data);
    } finally {
      setKeyLoading(false);
    }
  };

  const loadWallet = async () => {
    const data = await request<ApiWallet>('/api/newapi/wallet');
    setWallet(data);
  };

  useEffect(() => {
    if (!currentUser?.id) {
      setOverviewLoading(false);
      return;
    }
    loadOverview().catch(() => undefined);
  }, [currentUser?.id]);

  useEffect(() => {
    if (!rechargeOrder?.id) {
      return undefined;
    }
    const timer = window.setInterval(async () => {
      try {
        const order = await request<RechargeOrder>(`/api/member/orders/${rechargeOrder.id}`, { alert: false });
        if (order.status === 'paid') {
          window.clearInterval(timer);
          setRechargeOrder(null);
          await loadWallet();
          messageApi.success('充值成功，余额已到账');
        } else if (order.status === 'closed' || order.status === 'refunded') {
          window.clearInterval(timer);
          messageApi.error('订单已关闭，请重新发起充值');
        }
      } catch {
        // A transient request failure should not invalidate a pending payment.
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [rechargeOrder?.id]);

  const handleProvision = async () => {
    setProvisioning(true);
    try {
      const data = await request<NewApiAccountOverview>('/api/newapi/account/provision', {
        method: 'POST'
      });
      setOverview(data);
      await loadKeys();
      await loadWallet();
      messageApi.success('API 账户已开通');
    } finally {
      setProvisioning(false);
    }
  };

  const handleCreateKey = async () => {
    const values = await form.validateFields();
    setCreatingKey(true);
    try {
      const data = await request<CreatedNewApiTokenResult>('/api/newapi/keys', {
        method: 'POST',
        data: values
      });
      setCreateModalOpen(false);
      form.resetFields();
      setCreatedSecret(data.secret || '');
      setSecretModalOpen(true);
      await loadKeys();
      messageApi.success('API Key 已创建');
    } finally {
      setCreatingKey(false);
    }
  };

  const handleDeleteKey = async (id: string) => {
    await request(`/api/newapi/keys/${id}`, { method: 'DELETE' });
    messageApi.success('API Key 已删除');
    await loadKeys();
  };

  const copyCreatedSecret = async () => {
    if (!createdSecret) {
      return;
    }
    await navigator.clipboard.writeText(createdSecret);
    messageApi.success('密钥已复制');
  };

  const copyKey = async (id: string) => {
    const data = await request<{ secret: string }>(`/api/newapi/keys/${id}/secret`, { method: 'POST' });
    await navigator.clipboard.writeText(data.secret);
    messageApi.success('完整密钥已复制');
  };

  const copyModelName = async (model: string) => {
    await navigator.clipboard.writeText(model);
    messageApi.success('模型名称已复制');
  };

  const openKeyUsage = async (key: NewApiTokenItem) => {
    setSelectedKey(key);
    setKeyUsageOpen(true);
    setUsageLoading(true);
    try { setUsageItems(await request<UsageItem[]>('/api/newapi/usage')); } finally { setUsageLoading(false); }
  };

  const createRechargeOrder = async (amount: number) => {
    setRechargeLoading(true);
    try {
      const order = await request<RechargeOrder>('/api/newapi/recharge-orders', {
        method: 'POST',
        data: { amount }
      });
      setRechargeOrder(order);
    } finally {
      setRechargeLoading(false);
    }
  };

  const openRechargeOrders = async () => {
    setRechargeOrdersOpen(true);
    setRechargeOrdersLoading(true);
    try {
      const orders = await request<RechargeOrderItem[]>('/api/member/orders');
      setRechargeOrders(orders.filter((item) => item.orderType === 'recharge'));
      setUsageLoading(true);
      try { setUsageItems(await request<UsageItem[]>('/api/newapi/usage')); } finally { setUsageLoading(false); }
    } finally {
      setRechargeOrdersLoading(false);
    }
  };

  const openUsageGuide = async () => {
    setUsageGuideOpen(true);
    setModelsLoading(true);
    try { setAvailableModels(await request<string[]>('/api/newapi/models')); } finally { setModelsLoading(false); }
  };

  const columns: ColumnsType<NewApiTokenItem> = [
    {
      title: '名称 / 状态',
      dataIndex: 'name',
      width: 260,
      render: (value: string, record) => (
        <Space size={8} wrap>
          <Typography.Text strong>{value}</Typography.Text>
          <Tag className="api-key-status" color={record.statusText === '可用' ? 'green' : 'default'}>{record.statusText}</Tag>
        </Space>
      )
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      render: (value?: string) => formatDateTime(value)
    },
    {
      title: '过期时间',
      dataIndex: 'expiredAt',
      render: (value?: string) => value ? formatDateTime(value) : '永不过期'
    },
    {
      title: '密钥标识',
      dataIndex: 'maskedKey',
      render: (value: string, record) => <Space size={4}><Typography.Text code className="api-key-mask">{value}</Typography.Text><Tooltip title="复制完整密钥"><Button type="text" size="small" icon={<CopyOutlined />} onClick={() => copyKey(record.id).catch(() => messageApi.error('复制失败'))} /></Tooltip></Space>
    },
    { title: '消耗额度', dataIndex: 'usedQuota', render: (value: number) => value || 0 },
    {
      title: '操作',
      key: 'actions',
      width: 118,
      render: (_, record) => (
        <Space size={8}>
          <Button className="api-key-action-button" onClick={() => openKeyUsage(record).catch(() => messageApi.error('获取消费明细失败'))}>明细</Button>
          <Popconfirm title="确认删除该密钥？" onConfirm={() => handleDeleteKey(record.id)}>
            <Button danger className="api-key-action-button">删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const filteredKeys = keys.filter((item) =>
    item.name.toLocaleLowerCase().includes(keySearch.trim().toLocaleLowerCase())
  );
  const chatCompletionsUrl = `${apiBase}/api/newapi/v1/chat/completions`;

  if (!currentUser?.id) {
    return (
      <>
        {contextHolder}
        <main style={{ padding: 24 }}>
          <Alert type="warning" showIcon message="请先登录后再管理 API Key" />
        </main>
      </>
    );
  }

  return (
    <>
      {contextHolder}
      <main style={{ padding: 24 }}>
        <Spin spinning={overviewLoading}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card
              title="钱包"
              extra={
                overview?.provisioned ? (
                  <Space>
                    <Button onClick={() => loadOverview().catch(() => undefined)}>同步</Button>
                  </Space>
                ) : null
              }
            >
              {!overview?.provisioned ? (
                <Space direction="vertical" size={12}>
                  <Typography.Text type="secondary">
                    当前账号尚未开通 API 账户。开通后即可创建和管理 API 密钥。
                  </Typography.Text>
                  <Button type="primary" loading={provisioning} onClick={() => handleProvision()}>
                    开通 API 账户
                  </Button>
                </Space>
              ) : (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {overview.account?.status === 'sync_error' && overview.account.lastError ? (
                    <Alert type="warning" showIcon message={overview.account.lastError} />
                  ) : null}
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <Space size={32} wrap>
                      <Typography.Text>可用额度：<Typography.Text strong>{wallet?.availableQuota ?? '--'}</Typography.Text></Typography.Text>
                      <Typography.Text type="secondary">累计额度：{wallet?.quota ?? '--'}</Typography.Text>
                      <Typography.Text type="secondary">已用额度：{wallet?.usedQuota ?? '--'}</Typography.Text>
                      <Button onClick={() => loadWallet().catch(() => undefined)}>刷新余额</Button>
                      <Button onClick={() => openRechargeOrders().catch(() => undefined)}>明细</Button>
                    </Space>
                    {wallet?.rechargeOptions?.length ? (
                    <Space wrap>
                        {wallet.rechargeOptions.map((item) => (
                          <Button key={item.amount} loading={rechargeLoading} onClick={() => createRechargeOrder(item.amount).catch(() => undefined)}>
                            充值 ¥{item.amount}，到账 {item.quota} 额度
                          </Button>
                        ))}
                    </Space>
                  ) : (
                      <Alert type="info" showIcon message="充值服务暂未开放" />
                  )}
                  <Space.Compact>
                    <InputNumber min={wallet?.customRechargeMinAmount || 1} max={wallet?.customRechargeMaxAmount || 10000} value={customAmount} onChange={setCustomAmount} placeholder="自定义充值金额" prefix="¥" style={{ width: 220 }} />
                    <Button disabled={!customAmount} loading={rechargeLoading} onClick={() => customAmount && createRechargeOrder(customAmount).catch(() => undefined)}>自定义充值</Button>
                  </Space.Compact>
                  </Space>
                </Space>
              )}
            </Card>

            <Card className="api-key-list-card" bodyStyle={{ padding: 0 }}>
              {overview?.provisioned ? (
                <>
                  <div className="api-key-list-toolbar">
                    <div className="api-key-list-toolbar__title">API 密钥列表</div>
                    <Input
                      allowClear
                      className="api-key-list-toolbar__search"
                      placeholder="搜索名称..."
                      value={keySearch}
                      onChange={(event) => setKeySearch(event.target.value)}
                    />
                    <Button type="primary" disabled={keyLimitReached} onClick={() => setCreateModalOpen(true)}>+ 创建密钥</Button>
                    <Button onClick={() => openUsageGuide().catch(() => undefined)}>使用文档</Button>
                    <Typography.Text type="secondary" className="api-key-list-toolbar__count">已创建 {keys.length}/5 个 API 密钥</Typography.Text>
                  </div>
                  <Table
                    className="api-key-table"
                    rowKey="id"
                    columns={columns}
                    dataSource={filteredKeys}
                    loading={keyLoading}
                    locale={{ emptyText: <Empty description="当前还没有 API 密钥" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                    pagination={false}
                    scroll={{ x: 820 }}
                  />
                </>
              ) : (
                <Empty description="请先开通 API 账户" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          </Space>
        </Spin>
      </main>

      <Modal
        title="创建 API Key"
        open={createModalOpen}
        confirmLoading={creatingKey}
        onOk={() => handleCreateKey().catch(() => undefined)}
        onCancel={() => setCreateModalOpen(false)}
        destroyOnClose
        width={760}
      >
        <Form form={form} layout="vertical" preserve={false} initialValues={{ expiresInSeconds: 0, unlimitedQuota: true, modelLimitsEnabled: false, crossGroupRetry: false }}>
          <Typography.Title level={5} style={{ marginTop: 0 }}>基本信息</Typography.Title>
          <Typography.Paragraph type="secondary">设置密钥名称、有效期和使用额度。</Typography.Paragraph>
          <Row gutter={16}>
            <Col xs={24} sm={12}><Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入密钥名称' }]}><Input placeholder="例如：默认开发密钥" maxLength={64} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="分组"><Input value="当前账户分组" disabled /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="过期时间" name="expiresInSeconds"><Select options={[{ value: 0, label: '永不过期' }, { value: 3600, label: '1 小时' }, { value: 86400, label: '1 天' }, { value: 2592000, label: '1 个月' }]} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="无限额度" name="unlimitedQuota" valuePropName="checked"><Switch checkedChildren="开启" unCheckedChildren="关闭" /></Form.Item></Col>
          </Row>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.unlimitedQuota !== next.unlimitedQuota}>
            {({ getFieldValue }) => !getFieldValue('unlimitedQuota') ? (
              <Row gutter={16}><Col xs={24} sm={12}><Form.Item label="密钥额度" name="remainQuota" rules={[{ required: true, message: '请输入密钥额度' }]}><InputNumber min={1} precision={0} style={{ width: '100%' }} placeholder="请输入额度" /></Form.Item></Col></Row>
            ) : null}
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="微信扫码充值"
        open={Boolean(rechargeOrder)}
        footer={<Button onClick={() => setRechargeOrder(null)}>关闭</Button>}
        onCancel={() => setRechargeOrder(null)}
      >
        {rechargeOrder ? (
          <Space direction="vertical" align="center" style={{ width: '100%' }} size={12}>
            <img src={qrImageOf(rechargeOrder.codeUrl)} alt="微信支付二维码" width={240} height={240} />
            <Typography.Text>支付 ¥{rechargeOrder.amount}，到账 {rechargeOrder.quota} 额度</Typography.Text>
            <Typography.Text type="secondary">请使用微信扫码完成支付</Typography.Text>
          </Space>
        ) : null}
      </Modal>

      <Modal
        title="明细"
        open={rechargeOrdersOpen}
        footer={<Button onClick={() => setRechargeOrdersOpen(false)}>关闭</Button>}
        onCancel={() => setRechargeOrdersOpen(false)}
        width={720}
      >
        <Tabs items={[{ key: 'recharge', label: '充值明细', children: <Table<RechargeOrderItem> rowKey="_id" loading={rechargeOrdersLoading} pagination={false} dataSource={rechargeOrders} columns={[
            { title: '支付金额', dataIndex: 'amount', render: (value: number) => `¥${value}` },
            { title: '到账额度', dataIndex: 'snapshot', render: (value?: RechargeOrderItem['snapshot']) => value?.quota ?? '--' },
            { title: '状态', dataIndex: 'status', render: (value: RechargeOrderItem['status']) => <Tag color={value === 'paid' ? 'green' : value === 'pending' ? 'orange' : 'default'}>{value === 'paid' ? '已支付' : value === 'pending' ? '待支付' : value === 'closed' ? '已关闭' : '已退款'}</Tag> },
            { title: '时间', dataIndex: 'paidAt', render: (value: string | undefined, record) => formatDateTime(value || record.createdAt) }
          ]} locale={{ emptyText: <Empty description="暂无充值记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} /> }, { key: 'usage', label: '消费明细', children: <Table<UsageItem> rowKey="id" loading={usageLoading} pagination={false} dataSource={usageItems} columns={[{ title: '模型', dataIndex: 'model' }, { title: '密钥', dataIndex: 'tokenName' }, { title: '消耗额度', dataIndex: 'quota' }, { title: '时间', dataIndex: 'createdAt', render: (value?: string) => formatDateTime(value) }]} locale={{ emptyText: <Empty description="暂无消费记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} /> }]} />
      </Modal>

      <Modal title={`${selectedKey?.name || ''} 消费明细`} open={keyUsageOpen} footer={<Button onClick={() => setKeyUsageOpen(false)}>关闭</Button>} onCancel={() => setKeyUsageOpen(false)} width={720}>
        <Table<UsageItem> rowKey="id" loading={usageLoading} pagination={false} dataSource={usageItems.filter((item) => item.tokenId === selectedKey?.id)} columns={[{ title: '模型', dataIndex: 'model' }, { title: '消耗额度', dataIndex: 'quota' }, { title: '时间', dataIndex: 'createdAt', render: (value?: string) => formatDateTime(value) }]} locale={{ emptyText: <Empty description="暂无消费记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
      </Modal>

      <Modal
        title="API 使用文档"
        open={usageGuideOpen}
        footer={<Button onClick={() => setUsageGuideOpen(false)}>关闭</Button>}
        onCancel={() => setUsageGuideOpen(false)}
        width={760}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Typography.Paragraph style={{ margin: 0 }}>
            创建 API 密钥后，在请求头中携带该密钥即可调用兼容 OpenAI 的接口。
          </Typography.Paragraph>
          <div>
            <Typography.Text strong>请求地址</Typography.Text>
            <Typography.Paragraph copyable={{ text: chatCompletionsUrl }} code style={{ margin: '6px 0 0' }}>
              {chatCompletionsUrl || '账户地址加载中'}
            </Typography.Paragraph>
          </div>
          <div>
            <Typography.Text strong>认证请求头</Typography.Text>
            <Typography.Paragraph copyable={{ text: 'Authorization: Bearer YOUR_API_KEY' }} code style={{ margin: '6px 0 0' }}>
              Authorization: Bearer YOUR_API_KEY
            </Typography.Paragraph>
          </div>
          <div>
            <Typography.Text strong>调用示例</Typography.Text>
            <Input.TextArea
              readOnly
              autoSize={{ minRows: 8, maxRows: 12 }}
              value={`curl ${chatCompletionsUrl || 'https://your-api-host/v1/chat/completions'} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "deepseek-v4-flash",
    "messages": [{ "role": "user", "content": "你好" }]
  }'`}
            />
          </div>
          <Typography.Text type="secondary">
            当前可用示例模型：<Typography.Text code>deepseek-v4-flash</Typography.Text>。可用模型会随渠道配置变化。
          </Typography.Text>
          <div>
            <Typography.Text strong>可用模型</Typography.Text>
            <div style={{ marginTop: 8 }}>
              <Spin spinning={modelsLoading} size="small">
                {availableModels.length ? <Space wrap>{availableModels.map((model) => <Space key={model} size={2}><Tag>{model}</Tag><Tooltip title="复制模型名称"><Button type="text" size="small" aria-label={`复制 ${model}`} icon={<CopyOutlined />} onClick={() => copyModelName(model).catch(() => messageApi.error('复制失败'))} /></Tooltip></Space>)}</Space> : <Typography.Text type="secondary">暂无可用模型</Typography.Text>}
              </Spin>
            </div>
          </div>
          <Alert type="warning" showIcon message="请勿在浏览器代码、公开仓库或截图中泄露完整 API 密钥。" />
        </Space>
      </Modal>

      <Modal
        title="API Key 创建成功"
        open={secretModalOpen}
        footer={<Button onClick={() => setSecretModalOpen(false)}>我知道了</Button>}
        onCancel={() => setSecretModalOpen(false)}
      >
        {createdSecret ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              type="success"
              showIcon
              message="密钥已创建。之后可随时在 API 密钥列表中点击“复制”获取完整密钥。"
            />
            <Input.TextArea value={createdSecret} autoSize={{ minRows: 3, maxRows: 6 }} readOnly />
            <Button type="primary" onClick={() => copyCreatedSecret().catch(() => messageApi.error('复制失败，请手动复制'))}>
              复制密钥
            </Button>
          </Space>
        ) : (
          <Alert
            type="info"
            showIcon
            message="密钥已创建，可在 API 密钥列表中点击“复制”获取完整密钥。"
          />
        )}
      </Modal>
    </>
  );
};

export default ApiKeysPage;
