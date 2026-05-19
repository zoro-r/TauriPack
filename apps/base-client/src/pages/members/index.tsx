import React, { useEffect, useState } from 'react';
import { Avatar, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import request from '../../utils/request';
import { formatDateTime, nameInitial } from '../../utils/auth';

interface AdminMemberSummary {
  isMember?: boolean;
  memberLevel?: string;
  startedAt?: string;
  expiredAt?: string;
  status?: 'active' | 'expired';
}

interface AdminUserItem {
  id: string;
  nickname?: string;
  avatar?: string;
  wechatOpenId: string;
  role: 'user' | 'admin';
  member?: AdminMemberSummary | null;
  createdAt: string;
  updatedAt: string;
}

interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

interface MemberAdjustFormValues {
  isMember: boolean;
  memberLevel?: string;
  expiredAt?: string;
}

interface MemberPlanItem {
  _id: string;
  name: string;
  code: string;
  price: number;
  originalPrice?: number;
  durationDays: number;
  description?: string;
  isActive: boolean;
  isVisibleToUser: boolean;
  sort: number;
}

interface MemberPlanFormValues {
  name: string;
  code: string;
  price: number;
  originalPrice?: number;
  durationDays: number;
  description?: string;
  isActive: boolean;
  isVisibleToUser: boolean;
  sort?: number;
}

interface MemberFilters {
  keyword?: string;
  role?: AdminUserItem['role'];
  memberStatus?: AdminMemberSummary['status'];
}

const formatMemberStatus = (member?: AdminMemberSummary | null) => {
  if (member?.isMember && member.status === 'active') {
    return `会员至 ${formatDateTime(member.expiredAt)}`;
  }
  return '非会员';
};

const MembersPage: React.FC = () => {
  const [messageApi, contextHolder] = message.useMessage();
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [plans, setPlans] = useState<MemberPlanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUserItem | null>(null);
  const [editingPlan, setEditingPlan] = useState<MemberPlanItem | null>(null);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [planManageOpen, setPlanManageOpen] = useState(false);
  const [form] = Form.useForm<MemberAdjustFormValues>();
  const [planForm] = Form.useForm<MemberPlanFormValues>();
  const [filters, setFilters] = useState<MemberFilters>({});

  const loadUsers = async (nextFilters: MemberFilters = filters) => {
    setLoading(true);
    try {
      const data = await request<PagedResult<AdminUserItem>>('/api/admin/users', {
        params: {
          keyword: nextFilters.keyword?.trim() || undefined,
          role: nextFilters.role || undefined,
          memberStatus: nextFilters.memberStatus || undefined
        }
      });
      setUsers(data.items);
    } finally {
      setLoading(false);
    }
  };

  const loadPlans = async () => {
    setPlanLoading(true);
    try {
      const data = await request<MemberPlanItem[]>('/api/admin/member/plans');
      setPlans(data);
    } finally {
      setPlanLoading(false);
    }
  };

  useEffect(() => {
    loadUsers().catch((error) => messageApi.error(error?.message || '会员列表加载失败'));
    loadPlans().catch((error) => messageApi.error(error?.message || '套餐列表加载失败'));
  }, []);

  const updateFilters = (patch: Partial<MemberFilters>) => {
    setFilters((current) => ({
      ...current,
      ...patch
    }));
  };

  const submitSearch = async () => {
    await loadUsers(filters);
  };

  const resetSearch = async () => {
    const nextFilters: MemberFilters = {};
    setFilters(nextFilters);
    await loadUsers(nextFilters);
  };

  const updateUserRole = async (user: AdminUserItem, role: 'user' | 'admin') => {
    await request(`/api/admin/users/${user.id}/role`, {
      method: 'PUT',
      data: { role }
    });
    messageApi.success('角色已更新');
    await loadUsers();
  };

  const openMemberAdjust = (user: AdminUserItem) => {
    setSelectedUser(user);
    form.setFieldsValue({
      isMember: Boolean(user.member?.isMember && user.member?.status === 'active'),
      memberLevel: user.member?.memberLevel || 'vip',
      expiredAt: user.member?.expiredAt ? new Date(user.member.expiredAt).toISOString().slice(0, 10) : ''
    });
  };

  const submitMemberAdjust = async () => {
    if (!selectedUser) {
      return;
    }
    const values = await form.validateFields();
    await request(`/api/admin/users/${selectedUser.id}/member`, {
      method: 'PUT',
      data: values
    });
    messageApi.success('会员状态已更新');
    setSelectedUser(null);
    await loadUsers();
  };

  const openPlanCreate = () => {
    setEditingPlan(null);
    planForm.setFieldsValue({
      name: '',
      code: '',
      price: 299,
      originalPrice: undefined,
      durationDays: 365,
      description: '',
      isActive: true,
      isVisibleToUser: true,
      sort: 0
    });
    setPlanModalOpen(true);
  };

  const openPlanEdit = (plan: MemberPlanItem) => {
    setEditingPlan(plan);
    planForm.setFieldsValue({
      name: plan.name,
      code: plan.code,
      price: plan.price,
      originalPrice: plan.originalPrice,
      durationDays: plan.durationDays,
      description: plan.description,
      isActive: plan.isActive,
      isVisibleToUser: plan.isVisibleToUser !== false,
      sort: plan.sort
    });
    setPlanModalOpen(true);
  };

  const submitPlan = async () => {
    const values = await planForm.validateFields();
    if (editingPlan) {
      await request(`/api/admin/member/plans/${editingPlan._id}`, {
        method: 'PUT',
        data: values
      });
      messageApi.success('套餐已更新');
    } else {
      await request('/api/admin/member/plans', {
        method: 'POST',
        data: values
      });
      messageApi.success('套餐已创建');
    }
    setPlanModalOpen(false);
    await loadPlans();
  };

  const columns: ColumnsType<AdminUserItem> = [
    {
      title: '用户',
      dataIndex: 'nickname',
      render: (_, record) => (
        <Space>
          <Avatar src={record.avatar}>{nameInitial(record.nickname)}</Avatar>
          <span>{record.nickname || '微信用户'}</span>
        </Space>
      )
    },
    {
      title: 'OpenID',
      dataIndex: 'wechatOpenId',
      ellipsis: true
    },
    {
      title: '角色',
      dataIndex: 'role',
      render: (role: AdminUserItem['role']) => (role === 'admin' ? '管理员' : '普通用户')
    },
    {
      title: '会员',
      dataIndex: 'member',
      render: (member: AdminMemberSummary | null) => formatMemberStatus(member)
    },
    {
      title: '注册时间',
      dataIndex: 'createdAt',
      render: formatDateTime
    },
    {
      title: '操作',
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => openMemberAdjust(record)}>
            调整会员
          </Button>
          {record.role === 'admin' ? (
            <Popconfirm title="确认取消该管理员？" onConfirm={() => updateUserRole(record, 'user')}>
              <Button size="small">取消管理员</Button>
            </Popconfirm>
          ) : (
            <Button size="small" onClick={() => updateUserRole(record, 'admin')}>
              设为管理员
            </Button>
          )}
        </Space>
      )
    }
  ];

  const planColumns: ColumnsType<MemberPlanItem> = [
    {
      title: '套餐名称',
      dataIndex: 'name'
    },
    {
      title: '编码',
      dataIndex: 'code'
    },
    {
      title: '价格',
      dataIndex: 'price',
      render: (value: number) => `¥${value}`
    },
    {
      title: '原价',
      dataIndex: 'originalPrice',
      render: (value?: number) => (value ? `¥${value}` : '--')
    },
    {
      title: '时长',
      dataIndex: 'durationDays',
      render: (value: number) => `${value} 天`
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      render: (value: boolean) => (value ? '启用' : '停用')
    },
    {
      title: '用户展示',
      dataIndex: 'isVisibleToUser',
      render: (value: boolean) => (value ? '展示' : '隐藏')
    },
    {
      title: '排序',
      dataIndex: 'sort'
    },
    {
      title: '操作',
      render: (_, record) => (
        <Button size="small" onClick={() => openPlanEdit(record)}>
          编辑套餐
        </Button>
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
              placeholder="搜索昵称/OpenID"
              value={filters.keyword}
              onChange={(event) => updateFilters({ keyword: event.target.value })}
              onPressEnter={submitSearch}
              style={{ width: 220 }}
            />
            <Select
              placeholder="用户角色"
              value={filters.role}
              onChange={(value) => updateFilters({ role: value })}
              style={{ width: 140 }}
              options={[
                { label: '全部角色', value: undefined },
                { label: '普通用户', value: 'user' },
                { label: '管理员', value: 'admin' }
              ]}
            />
            <Select
              placeholder="会员状态"
              value={filters.memberStatus}
              onChange={(value) => updateFilters({ memberStatus: value })}
              style={{ width: 140 }}
              options={[
                { label: '全部状态', value: undefined },
                { label: '活跃会员', value: 'active' },
                { label: '已过期', value: 'expired' }
              ]}
            />
            <Button type="primary" onClick={submitSearch}>
              查询
            </Button>
            <Button onClick={resetSearch}>重置</Button>
            <Button onClick={() => loadUsers(filters)}>刷新会员</Button>
            <Button
              onClick={async () => {
                await loadPlans();
                setPlanManageOpen(true);
              }}
            >
              套餐管理
            </Button>
          </Space>
        </div>

        <Table
          rowKey="id"
          columns={columns}
          dataSource={users}
          loading={loading}
          pagination={false}
          scroll={{ x: 920 }}
        />
      </main>

      <Modal
        title={`调整会员：${selectedUser?.nickname || selectedUser?.wechatOpenId || ''}`}
        open={!!selectedUser}
        onCancel={() => setSelectedUser(null)}
        onOk={submitMemberAdjust}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="会员状态" name="isMember" valuePropName="checked">
            <Switch checkedChildren="会员" unCheckedChildren="非会员" />
          </Form.Item>
          <Form.Item label="会员等级" name="memberLevel">
            <Input placeholder="vip" />
          </Form.Item>
          <Form.Item label="到期日期" name="expiredAt">
            <Input placeholder="YYYY-MM-DD，例如 2026-12-31" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="套餐管理"
        open={planManageOpen}
        onCancel={() => setPlanManageOpen(false)}
        footer={[
          <Button key="refresh" onClick={loadPlans}>
            刷新套餐
          </Button>,
          <Button key="create" type="primary" onClick={openPlanCreate}>
            新增套餐
          </Button>
        ]}
        width={960}
      >
        <Table
          rowKey="_id"
          columns={planColumns}
          dataSource={plans}
          loading={planLoading}
          pagination={false}
          scroll={{ x: 960 }}
        />
      </Modal>

      <Modal
        title={editingPlan ? '编辑套餐' : '新增套餐'}
        open={planModalOpen}
        onCancel={() => setPlanModalOpen(false)}
        onOk={submitPlan}
        destroyOnClose
      >
        <Form form={planForm} layout="vertical">
          <Form.Item label="套餐名称" name="name" rules={[{ required: true, message: '请输入套餐名称' }]}>
            <Input placeholder="年度会员" />
          </Form.Item>
          <Form.Item label="编码" name="code" rules={[{ required: true, message: '请输入套餐编码' }]}>
            <Input placeholder="yearly" />
          </Form.Item>
          <Form.Item label="价格" name="price" rules={[{ required: true, message: '请输入价格' }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="原价" name="originalPrice">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="时长(天)" name="durationDays" rules={[{ required: true, message: '请输入时长' }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} placeholder="套餐说明" />
          </Form.Item>
          <Form.Item label="排序" name="sort">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="启用" name="isActive" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="对用户展示" name="isVisibleToUser" valuePropName="checked">
            <Switch checkedChildren="展示" unCheckedChildren="隐藏" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default MembersPage;
