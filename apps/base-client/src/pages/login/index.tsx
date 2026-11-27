import React, { useEffect, useMemo, useState } from 'react';
import { Button, Result, Spin, Typography } from 'antd';
import request from '../../utils/request';
import { completeWechatLogin, getWechatLoginQr, openOrangeLogin } from '../../utils/orangeLogin';
import './index.css';

interface LoginStatePayload {
  state: string;
  expiresAt: string;
  qrUrl: string;
}

interface LoginStatusPayload {
  status: 'PENDING' | 'SCANNED' | 'SUCCESS' | 'EXPIRED';
  loginCode?: string;
}

const qrImageOf = (value: string) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(value)}`;

const LoginPage: React.FC = () => {
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginState, setLoginState] = useState<LoginStatePayload | null>(null);
  const [bindOrange, setBindOrange] = useState(false);
  const [loginStatusText, setLoginStatusText] = useState('请使用微信扫码登录');

  const { redirectTarget, reasonText } = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get('redirect');
    const reason = params.get('reason') || '';
    let reasonText = '完成扫码登录后，页面会自动跳转回你刚才要访问的位置。';
    if (reason.includes('会话已在其他设备登录')) {
      reasonText = '你的账号已在其他设备登录，请重新扫码登录后继续访问应用。';
    } else if (reason.includes('登录已过期')) {
      reasonText = '当前登录状态已过期，请重新扫码登录后继续访问应用。';
    } else if (reason.includes('未登录')) {
      reasonText = '当前访问需要先登录，完成扫码后会自动跳转回你刚才要访问的位置。';
    }
    if (!redirect) {
      return { redirectTarget: '/', reasonText };
    }
    try {
      return { redirectTarget: decodeURIComponent(redirect), reasonText };
    } catch {
      return { redirectTarget: redirect, reasonText };
    }
  }, []);

  const handleLoginEntry = async () => {
    setLoginLoading(true);
    try {
      const status = await openOrangeLogin(true);
      if (status === 'signed-in') {
        window.location.replace(siteRedirect());
        return;
      }
      const bind = status === 'scan-required';
      const data = await getWechatLoginQr<LoginStatePayload>(bind);
      setBindOrange(bind);
      setLoginState(data);
      setLoginStatusText(bind ? '请使用微信扫码绑定' : '请使用微信扫码登录');
    } catch (error) {
      setLoginStatusText(error instanceof Error ? error.message : '二维码生成失败，请刷新重试');
    } finally {
      setLoginLoading(false);
    }
  };

  const siteRedirect = () => {
    try {
      const target = new URL(redirectTarget, window.location.origin);
      if (target.origin === window.location.origin && !target.hash.startsWith('#/login') && target.pathname !== '/login') return target.href;
    } catch {
      // If the destination is invalid, open the catalog.
    }
    return '/';
  };

  const finalizeLogin = async (loginCode: string) => {
    await completeWechatLogin(loginCode, bindOrange);
    window.location.href = bindOrange ? siteRedirect() : redirectTarget || '/';
  };

  useEffect(() => {
    handleLoginEntry().catch(() => {
      setLoginStatusText('二维码生成失败，请刷新重试');
    });
  }, [redirectTarget]);

  useEffect(() => {
    if (!loginState?.state) {
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
        if (stopped) return;

        if (statusData.status === 'SUCCESS' && statusData.loginCode) {
          stopped = true;
          window.clearInterval(timer);
          setLoginStatusText(bindOrange ? '授权完成，正在绑定…' : '授权完成，正在登录…');
          try {
            await finalizeLogin(statusData.loginCode);
          } catch (error) {
            setLoginStatusText(error instanceof Error ? error.message : '登录失败，请刷新二维码后重试');
          }
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

        setLoginStatusText(bindOrange ? '请使用微信扫码绑定' : '请使用微信扫码登录');
      } catch {
        setLoginStatusText('登录状态查询失败，请稍后重试');
      }
    }, 2000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [bindOrange, loginState]);

  return (
    <div className="login-shell">
      <div className="login-panel">
        <img
          className="login-logo"
          src="https://yun.cbysaas.com/yzd_kp/uniacid1/u0/img/2026/4/15/1776242248057637290.png"
          alt="企业logo"
        />
        <div className="login-panel__divider" />
        <div className="login-panel__body">
          <Typography.Title level={2} className="login-panel__title">
            登录后继续访问应用
          </Typography.Title>
          <Typography.Paragraph className="login-panel__tip">
            {bindOrange ? '扫码后绑定当前橙子账号，下次从橙子打开可直接登录。' : reasonText}
          </Typography.Paragraph>

          {loginState?.qrUrl ? (
            <>
              <div className="login-panel__qr">
                <img src={qrImageOf(loginState.qrUrl)} alt="微信扫码登录二维码" />
              </div>
              <div className="login-panel__status">{loginStatusText}</div>
              <Typography.Text className="login-panel__footnote" type="secondary">
                如果二维码失效，可手动刷新后重新扫码。
              </Typography.Text>
            </>
          ) : loginLoading ? (
            <div className="login-panel__loading">
              <Spin />
            </div>
          ) : (
            <Result
              status="warning"
              title="暂时无法生成登录二维码"
              extra={
                <Button type="primary" onClick={() => handleLoginEntry()}>
                  重新获取二维码
                </Button>
              }
            />
          )}

          {loginState?.qrUrl ? (
            <div className="login-panel__actions">
              <Button onClick={() => handleLoginEntry()} loading={loginLoading}>
                刷新二维码
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
