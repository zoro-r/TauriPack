import React, { useEffect, useMemo, useState } from 'react';
import { Button, Result, Spin } from 'antd';
import request from '../../utils/request';
import './index.css';

interface TemporaryLinkClaim {
  entryUrl: string;
}

const AppSharePage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const token = useMemo(() => {
    const fragmentToken = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token');
    const legacyQueryToken = new URLSearchParams(window.location.search).get('token');
    const value = fragmentToken || legacyQueryToken || '';
    if (value) {
      window.history.replaceState(null, '', '/app-share');
    }
    return value;
  }, []);

  useEffect(() => {
    if (!token) {
      setErrorText('临时链接无效');
      setLoading(false);
      return;
    }
    request<TemporaryLinkClaim>('/api/temporary-links/claim', {
      method: 'POST',
      data: { token },
      alert: false
    })
      .then((result) => window.location.replace(result.entryUrl))
      .catch((error) => setErrorText(error?.message || '临时链接已失效'))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="app-share-page">
      <div className="app-share-card">
        {loading ? (
          <div className="app-share-loading"><Spin size="large" tip="正在进入应用..." /></div>
        ) : errorText ? (
          <Result
            status="warning"
            title="临时链接已失效"
            subTitle={`${errorText}。你可以浏览平台上的其他应用，或登录后查看自己已获得的应用。`}
            extra={[
              <Button type="primary" key="catalog" onClick={() => { window.location.href = '/'; }}>
                浏览更多应用
              </Button>,
              <Button key="login" onClick={() => { window.location.href = '/login'; }}>
                登录平台
              </Button>
            ]}
          />
        ) : null}
      </div>
    </div>
  );
};

export default AppSharePage;
