import React, { useState } from 'react';
import { Button, Card, Form, Input, Space, Tag, Typography, message } from 'antd';
import request from '../../utils/request';
import { formatDateTime } from '../../utils/auth';

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

const redeemTypeLabelOf = (value: RedeemPreview['grantType']) => (value === 'app' ? '单应用权限' : '会员权益');

const RedeemPage: React.FC = () => {
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<RedeemPreview | null>(null);
  const [result, setResult] = useState<RedeemResult | null>(null);
  const [form] = Form.useForm<{ code: string }>();

  const previewRedeem = async () => {
    const values = await form.validateFields();
    setPreviewLoading(true);
    try {
      const data = await request<RedeemPreview>('/api/redeem/preview', {
        method: 'POST',
        data: values
      });
      setPreview(data);
      setResult(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const submitRedeem = async () => {
    const values = await form.validateFields();
    setLoading(true);
    try {
      const data = await request<RedeemResult>('/api/redeem/submit', {
        method: 'POST',
        data: values
      });
      setResult(data);
      messageApi.success('兑换成功');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {contextHolder}
      <main className="catalog-main catalog-main--wide">
        <Card title="兑换中心" bordered={false} className="redeem-panel">
          <div className="redeem-panel__hero">
            <div>
              <Typography.Title level={4}>输入兑换码，先核对内容，再确认兑换</Typography.Title>
              <Typography.Paragraph type="secondary">
                兑换前会展示本次到账权益，避免误兑。
              </Typography.Paragraph>
            </div>
          </div>

          <Form form={form} layout="vertical">
            <div className="redeem-panel__form-row">
              <Form.Item
                className="redeem-panel__form-item"
                label="兑换码"
                name="code"
                rules={[{ required: true, message: '请输入兑换码' }]}
              >
                <Input placeholder="请输入兑换码" size="large" />
              </Form.Item>
              <Button type="default" size="large" loading={previewLoading} onClick={previewRedeem}>
                查询兑换内容
              </Button>
            </div>
          </Form>

          {preview ? (
            <div className="redeem-card redeem-card--preview">
              <div className="redeem-card__head">
                <div>
                  <div className="redeem-card__eyebrow">兑换内容预览</div>
                  <Typography.Title level={5}>{preview.benefit?.title || '待兑换权益'}</Typography.Title>
                </div>
                <Tag color={preview.grantType === 'app' ? 'blue' : 'gold'}>
                  {redeemTypeLabelOf(preview.grantType)}
                </Tag>
              </div>
              <Typography.Paragraph className="redeem-card__desc">
                {preview.benefit?.description || '请确认兑换内容后再提交兑换'}
              </Typography.Paragraph>
              {preview.ownership?.statusText && !preview.ownership?.currentExpiredAt ? (
                <Typography.Paragraph type="secondary" className="redeem-card__hint">
                  {preview.ownership.statusText}
                </Typography.Paragraph>
              ) : null}
              {preview.ownership?.currentExpiredAt ? (
                <div className="redeem-card__notice">
                  <span className="redeem-card__notice-label">续期提醒</span>
                  <strong>
                    当前有效至 {formatDateTime(preview.ownership.currentExpiredAt)}，确认兑换后将在此基础上顺延
                  </strong>
                </div>
              ) : null}
              <div className="redeem-card__meta">
                <div className="redeem-card__meta-item">
                  <span>兑换活动</span>
                  <strong>{preview.batchName}</strong>
                </div>
                {preview.grantType === 'member' ? (
                  <>
                    <div className="redeem-card__meta-item">
                      <span>兑换时长</span>
                      <strong>{preview.benefit?.durationLabel || `${preview.benefit?.durationDays || 0} 天`}</strong>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="redeem-card__meta-item">
                      <span>应用权限</span>
                      <strong>{preview.benefit?.appName || '--'}</strong>
                    </div>
                    <div className="redeem-card__meta-item">
                      <span>兑换时长</span>
                      <strong>{preview.benefit?.durationLabel || `${preview.benefit?.durationDays || 0} 天`}</strong>
                    </div>
                  </>
                )}
              </div>
              <Space className="redeem-card__actions">
                <Button type="primary" size="large" loading={loading} onClick={submitRedeem}>
                  确认兑换
                </Button>
                <Typography.Text type="secondary">确认后将立即到账，无法撤销</Typography.Text>
              </Space>
            </div>
          ) : null}

          {result?.benefit ? (
            <div className="redeem-card redeem-card--success">
              <div className="redeem-card__head">
                <div>
                  <div className="redeem-card__eyebrow">兑换成功</div>
                  <Typography.Title level={5}>{result.benefit.title || '权益已到账'}</Typography.Title>
                </div>
                <Tag color="green">已到账</Tag>
              </div>
              <Typography.Paragraph className="redeem-card__desc">
                {result.benefit.description || '会员权益已到账'}
              </Typography.Paragraph>
              {result.benefit.expiredAt ? (
                <div className="redeem-card__meta">
                  <div className="redeem-card__meta-item">
                    <span>到期时间</span>
                    <strong>{formatDateTime(result.benefit.expiredAt)}</strong>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>
      </main>
    </>
  );
};

export default RedeemPage;
