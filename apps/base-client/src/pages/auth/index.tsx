import React, { useMemo, useState } from 'react';
import { Button, Result, Typography } from 'antd';
import request from '../../utils/request';
import './index.css';

const AuthPage: React.FC = () => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('点击确认后将跳转微信授权');

  const state = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('state') || '';
  }, []);

  const handleConfirm = async () => {
    if (!state) {
      setStatus('error');
      setMessage('缺少 state 参数');
      return;
    }
    setStatus('loading');
    setMessage('正在获取授权链接...');
    try {
      const data = await request<{ authorizeUrl: string }>(
        '/api/auth/wechat/authorize-url',
        {
          method: 'POST',
          data: { state },
          alert: false
        }
      );
      window.location.href = data.authorizeUrl;
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '获取授权链接失败');
    }
  };

  const content = () => {
    if (status === 'success') {
      return <Result status="success" title="授权成功" subTitle="你可以关闭此页面" />;
    }
    if (status === 'error') {
      return <Result status="error" title="授权失败" subTitle={message} />;
    }
    return (
      <div className="auth-body">
        <Typography.Title level={2} className="auth-title">
          公众号授权登录
        </Typography.Title>
        <Typography.Paragraph className="auth-tip">{message}</Typography.Paragraph>
        <div className="auth-actions">
          <Button
            type="primary"
            size="large"
            onClick={handleConfirm}
            loading={status === 'loading'}
            className="auth-button"
          >
            确认登录
          </Button>
        </div>
        <Typography.Text className="auth-footnote" type="secondary">
          如未跳转，请检查浏览器是否拦截弹窗或网络是否通畅
        </Typography.Text>
      </div>
    );
  };

  return (
    <div className="auth-shell">
      <div className="auth-hero">
        <img
          className="auth-logo"
          src="https://yun.cbysaas.com/yzd_kp/uniacid1/u0/img/2026/4/15/1776242248057637290.png"
          alt="企业logo"
        />
        <div className="auth-divider" />
        {content()}
      </div>
    </div>
  );
};

export default AuthPage;
