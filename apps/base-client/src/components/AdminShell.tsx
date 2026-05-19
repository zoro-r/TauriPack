import React, { useEffect, useState } from 'react';
import { Avatar, Button, Dropdown, MenuProps, Space, message } from 'antd';
import { history, useLocation } from '@umijs/max';
import request from '../utils/request';
import {
  clearAuthStorage,
  getCurrentUserFromStorage,
  nameInitial,
  type CurrentUser,
  type NavMenuItem
} from '../utils/auth';

interface AdminShellProps {
  children: React.ReactNode;
}

const defaultMenus: NavMenuItem[] = [{ key: 'apps', label: '应用广场', path: '/' }];

const AdminShell: React.FC<AdminShellProps> = ({ children }) => {
  const [messageApi, contextHolder] = message.useMessage();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(() => getCurrentUserFromStorage());
  const [menus, setMenus] = useState<NavMenuItem[]>(defaultMenus);
  const location = useLocation();

  const fetchCurrentUser = async () => {
    const user = await request<CurrentUser>('/api/auth/me');
    localStorage.setItem('userInfo', JSON.stringify(user));
    setCurrentUser(user);
    return user;
  };

  const fetchMenus = async () => {
    const data = await request<NavMenuItem[]>('/api/auth/menus', { alert: false });
    setMenus(data.length ? data : defaultMenus);
  };

  useEffect(() => {
    fetchCurrentUser().catch(() => {
      clearAuthStorage();
      setCurrentUser(null);
      history.replace('/');
    });
    fetchMenus().catch(() => undefined);
  }, []);

  const handleLogout = () => {
    request('/api/auth/logout', {
      method: 'POST',
      alert: false
    }).catch(() => undefined);
    clearAuthStorage();
    setCurrentUser(null);
    history.replace('/');
    messageApi.success('已退出当前账号');
  };

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'logout',
      label: '退出登录',
      danger: true
    }
  ];

  return (
    <>
      {contextHolder}
      <div className="catalog-page">
        <div className="catalog-page__hero">
          <div className="catalog-page__hero-left">
            <div className="catalog-brand">
              <img
                className="catalog-brand__logo-image"
                src="https://yun.cbysaas.com/yzd_kp/uniacid1/u0/img/2026/4/15/1776242248057637290.png"
                alt="应用管理台"
              />
            </div>
            <nav className="catalog-topnav" aria-label="主导航">
              {menus.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`catalog-topnav__item ${location.pathname === (item.path || '/') ? 'is-active' : ''}`}
                  onClick={() => history.push(item.path || '/')}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
          <div className="catalog-page__hero-right">
            <div className="catalog-user-panel">
              <Avatar size={42} src={currentUser?.avatar} className="catalog-user-panel__avatar">
                {nameInitial(currentUser?.nickname)}
              </Avatar>
              <div className="catalog-user-panel__meta">
                <div className="catalog-user-panel__name">
                  {currentUser?.nickname || '游客访问'}
                </div>
                <div className="catalog-user-panel__sub">
                  {currentUser?.role === 'admin' ? '管理员' : '普通用户'}
                </div>
              </div>
              <Space.Compact>
                <Dropdown
                  menu={{
                    items: userMenuItems,
                    onClick: ({ key }) => {
                      if (key === 'logout') {
                        handleLogout();
                      }
                    }
                  }}
                  trigger={['click']}
                >
                  <Button>个人中心</Button>
                </Dropdown>
              </Space.Compact>
            </div>
          </div>
        </div>
        {children}
      </div>
    </>
  );
};

export default AdminShell;
