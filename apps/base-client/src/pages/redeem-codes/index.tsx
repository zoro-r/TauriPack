import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {
  Button,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import request, { apiBase } from '../../utils/request';
import { formatDateTime } from '../../utils/auth';
import { serialColumn } from '../../utils/tableColumns';

interface MemberPlanItem {
  _id: string;
  name: string;
  code: string;
  durationDays: number;
}

interface AppItem {
  _id: string;
  name: string;
  slug: string;
  accessLevel: 'login' | 'member' | 'explicit' | 'owner';
}

interface AppsPagedResponse {
  list: AppItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface RedeemBatchItem {
  _id: string;
  name: string;
  codePrefix?: string;
  status: 'draft' | 'active' | 'disabled';
  grantType: 'member' | 'app';
  planId?: MemberPlanItem | string;
  appId?: AppItem | string;
  grantSnapshot: {
    title: string;
    description?: string;
    memberLevel?: string;
    durationDays?: number;
    appDurationDays?: number;
    appName?: string;
  };
  userVisibleTitle: string;
  userVisibleDescription?: string;
  expiresAt?: string;
  totalCount: number;
  usedCount: number;
  remark?: string;
  createdAt: string;
}

interface RedeemCodeItem {
  _id: string;
  code: string;
  status: 'unused' | 'used' | 'expired' | 'disabled';
  usedAt?: string;
  expiresAt?: string;
  batchId?:
    | string
    | {
        _id: string;
        name?: string;
        userVisibleTitle?: string;
        expiresAt?: string;
      };
  usedBy?:
    | string
    | {
        _id: string;
        nickname?: string;
        wechatOpenId?: string;
      };
}

interface BatchFormValues {
  name: string;
  codePrefix?: string;
  status: 'draft' | 'active' | 'disabled';
  grantType: 'member' | 'app';
  planId?: string;
  appId?: string;
  appDurationDays?: number;
  userVisibleTitle: string;
  userVisibleDescription?: string;
  expiresAt?: string;
  remark?: string;
}

interface RedeemCodeFilters {
  keyword?: string;
  status?: RedeemCodeItem['status'];
  batchId?: string;
  grantType?: RedeemBatchItem['grantType'];
}

interface RedeemCodesPagedResponse {
  list: RedeemCodeItem[];
  total: number;
  page: number;
  pageSize: number;
}

const redeemCodesFilterParams = (f: RedeemCodeFilters) => ({
  keyword: f.keyword?.trim() || undefined,
  status: f.status || undefined,
  batchId: f.batchId || undefined,
  grantType: f.grantType || undefined
});

const redeemCodesRequestParams = (f: RedeemCodeFilters, page: number, pageSize: number) => ({
  ...redeemCodesFilterParams(f),
  page,
  pageSize
});

const batchStatusLabelOf = (value: RedeemBatchItem['status']) => {
  if (value === 'active') return '启用';
  if (value === 'disabled') return '停用';
  return '草稿';
};

const batchStatusColorOf = (value: RedeemBatchItem['status']) => {
  if (value === 'active') return 'green';
  if (value === 'disabled') return 'red';
  return 'gold';
};

const codeStatusLabelOf = (value: RedeemCodeItem['status']) => {
  if (value === 'used') return '已使用';
  if (value === 'expired') return '已过期';
  if (value === 'disabled') return '已停用';
  return '未使用';
};

const grantTypeLabelOf = (value: RedeemBatchItem['grantType']) => (value === 'app' ? '单应用' : '会员');

const RedeemCodesPage: React.FC = () => {
  const [messageApi, contextHolder] = message.useMessage();
  const [batches, setBatches] = useState<RedeemBatchItem[]>([]);
  const [codes, setCodes] = useState<RedeemCodeItem[]>([]);
  const [plans, setPlans] = useState<MemberPlanItem[]>([]);
  const [apps, setApps] = useState<AppItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [codesTotal, setCodesTotal] = useState(0);
  const [codePagination, setCodePagination] = useState<{ current: number; pageSize: number }>({
    current: 1,
    pageSize: 20
  });
  const [excelExporting, setExcelExporting] = useState(false);
  const [batchManageOpen, setBatchManageOpen] = useState(false);
  const [batchFormOpen, setBatchFormOpen] = useState(false);
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editingBatch, setEditingBatch] = useState<RedeemBatchItem | null>(null);
  const [batchForm] = Form.useForm<BatchFormValues>();
  const [generateForm] = Form.useForm<{ batchId: string; count: number }>();
  const [filters, setFilters] = useState<RedeemCodeFilters>({});
  const explicitApps = apps.filter((app) => app.accessLevel === 'explicit');
  const activeBatches = batches.filter((batch) => batch.status === 'active');

  const batchBindTargetLabelOf = (batch: RedeemBatchItem) => {
    if (batch.grantType === 'app') {
      return typeof batch.appId === 'string'
        ? batch.grantSnapshot.appName || '--'
        : batch.appId?.name || batch.grantSnapshot.appName || '--';
    }
    return typeof batch.planId === 'string' ? '--' : batch.planId?.name || '--';
  };

  const loadAll = async (
    nextFilters: RedeemCodeFilters = filters,
    page: number = codePagination.current,
    pageSize: number = codePagination.pageSize
  ) => {
    setLoading(true);
    try {
      const [nextBatches, nextCodesPage, nextPlans, nextApps] = await Promise.all([
        request<RedeemBatchItem[]>('/api/admin/redeem/batches'),
        request<RedeemCodesPagedResponse>('/api/admin/redeem/codes', {
          params: redeemCodesRequestParams(nextFilters, page, pageSize)
        }),
        request<MemberPlanItem[]>('/api/admin/member/plans'),
        request<AppsPagedResponse>('/api/apps', { params: { page: 1, pageSize: 500 }, alert: false })
      ]);
      setBatches(nextBatches);
      setCodes(nextCodesPage.list);
      setCodesTotal(nextCodesPage.total);
      setCodePagination({ current: nextCodesPage.page, pageSize: nextCodesPage.pageSize });
      setPlans(nextPlans.filter((item: any) => item.isActive !== false));
      setApps(nextApps.list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll({}, 1, codePagination.pageSize).catch((error) =>
      messageApi.error(error?.message || '兑换码数据加载失败')
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap once
  }, []);

  const updateFilters = (patch: Partial<RedeemCodeFilters>) => {
    setFilters((current) => {
      const next = {
        ...current,
        ...patch
      };
      if (patch.grantType !== undefined && current.batchId) {
        next.batchId = undefined;
      }
      return next;
    });
  };

  const submitSearch = async () => {
    await loadAll(filters, 1, codePagination.pageSize);
  };

  const resetSearch = async () => {
    const nextFilters: RedeemCodeFilters = {};
    setFilters(nextFilters);
    await loadAll(nextFilters, 1, codePagination.pageSize);
  };

  const exportCodesExcel = async () => {
    setExcelExporting(true);
    try {
      const res = await axios.get(`${apiBase}/api/admin/redeem/codes/export`, {
        params: redeemCodesFilterParams(filters),
        withCredentials: true,
        responseType: 'blob',
        validateStatus: () => true
      });

      const contentType = String(res.headers['content-type'] || '');
      const disposition = String(res.headers['content-disposition'] || '');
      const looksLikeXlsx =
        contentType.includes('spreadsheetml') ||
        disposition.toLowerCase().includes('.xlsx');

      if (!looksLikeXlsx || !(res.status >= 200 && res.status < 300)) {
        const text = typeof (res.data as Blob).text === 'function' ? await (res.data as Blob).text() : String(res.data);
        try {
          const payload = JSON.parse(text) as { message?: string };
          messageApi.error(payload?.message || '导出失败');
        } catch {
          messageApi.error('导出失败');
        }
        return;
      }

      const blob =
        res.data instanceof Blob
          ? res.data
          : new Blob([res.data as BlobPart], {
              type:
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `redeem-codes-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(href);

      const truncated = String(res.headers['x-export-truncated'] || '') === '1';
      if (truncated) {
        messageApi.warning(
          '当前筛选条件下的兑换码总数超过导出上限（约 25000 条），文件仅包含前若干条，请收窄筛选后再导出完整列表。'
        );
      } else {
        messageApi.success('已开始下载 Excel 文件');
      }
    } catch (error: any) {
      messageApi.error(error?.message || '导出失败');
    } finally {
      setExcelExporting(false);
    }
  };

  const openBatchCreate = () => {
    setEditingBatch(null);
    batchForm.setFieldsValue({
      name: '',
      codePrefix: '',
      status: 'active',
      grantType: 'member',
      planId: plans[0]?._id,
      appId: explicitApps[0]?._id,
      appDurationDays: 30,
      userVisibleTitle: '会员兑换',
      userVisibleDescription: '兑换成功后会员权益将自动到账',
      expiresAt: undefined,
      remark: ''
    });
    setBatchFormOpen(true);
  };

  const handleGrantTypeChange = (value: BatchFormValues['grantType']) => {
    if (value === 'app') {
      batchForm.setFieldsValue({
        appId: explicitApps[0]?._id,
        appDurationDays: 30,
        userVisibleTitle: '应用兑换',
        userVisibleDescription: '兑换成功后应用权限将自动到账'
      });
      return;
    }
    batchForm.setFieldsValue({
      planId: plans[0]?._id,
      userVisibleTitle: '会员兑换',
      userVisibleDescription: '兑换成功后会员权益将自动到账'
    });
  };

  const openBatchEdit = (batch: RedeemBatchItem) => {
    setEditingBatch(batch);
    batchForm.setFieldsValue({
      name: batch.name,
      codePrefix: batch.codePrefix,
      status: batch.status,
      grantType: batch.grantType || 'member',
      planId: typeof batch.planId === 'string' ? batch.planId : batch.planId?._id,
      appId: typeof batch.appId === 'string' ? batch.appId : batch.appId?._id,
      appDurationDays: batch.grantSnapshot.appDurationDays,
      userVisibleTitle: batch.userVisibleTitle,
      userVisibleDescription: batch.userVisibleDescription,
      expiresAt: batch.expiresAt ? dayjs(batch.expiresAt) : undefined,
      remark: batch.remark
    });
    setBatchFormOpen(true);
  };

  const submitBatch = async () => {
    const values = await batchForm.validateFields();
    const payload = {
      ...values,
      expiresAt: values.expiresAt ? dayjs(values.expiresAt).format('YYYY-MM-DD') : undefined
    };
    if (editingBatch) {
      await request(`/api/admin/redeem/batches/${editingBatch._id}`, {
        method: 'PUT',
        data: payload
      });
      messageApi.success('兑换活动已更新');
    } else {
      await request('/api/admin/redeem/batches', {
        method: 'POST',
        data: payload
      });
      messageApi.success('兑换活动已创建');
    }
    setBatchFormOpen(false);
    await loadAll(filters, codePagination.current, codePagination.pageSize);
  };

  const submitGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const values = await generateForm.validateFields();
      await request('/api/admin/redeem/codes/generate', {
        method: 'POST',
        data: values
      });
      messageApi.success('兑换码已生成');
      setGenerateModalOpen(false);
      await loadAll(filters, codePagination.current, codePagination.pageSize);
    } finally {
      setGenerating(false);
    }
  };

  const batchColumns: ColumnsType<RedeemBatchItem> = [
    serialColumn<RedeemBatchItem>(),
    { title: '活动名', dataIndex: 'name' },
    {
      title: '权益类型',
      dataIndex: 'grantType',
      render: (value: RedeemBatchItem['grantType']) => (value === 'app' ? '单应用' : '会员')
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (value: RedeemBatchItem['status']) => (
        <Tag color={batchStatusColorOf(value)}>{batchStatusLabelOf(value)}</Tag>
      )
    },
    {
      title: '绑定对象',
      render: (_, record) =>
        record.grantType === 'app'
          ? typeof record.appId === 'string'
            ? record.grantSnapshot.appName || '--'
            : record.appId?.name || record.grantSnapshot.appName || '--'
          : typeof record.planId === 'string'
            ? '--'
            : record.planId?.name || '--'
    },
    {
      title: '发放内容',
      render: (_, record) =>
        record.grantType === 'app'
          ? `${record.grantSnapshot.appName || record.grantSnapshot.title || '--'} / ${record.grantSnapshot.appDurationDays || 0} 天`
          : `${record.grantSnapshot.durationDays || 0} 天`
    },
    {
      title: '码数量',
      render: (_, record) => `${record.usedCount}/${record.totalCount}`
    },
    {
      title: '过期时间',
      dataIndex: 'expiresAt',
      render: formatDateTime
    },
    {
      title: '操作',
      render: (_, record) => (
        <Button size="small" onClick={() => openBatchEdit(record)}>
          编辑
        </Button>
      )
    }
  ];

  const codeColumns: ColumnsType<RedeemCodeItem> = [
    serialColumn<RedeemCodeItem>(codePagination.current, codePagination.pageSize),
    { title: '兑换码', dataIndex: 'code' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (value: RedeemCodeItem['status']) => codeStatusLabelOf(value)
    },
    {
      title: '所属活动',
      render: (_, record) =>
        typeof record.batchId === 'string' ? '--' : record.batchId?.name || record.batchId?.userVisibleTitle || '--'
    },
    {
      title: '使用人',
      render: (_, record) =>
        typeof record.usedBy === 'string' ? '--' : record.usedBy?.nickname || record.usedBy?.wechatOpenId || '--'
    },
    {
      title: '使用时间',
      dataIndex: 'usedAt',
      render: formatDateTime
    },
    {
      title: '过期时间',
      dataIndex: 'expiresAt',
      render: formatDateTime
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
              placeholder="搜索兑换码"
              value={filters.keyword}
              onChange={(event) => updateFilters({ keyword: event.target.value })}
              onPressEnter={submitSearch}
              style={{ width: 220 }}
            />
            <Select
              placeholder="兑换状态"
              value={filters.status}
              onChange={(value) => updateFilters({ status: value })}
              style={{ width: 140 }}
              options={[
                { label: '全部状态', value: undefined },
                { label: '未使用', value: 'unused' },
                { label: '已使用', value: 'used' },
                { label: '已过期', value: 'expired' },
                { label: '已停用', value: 'disabled' }
              ]}
            />
            <Select
              placeholder="权益类型"
              value={filters.grantType}
              onChange={(value) => updateFilters({ grantType: value })}
              style={{ width: 140 }}
              options={[
                { label: '全部类型', value: undefined },
                { label: '会员', value: 'member' },
                { label: '单应用', value: 'app' }
              ]}
            />
            <Select
              allowClear
              placeholder="所属活动"
              value={filters.batchId}
              onChange={(value) => updateFilters({ batchId: value })}
              style={{ width: 220 }}
              options={batches
                .filter((batch) => !filters.grantType || batch.grantType === filters.grantType)
                .map((batch) => ({
                  label: batch.name,
                  value: batch._id
                }))}
            />
            <Button type="primary" onClick={submitSearch}>
              查询
            </Button>
            <Button onClick={resetSearch}>重置</Button>
            <Button onClick={() => loadAll(filters, codePagination.current, codePagination.pageSize)}>刷新</Button>
            <Button loading={excelExporting} onClick={() => void exportCodesExcel()}>
              导出 Excel
            </Button>
            <Button onClick={() => setBatchManageOpen(true)}>活动管理</Button>
            <Button type="primary" onClick={() => setGenerateModalOpen(true)}>
              生成兑换码
            </Button>
          </Space>
        </div>

        <Typography.Title level={5}>兑换码列表</Typography.Title>
        <Table
          rowKey="_id"
          columns={codeColumns}
          dataSource={codes}
          loading={loading}
          pagination={{
            current: codePagination.current,
            pageSize: codePagination.pageSize,
            total: codesTotal,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50', '100'],
            showTotal: (total) => `共 ${total} 条`,
            onChange: (page, pageSize) => {
              void loadAll(filters, page, pageSize);
            }
          }}
          scroll={{ x: 1040 }}
        />
      </main>

      <Modal
        title="兑换活动管理"
        open={batchManageOpen}
        onCancel={() => setBatchManageOpen(false)}
        footer={[
          <Button key="close" onClick={() => setBatchManageOpen(false)}>
            关闭
          </Button>,
          <Button key="create" type="primary" onClick={openBatchCreate}>
            新增活动
          </Button>
        ]}
        width={980}
        destroyOnClose
      >
        <Table
          rowKey="_id"
          columns={batchColumns}
          dataSource={batches}
          loading={loading}
          pagination={false}
          scroll={{ x: 900 }}
        />
      </Modal>

      <Modal
        title={editingBatch ? '编辑兑换活动' : '新增兑换活动'}
        open={batchFormOpen}
        onCancel={() => setBatchFormOpen(false)}
        onOk={submitBatch}
        destroyOnClose
        width={880}
      >
        <Form form={batchForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="活动名" name="name" rules={[{ required: true, message: '请输入活动名' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="兑换码前缀" name="codePrefix">
                <Input placeholder="VIP2026" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="权益类型" name="grantType" rules={[{ required: true, message: '请选择权益类型' }]}>
                <Select
                  options={[
                    { label: '会员', value: 'member' },
                    { label: '单应用', value: 'app' }
                  ]}
                  onChange={handleGrantTypeChange}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="状态" name="status" rules={[{ required: true, message: '请选择状态' }]}>
                <Select
                  options={[
                    { label: '草稿', value: 'draft' },
                    { label: '启用', value: 'active' },
                    { label: '停用', value: 'disabled' }
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) =>
              getFieldValue('grantType') === 'app' ? (
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="绑定应用" name="appId" rules={[{ required: true, message: '请选择应用' }]}>
                      <Select
                        options={explicitApps.map((app) => ({
                          label: app.name,
                          value: app._id
                        }))}
                        placeholder={explicitApps.length ? '请选择应用' : '暂无可用于单应用兑换的应用'}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="兑换时长" name="appDurationDays" rules={[{ required: true, message: '请输入兑换时长' }]}>
                      <InputNumber min={1} style={{ width: '100%' }} addonAfter="天" />
                    </Form.Item>
                  </Col>
                </Row>
              ) : (
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="绑定套餐" name="planId" rules={[{ required: true, message: '请选择套餐' }]}>
                      <Select
                        options={plans.map((plan) => ({
                          label: `${plan.name} / ${plan.durationDays}天`,
                          value: plan._id
                        }))}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12} />
                </Row>
              )
            }
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="用户可见标题" name="userVisibleTitle" rules={[{ required: true, message: '请输入标题' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="过期日期" name="expiresAt">
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="用户可见说明" name="userVisibleDescription">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="生成兑换码"
        open={generateModalOpen}
        onCancel={() => setGenerateModalOpen(false)}
        onOk={submitGenerate}
        confirmLoading={generating}
        maskClosable={!generating}
        closable={!generating}
        destroyOnClose
      >
        <Form form={generateForm} layout="vertical" initialValues={{ count: 10 }}>
          <Form.Item label="选择活动" name="batchId" rules={[{ required: true, message: '请选择活动' }]}>
            <Select
              options={activeBatches.map((batch) => ({
                label: `${batch.name} / ${grantTypeLabelOf(batch.grantType)} / ${batchBindTargetLabelOf(batch)}`,
                value: batch._id
              }))}
              placeholder={activeBatches.length ? '请选择启用中的兑换活动' : '暂无可生成兑换码的启用活动'}
            />
          </Form.Item>
          <Form.Item label="生成数量" name="count" rules={[{ required: true, message: '请输入数量' }]}>
            <InputNumber min={1} max={500} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default RedeemCodesPage;
