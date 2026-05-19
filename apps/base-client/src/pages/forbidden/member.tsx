import React, { useMemo } from 'react';
import { Button, Result, Space, Typography } from 'antd';
import { history } from '@umijs/max';
import './member.css';

const MemberForbiddenPage: React.FC = () => {
  const redirectTarget = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('redirect') || '/';
  }, []);

  const goHome = () => {
    history.push('/');
  };

  const goMemberCenter = () => {
    history.push(`/?openMemberCenter=1&redirect=${encodeURIComponent(redirectTarget)}`);
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
          status="warning"
          title="当前应用仅会员可访问"
          subTitle="你已登录，但当前账号还没有会员权限。开通会员后即可继续访问这个应用。"
        />
        <Typography.Paragraph className="member-forbidden-tip">
          开通后可返回刚才的应用页面继续访问，无需重新定位入口。
        </Typography.Paragraph>
        <Space size={12} wrap>
          <Button size="large" onClick={goHome}>
            返回首页
          </Button>
          <Button type="primary" size="large" onClick={goMemberCenter}>
            购买会员
          </Button>
        </Space>
      </div>
    </div>
  );
};

export default MemberForbiddenPage;
