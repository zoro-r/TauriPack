import React from 'react';
import { Result, Typography } from 'antd';
import './index.less';

const SuccessPage: React.FC = () => {
  return (
    <div className="success-page">
      <Result
        status="success"
        title="授权成功"
        subTitle="电脑端正在自动同步登录状态，请回到电脑端继续操作"
      />
      <Typography.Paragraph className="success-tip">
        如果电脑端长时间没有变化，请返回扫码弹窗后刷新二维码重新扫码。
      </Typography.Paragraph>
    </div>
  );
};

export default SuccessPage;
