import React from 'react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import './global.css';

dayjs.locale('zh-cn');

export function rootContainer(container: React.ReactNode) {
  return <ConfigProvider locale={zhCN}>{container}</ConfigProvider>;
}
