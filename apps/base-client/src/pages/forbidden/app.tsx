import React, { useMemo } from 'react';
import { Button, Result, Space, Typography } from 'antd';
import { history } from '@umijs/max';
import './member.css';

const AppForbiddenPage: React.FC = () => {
  const redirectTarget = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('redirect') || '/';
  }, []);

  const goHome = () => {
    history.push('/');
  };

  const goBack = () => {
    if (window.history.length > 1) {
      history.back();
      return;
    }
    history.push('/');
  };

  return (
    <div className="member-forbidden-shell">
      <div className="member-forbidden-panel">
        <img
          className="member-forbidden-logo"
          src="https://yun.cbysaas.com/yzd_kp/uniacid1/u0/img/2026/4/15/1776242248057637290.png"
          alt="企业logo"
        />
        <div className="member-forbidden-divider" />
        <Result
          status="403"
          title="当前应用需要单独授权"
          subTitle="你已登录，但当前账号还没有这个应用的访问权限。请先购买、兑换或联系管理员开通。"
        />
        <Typography.Paragraph className="member-forbidden-tip">
          开通对应应用权限后，可返回刚才的地址继续访问。
        </Typography.Paragraph>
        <Space size={12} wrap>
          <Button size="large" onClick={goBack}>
            返回上一页
          </Button>
          <Button type="primary" size="large" onClick={goHome}>
            返回首页
          </Button>
        </Space>
      </div>
    </div>
  );
};

export default AppForbiddenPage;
