import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Button,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Typography,
  Upload,
  message
} from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import request from '../utils/request';
import {
  clearAuthStorage,
  formatDateTime,
  getCurrentUserFromStorage,
  nameInitial,
  type CurrentUser
} from '../utils/auth';
import './index.css';

interface AppCategory {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  sort: number;
  isActive: boolean;
}

type AppMediaKind = 'image' | 'video';

interface AppMediaItem {
  type: AppMediaKind;
  url: string;
  poster?: string;
  caption?: string;
  sort?: number;
}

interface AppItem {
  _id: string;
  name: string;
  slug: string;
  accessLevel: 'login' | 'member' | 'explicit';
  summary?: string;
  description?: string;
  cover?: string;
  publisher?: string;
  content?: string;
  media?: AppMediaItem[];
  packageName?: string;
  packageUrl?: string;
  entryUrl?: string;
  categoryId:
    | string
    | {
        _id: string;
        name: string;
        slug: string;
      };
}

interface CategoryFormValues {
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  sort?: number;
  isActive: boolean;
}

interface AppFormValues {
  name: string;
  categoryId: string;
  accessLevel: 'login' | 'member' | 'explicit';
  summary?: string;
  description?: string;
  cover?: string;
  media?: AppMediaItem[];
}

interface AppPackageUploadResult {
  appSlug: string;
  packageName: string;
  packageUrl: string;
  entryUrl: string;
}

interface AppCoverUploadResult {
  coverUrl: string;
}

interface AppCatalogMediaUploadResult {
  url: string;
}

interface LoginStatePayload {
  state: string;
  expiresAt: string;
  qrUrl: string;
}

interface LoginStatusPayload {
  status: 'PENDING' | 'SCANNED' | 'SUCCESS' | 'EXPIRED';
  loginCode?: string;
}

interface MemberPlan {
  _id: string;
  name: string;
  code: string;
  price: number;
  originalPrice?: number;
  durationDays: number;
  description?: string;
  isVisibleToUser?: boolean;
}

interface MemberInfo {
  isMember: boolean;
  memberLevel: string;
  status: 'active' | 'expired';
  startedAt?: string;
  expiredAt?: string;
}

interface MemberOrderPayload {
  id: string;
  orderNo: string;
  amount: number;
  status: 'pending' | 'paid' | 'closed' | 'refunded';
  payChannel: 'wechat_native';
  codeUrl: string;
}

interface AppAccessPayload {
  allowed: boolean;
  reason: 'login' | 'entitlement' | 'member' | 'explicit_required' | 'member_required';
}

const categoryNameOf = (categoryId: AppItem['categoryId']) =>
  typeof categoryId === 'string' ? '' : categoryId?.name || '';

/** 后端按 sort 存；列表展示前再兜底排一次序 */
const sortAppMediaItems = (media?: AppMediaItem[]) =>
  [...(media ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

const CATALOG_DETAIL_MEDIA_PER_PAGE = 3;
const CATALOG_DETAIL_MEDIA_CAROUSEL_INTERVAL_MS = 4500;

const chunkItems = <T,>(items: T[], size: number): T[][] => {
  if (size < 1) {
    return items.length ? [items] : [];
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
};

const resolveAppAssetUrl = (value?: string) => {
  if (!value) {
    return '';
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.pathname.startsWith('/static/')) {
        return `${window.location.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      return value;
    }
    return value;
  }
  if (value.startsWith('/')) {
    return `${window.location.origin}${value}`;
  }
  return value;
};

/** 与应用详情媒体上传后端 `limits.fileSize` 一致 */
const CATALOG_MEDIA_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

const qrImageOf = (value: string) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(value)}`;

const CatalogDetailMediaPreviewModal = ({
  open,
  items,
  activeIndex,
  onClose,
  onChangeIndex
}: {
  open: boolean;
  items: AppMediaItem[];
  activeIndex: number;
  onClose: () => void;
  onChangeIndex: (nextIndex: number) => void;
}) => {
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const total = items.length;
  const safeActiveIndex = total > 0 ? ((activeIndex % total) + total) % total : 0;
  const currentItem = items[safeActiveIndex];

  useEffect(() => {
    if (!open) {
      previewVideoRef.current?.pause();
      return undefined;
    }

    if (!currentItem || currentItem.type !== 'video') {
      previewVideoRef.current?.pause();
      return undefined;
    }

    const el = previewVideoRef.current;
    if (!el) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      void el.play().catch(() => {});
    });

    return () => {
      window.cancelAnimationFrame(frame);
      el.pause();
    };
  }, [currentItem?.type, currentItem?.url, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (total < 2) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onChangeIndex((safeActiveIndex - 1 + total) % total);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        onChangeIndex((safeActiveIndex + 1) % total);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onChangeIndex, onClose, open, safeActiveIndex, total]);

  return (
      <Modal
        centered
        rootClassName="catalog-app-detail__media-preview-modal"
        destroyOnClose
        open={open}
        footer={null}
        keyboard={false}
        maskClosable
        width="min(94vw, 1240px)"
        title={null}
        zIndex={2120}
        onCancel={onClose}
        styles={{
          body: { padding: 0, background: 'transparent' },
          content: { padding: 0, background: 'transparent', boxShadow: 'none' }
        }}
      >
        {currentItem ? (
          <div className="catalog-app-detail__media-preview-shell">
            {total > 1 ? (
              <button
                type="button"
                className="catalog-app-detail__media-preview-arrow catalog-app-detail__media-preview-arrow--prev"
                aria-label="上一项"
                onClick={() => onChangeIndex((safeActiveIndex - 1 + total) % total)}
              >
                <svg viewBox="0 0 24 24" aria-hidden focusable={false}>
                  <path d="M15.5 5.5 9 12l6.5 6.5" />
                </svg>
              </button>
            ) : null}

            {total > 1 ? (
              <button
                type="button"
                className="catalog-app-detail__media-preview-arrow catalog-app-detail__media-preview-arrow--next"
                aria-label="下一项"
                onClick={() => onChangeIndex((safeActiveIndex + 1) % total)}
              >
                <svg viewBox="0 0 24 24" aria-hidden focusable={false}>
                  <path d="M8.5 5.5 15 12l-6.5 6.5" />
                </svg>
              </button>
            ) : null}

            <div className="catalog-app-detail__media-preview-stage">
              <div
                key={`${currentItem.type}-${currentItem.url}`}
                className={`catalog-app-detail__media-preview-frame catalog-app-detail__media-preview-frame--${currentItem.type}${
                  currentItem.caption?.trim() ? ' catalog-app-detail__media-preview-frame--captioned' : ''
                }`}
              >
                <div className="catalog-app-detail__media-preview-mat">
                  {currentItem.type === 'video' ? (
                    <video
                      ref={previewVideoRef}
                      className="catalog-app-detail__media-preview-video"
                      controls
                      playsInline
                      preload="metadata"
                      autoPlay
                      poster={currentItem.poster ? resolveAppAssetUrl(currentItem.poster) : undefined}
                      controlsList="nodownload noplaybackrate noremoteplayback"
                      disablePictureInPicture
                      src={resolveAppAssetUrl(currentItem.url)}
                    />
                  ) : (
                    <img
                      className="catalog-app-detail__media-preview-image"
                      src={resolveAppAssetUrl(currentItem.url)}
                      alt={currentItem.caption?.trim() || '图片预览'}
                    />
                  )}
                </div>
                {currentItem.caption?.trim() ? (
                  <div className="catalog-app-detail__media-preview-footer">
                    <span className="catalog-app-detail__media-preview-pill">
                      {currentItem.caption.trim()}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>

            {total > 1 ? (
              <div className="catalog-app-detail__media-preview-thumbs" role="tablist" aria-label="媒体缩略图">
                <div className="catalog-app-detail__media-preview-thumbs-track">
                  {items.map((item, idx) => {
                    const active = idx === safeActiveIndex;
                    const thumbSrc = resolveAppAssetUrl(item.url);
                    const thumbPoster = item.poster ? resolveAppAssetUrl(item.poster) : undefined;
                    return (
                      <button
                        key={`thumb-${item.type}-${item.url}-${idx}`}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        className={`catalog-app-detail__media-preview-thumb ${active ? 'is-active' : ''}`}
                        onClick={() => onChangeIndex(idx)}
                      >
                        {item.type === 'video' ? (
                          <video
                            className="catalog-app-detail__media-preview-thumb-visual"
                            src={thumbSrc}
                            poster={thumbPoster}
                            muted
                            playsInline
                            preload="metadata"
                            aria-hidden
                          />
                        ) : (
                          <img
                            className="catalog-app-detail__media-preview-thumb-visual"
                            src={thumbSrc}
                            alt=""
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
  );
};

const CatalogDetailMediaImageTile = ({
  item,
  onOpen
}: {
  item: AppMediaItem;
  onOpen: () => void;
}) => {
  const resolved = resolveAppAssetUrl(item.url);

  return (
    <figure className="catalog-app-detail__media-card">
      <button
        type="button"
        className="catalog-app-detail__media-card-frame catalog-app-detail__media-card-frame--thumb"
        aria-label="预览图片"
        onClick={onOpen}
      >
        <img className="catalog-app-detail__media-card-visual" src={resolved} alt="" />
      </button>
    </figure>
  );
};

const CatalogDetailMediaVideoTile = ({
  item,
  onOpen
}: {
  item: AppMediaItem;
  onOpen: () => void;
}) => {
  const resolved = resolveAppAssetUrl(item.url);
  const resolvedPoster = item.poster ? resolveAppAssetUrl(item.poster) : undefined;

  return (
    <figure className="catalog-app-detail__media-card">
      <button
        type="button"
        className="catalog-app-detail__media-card-frame catalog-app-detail__media-card-frame--video-hit"
        aria-label="预览视频"
        onClick={onOpen}
      >
        <video
          className="catalog-app-detail__media-card-visual catalog-app-detail__media-card-visual--thumb"
          playsInline
          preload="metadata"
          muted
          poster={resolvedPoster}
          src={resolved}
        />
        <span className="catalog-app-detail__media-play-hit" aria-hidden>
          <span className="catalog-app-detail__media-play-circle">
            <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden focusable={false}>
              <polygon fill="rgba(255,255,255,0.95)" points="8,5.5 18,12 8,18.5" />
            </svg>
          </span>
        </span>
      </button>
    </figure>
  );
};

const HomePage: React.FC = () => {
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<AppCategory[]>([]);
  const [apps, setApps] = useState<AppItem[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string>('all');
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryManageOpen, setCategoryManageOpen] = useState(false);
  const [appModalOpen, setAppModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<AppCategory | null>(null);
  const [editingApp, setEditingApp] = useState<AppItem | null>(null);
  const [selectedApp, setSelectedApp] = useState<AppItem | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [memberInfo, setMemberInfo] = useState<MemberInfo | null>(null);
  const [memberPlans, setMemberPlans] = useState<MemberPlan[]>([]);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [memberLoading, setMemberLoading] = useState(false);
  const [payingPlanCode, setPayingPlanCode] = useState('');
  const [memberOrder, setMemberOrder] = useState<MemberOrderPayload | null>(null);
  const [memberPayStatus, setMemberPayStatus] = useState('请选择会员套餐');
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginState, setLoginState] = useState<LoginStatePayload | null>(null);
  const [loginStatusText, setLoginStatusText] = useState('请使用微信扫码登录');
  const activeTopNav = 'apps';
  const [appPackageFile, setAppPackageFile] = useState<File | null>(null);
  const [appPackageInfo, setAppPackageInfo] = useState<AppPackageUploadResult | null>(null);
  const [appCoverFile, setAppCoverFile] = useState<File | null>(null);
  const [appCoverUploading, setAppCoverUploading] = useState(false);
  const [catalogMediaUploadKey, setCatalogMediaUploadKey] = useState<string | null>(null);
  const [mediaPreviewIndex, setMediaPreviewIndex] = useState<number | null>(null);
  const [mediaCarouselPage, setMediaCarouselPage] = useState(0);
  const [mediaCarouselPaused, setMediaCarouselPaused] = useState(false);
  const [categoryForm] = Form.useForm<CategoryFormValues>();
  const [appForm] = Form.useForm<AppFormValues>();
  const isAdmin = currentUser?.role === 'admin';

  const loadData = async () => {
    setLoading(true);
    try {
      const [nextCategories, nextApps] = await Promise.all([
        request<AppCategory[]>('/api/app-categories'),
        request<AppItem[]>('/api/apps')
      ]);
      setCategories(nextCategories);
      setApps(nextApps);
    } finally {
      setLoading(false);
    }
  };

  const fetchCurrentUser = async () => {
    const user = await request<CurrentUser>('/api/auth/me', { alert: false });
    localStorage.setItem('userInfo', JSON.stringify(user));
    setCurrentUser(user);
    return user;
  };

  const fetchMemberInfo = async () => {
    const data = await request<MemberInfo>('/api/member/me', { alert: false });
    setMemberInfo(data);
    return data;
  };

  const fetchMemberPlans = async () => {
    const data = await request<MemberPlan[]>('/api/member/plans');
    setMemberPlans(data);
    return data;
  };

  useEffect(() => {
    const cachedUser = getCurrentUserFromStorage();
    setCurrentUser(cachedUser);
    fetchCurrentUser()
      .then(() => {
        fetchMemberInfo().catch(() => {
          setMemberInfo(null);
        });
      })
      .catch(() => {
        clearAuthStorage();
        setCurrentUser(null);
        setMemberInfo(null);
      });
    fetchMemberPlans().catch(() => undefined);
    loadData().catch((error) => {
      messageApi.error(error?.message || '数据加载失败');
    });
  }, [messageApi]);

  const refreshCurrentUser = () => {
    fetchCurrentUser().catch((error) => {
      messageApi.error(error?.message || '刷新用户信息失败');
    });
    fetchMemberInfo().catch(() => undefined);
  };

  const finalizeLogin = async (loginCode: string) => {
    await request('/api/auth/token', {
      method: 'POST',
      data: { loginCode },
      alert: false
    });
    window.location.reload();
  };

  useEffect(() => {
    if (!loginModalOpen || !loginState?.state) {
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

        if (statusData.status === 'SUCCESS' && statusData.loginCode) {
          stopped = true;
          window.clearInterval(timer);
          setLoginStatusText('授权完成，正在登录...');
          await finalizeLogin(statusData.loginCode);
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

        setLoginStatusText('请使用微信扫码登录');
      } catch {
        setLoginStatusText('登录状态查询失败，请稍后重试');
      }
    }, 2000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [loginModalOpen, loginState]);

  const handleLoginEntry = async () => {
    setLoginLoading(true);
    try {
      const data = await request<LoginStatePayload>('/api/auth/wechat/qr', { alert: false });
      setLoginState(data);
      setLoginStatusText('请使用微信扫码登录');
      setLoginModalOpen(true);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    request('/api/auth/logout', {
      method: 'POST',
      alert: false
    }).catch(() => undefined);
    clearAuthStorage();
    setCurrentUser(null);
    setMemberInfo(null);
    messageApi.success('已退出当前账号');
  };

  useEffect(() => {
    if (!memberModalOpen || !memberOrder?.id || !currentUser) {
      return undefined;
    }

    let stopped = false;
    const timer = window.setInterval(async () => {
      if (stopped) {
        return;
      }
      try {
        const order = await request<{
          status: MemberOrderPayload['status'];
          paidAt?: string;
        }>(`/api/member/orders/${memberOrder.id}`);

        if (order.status === 'paid') {
          stopped = true;
          window.clearInterval(timer);
          setMemberPayStatus('支付成功，会员已到账');
          await fetchMemberInfo().catch(() => undefined);
          return;
        }

        if (order.status === 'closed' || order.status === 'refunded') {
          stopped = true;
          window.clearInterval(timer);
          setMemberPayStatus('订单已关闭，请重新发起支付');
          return;
        }

        setMemberPayStatus('请使用微信扫码完成支付');
      } catch {
        setMemberPayStatus('订单状态查询失败，请稍后重试');
      }
    }, 3000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [memberModalOpen, memberOrder, currentUser]);

  const openMemberCenter = async () => {
    if (!currentUser) {
      await handleLoginEntry();
      return;
    }
    setMemberModalOpen(true);
    setMemberOrder(null);
    setMemberPayStatus('请选择会员套餐');
    fetchMemberPlans().catch(() => undefined);
    fetchMemberInfo().catch(() => undefined);
  };

  const createMemberOrder = async (planCode: string) => {
    setPayingPlanCode(planCode);
    try {
      const order = await request<MemberOrderPayload>('/api/member/orders', {
        method: 'POST',
        data: { planCode }
      });
      setMemberOrder(order);
      setMemberPayStatus('请使用微信扫码完成支付');
    } catch (error) {
      setMemberPayStatus(error instanceof Error ? error.message : '创建会员订单失败');
    } finally {
      setPayingPlanCode('');
    }
  };

  const visibleApps = useMemo(() => {
    if (activeCategoryId === 'all') {
      return apps;
    }
    return apps.filter((item) => {
      if (typeof item.categoryId === 'string') {
        return item.categoryId === activeCategoryId;
      }
      return item.categoryId?._id === activeCategoryId;
    });
  }, [activeCategoryId, apps]);

  const catalogDetailExtras = useMemo(() => {
    if (!selectedApp) {
      return { mediaSorted: [] as AppMediaItem[], hasTextDetail: false, hasSummary: false };
    }
    return {
      mediaSorted: sortAppMediaItems(selectedApp.media),
      hasTextDetail:
        !!(selectedApp.description && selectedApp.description.trim()) ||
        !!(selectedApp.content && selectedApp.content.trim()),
      hasSummary: !!(selectedApp.summary && selectedApp.summary.trim())
    };
  }, [selectedApp]);

  const catalogMediaPages = useMemo(
    () => chunkItems(catalogDetailExtras.mediaSorted, CATALOG_DETAIL_MEDIA_PER_PAGE),
    [catalogDetailExtras.mediaSorted]
  );

  useEffect(() => {
    setMediaCarouselPage(0);
  }, [selectedApp?._id]);

  useEffect(() => {
    setMediaCarouselPage((p) =>
      catalogMediaPages.length ? Math.min(p, catalogMediaPages.length - 1) : 0
    );
  }, [catalogMediaPages.length]);

  useEffect(() => {
    if (!selectedApp || catalogMediaPages.length <= 1 || mediaCarouselPaused) {
      return undefined;
    }
    const id = window.setInterval(() => {
      setMediaCarouselPage((p) => (p + 1) % catalogMediaPages.length);
    }, CATALOG_DETAIL_MEDIA_CAROUSEL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [selectedApp, catalogMediaPages.length, mediaCarouselPaused]);

  useEffect(() => {
    if (!selectedApp) {
      setMediaPreviewIndex(null);
    }
  }, [selectedApp]);

  const openCategoryCreate = () => {
    setEditingCategory(null);
    categoryForm.setFieldsValue({
      name: '',
      slug: '',
      description: '',
      icon: '',
      sort: 0,
      isActive: true
    });
    setCategoryModalOpen(true);
  };

  const openCategoryManage = async () => {
    if (!memberInfo?.isMember) {
      messageApi.info('分类管理仅会员可用，请先开通会员');
      await openMemberCenter();
      return;
    }
    setCategoryManageOpen(true);
  };

  const openCategoryEdit = (category: AppCategory) => {
    setEditingCategory(category);
    categoryForm.setFieldsValue({
      name: category.name,
      slug: category.slug,
      description: category.description,
      icon: category.icon,
      sort: category.sort,
      isActive: category.isActive
    });
    setCategoryModalOpen(true);
  };

  const openAppCreate = () => {
    setEditingApp(null);
    setAppPackageFile(null);
    setAppPackageInfo(null);
    setAppCoverFile(null);
    appForm.setFieldsValue({
      name: '',
      categoryId:
        activeCategoryId !== 'all' ? activeCategoryId : categories.find((item) => item.isActive)?._id,
      accessLevel: 'login',
      summary: '',
      description: '',
      cover: '',
      media: []
    });
    setAppModalOpen(true);
  };

  const openAppEdit = (app: AppItem) => {
    setEditingApp(app);
    setSelectedApp(null);
    setAppPackageFile(null);
    setAppCoverFile(null);
    setAppPackageInfo(
      app.packageUrl && app.entryUrl
        ? {
            appSlug: app.slug,
            packageName: app.packageName || `${app.slug}.zip`,
            packageUrl: app.packageUrl,
            entryUrl: app.entryUrl
          }
        : null
    );
    appForm.setFieldsValue({
      name: app.name,
      categoryId: typeof app.categoryId === 'string' ? app.categoryId : app.categoryId._id,
      accessLevel: app.accessLevel || 'member',
      summary: app.summary,
      description: app.description,
      cover: app.cover,
      media: sortAppMediaItems(app.media)
    });
    setAppModalOpen(true);
  };

  const uploadAppCover = async (file: File) => {
    setAppCoverUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const data = await request<AppCoverUploadResult>('/api/apps/upload-cover', {
        method: 'POST',
        data: formData,
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      appForm.setFieldValue('cover', data.coverUrl);
      setAppCoverFile(file);
      messageApi.success('封面已上传');
      return false;
    } finally {
      setAppCoverUploading(false);
    }
  };

  const uploadCatalogMediaRow = async (listName: number, slot: 'main' | 'poster', file: File) => {
    const rowType = appForm.getFieldValue(['media', listName, 'type']) as AppMediaKind | undefined;
    const fileType = slot === 'poster' ? 'poster' : rowType === 'video' ? 'video' : 'image';
    const extOk =
      slot === 'poster' || rowType !== 'video'
        ? /\.(png|jpg|jpeg|webp|gif)$/i.test(file.name)
        : /\.(mp4|webm|mov)$/i.test(file.name);
    if (!extOk) {
      messageApi.error(slot === 'poster' ? '封面仅支持 png/jpg/jpeg/webp/gif' : '请上传与类型匹配的图片或视频');
      return false;
    }

    if (file.size > CATALOG_MEDIA_UPLOAD_MAX_BYTES) {
      messageApi.error(fileType === 'video' ? '视频文件不能超过 20MB' : '文件大小不能超过 20MB');
      return false;
    }

    setCatalogMediaUploadKey(`${listName}-${slot}`);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('fileType', fileType);
      const data = await request<AppCatalogMediaUploadResult>('/api/apps/upload-media', {
        method: 'POST',
        data: formData
      });
      if (slot === 'poster') {
        appForm.setFieldValue(['media', listName, 'poster'], data.url);
        messageApi.success('封面上传成功');
      } else {
        appForm.setFieldValue(['media', listName, 'url'], data.url);
        messageApi.success('资源上传成功');
      }
    } catch {
      /* request 已弹错 */
    } finally {
      setCatalogMediaUploadKey(null);
    }
    return false;
  };

  const submitCategory = async () => {
    const values = await categoryForm.validateFields();
    setSaving(true);
    try {
      if (editingCategory) {
        await request(`/api/app-categories/${editingCategory._id}`, {
          method: 'PUT',
          data: values
        });
        messageApi.success('分类已更新');
      } else {
        await request('/api/app-categories', {
          method: 'POST',
          data: values
        });
        messageApi.success('分类已创建');
      }
      setCategoryModalOpen(false);
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  const submitApp = async () => {
    const values = await appForm.validateFields();
    if (!editingApp && !appPackageFile) {
      messageApi.error('请上传 zip 安装包');
      return;
    }

    setSaving(true);
    try {
      let packageInfo = appPackageInfo;

      if (appPackageFile) {
        const formData = new FormData();
        formData.append('file', appPackageFile);
        formData.append('appName', values.name);
        if (editingApp?._id) {
          formData.append('appId', editingApp._id);
        }
        packageInfo = await request<AppPackageUploadResult>('/api/apps/upload-package', {
          method: 'POST',
          data: formData,
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        });
        setAppPackageInfo(packageInfo);
      }

      const payload = {
        ...values,
        publisher: currentUser?.nickname || '',
        slug: packageInfo?.appSlug,
        packageName: packageInfo?.packageName,
        packageUrl: packageInfo?.packageUrl,
        entryUrl: packageInfo?.entryUrl
      };

      if (editingApp) {
        await request(`/api/apps/${editingApp._id}`, {
          method: 'PUT',
          data: payload
        });
        messageApi.success('应用已更新');
      } else {
        await request('/api/apps', {
          method: 'POST',
          data: payload
        });
        messageApi.success('应用已创建');
      }
      setAppModalOpen(false);
      setAppPackageFile(null);
      setAppPackageInfo(null);
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = async (id: string) => {
    await request(`/api/app-categories/${id}`, { method: 'DELETE' });
    if (activeCategoryId === id) {
      setActiveCategoryId('all');
    }
    messageApi.success('分类已删除');
    await loadData();
  };

  const deleteApp = async (id: string) => {
    await request(`/api/apps/${id}`, { method: 'DELETE' });
    messageApi.success('应用已删除');
    if (selectedApp?._id === id) {
      setSelectedApp(null);
    }
    await loadData();
  };

  const handleVisitApp = async (app: AppItem) => {
    if (!app.entryUrl) {
      messageApi.info('当前应用暂无访问入口');
      return;
    }

    if (!currentUser) {
      messageApi.info('访问应用需要先登录');
      await handleLoginEntry();
      return;
    }

    if (!isAdmin) {
      const access = await request<AppAccessPayload>(`/api/apps/${app._id}/access`);
      if (!access.allowed) {
        if (access.reason === 'member_required') {
          messageApi.info('该应用需要会员权限，请先开通会员');
          await openMemberCenter();
          return;
        }
        if (access.reason === 'explicit_required') {
          messageApi.info('该应用需要单独授权或兑换码');
          return;
        }
        messageApi.info('当前账号暂无访问权限');
        return;
      }
    }

    window.open(resolveAppAssetUrl(app.entryUrl), '_blank', 'noopener,noreferrer');
  };

  const handleOpenAppDetail = async (app: AppItem) => {
    if (!currentUser) {
      messageApi.info('查看应用需要先登录');
      await handleLoginEntry();
      return;
    }
    if (app.accessLevel === 'member' && !isAdmin && !memberInfo?.isMember) {
      messageApi.info('该应用需要会员权限，请先开通会员');
      await openMemberCenter();
      return;
    }
    setSelectedApp(app);
  };


  return (
    <>
      {contextHolder}
      <div className="catalog-layout">
            <aside className="catalog-sidebar">
              <div className="catalog-sidebar__header">
                {isAdmin ? (
                  <Button size="small" onClick={openCategoryManage}>
                    分类管理
                  </Button>
                ) : null}
              </div>

              <button
                type="button"
                className={`catalog-category ${activeCategoryId === 'all' ? 'is-active' : ''}`}
                onClick={() => setActiveCategoryId('all')}
              >
                全部应用
              </button>

              <div className="catalog-category-list">
                {categories.map((category) => (
                  <button
                    key={category._id}
                    type="button"
                    className={`catalog-category ${activeCategoryId === category._id ? 'is-active' : ''}`}
                    onClick={() => setActiveCategoryId(category._id)}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            </aside>

            <main className="catalog-main">
              <div className="catalog-main__header">
                {isAdmin && activeTopNav === 'apps' ? (
                  <Button type="primary" onClick={openAppCreate}>
                    新建应用
                  </Button>
                ) : null}
              </div>

              {activeTopNav === 'categories' ? (
                <div className="catalog-empty">
                  <Empty description="请通过左上角分类管理查看和维护分类" />
                </div>
              ) : (
                <Spin spinning={loading}>
                  {visibleApps.length ? (
                    <div className="catalog-app-list">
                      {visibleApps.map((app) => (
                        <div key={app._id} className="catalog-app-list__item">
                          <div
                            className="catalog-app-card"
                            role="button"
                            tabIndex={0}
                            onClick={() => void handleOpenAppDetail(app)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                void handleOpenAppDetail(app);
                              }
                            }}
                          >
                            <div className="catalog-app-card__cover">
                              {app.cover ? (
                                <img src={app.cover} alt={app.name} />
                              ) : (
                                <div className="catalog-app-card__cover-fallback">{app.name.slice(0, 1)}</div>
                              )}
                            </div>
                            <div className="catalog-app-card__body">
                              <div className="catalog-app-card__title">{app.name}</div>
                              {app.summary ? (
                                <div className="catalog-app-card__summary">{app.summary}</div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="catalog-empty">
                      <Empty description="当前分类下暂无应用" />
                    </div>
                  )}
                </Spin>
              )}
            </main>
      </div>

      <Modal
        title="分类管理"
        open={categoryManageOpen}
        onCancel={() => setCategoryManageOpen(false)}
        footer={
          isAdmin
            ? [
                <Button key="create" type="primary" onClick={openCategoryCreate}>
                  新增分类
                </Button>
              ]
            : null
        }
        width={760}
      >
        <Spin spinning={loading}>
          {categories.length ? (
            <div className="admin-card-list">
              {categories.map((category) => (
                <div key={category._id} className="admin-card">
                  <div>
                    <div className="admin-card__title">{category.name}</div>
                    <div className="admin-card__meta">
                      {category.slug} · {category.isActive ? '启用' : '停用'}
                    </div>
                    <div className="admin-card__desc">{category.description || '--'}</div>
                  </div>
                  {isAdmin ? (
                    <Space>
                      <Button size="small" onClick={() => openCategoryEdit(category)}>
                        编辑
                      </Button>
                      <Popconfirm
                        title="确认删除该分类？"
                        onConfirm={() => deleteCategory(category._id)}
                      >
                        <Button size="small" danger>
                          删除
                        </Button>
                      </Popconfirm>
                    </Space>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="catalog-empty">
              <Empty description="暂无分类" />
            </div>
          )}
        </Spin>
      </Modal>

      <Modal
        title={null}
        className="catalog-app-detail-modal"
        open={!!selectedApp}
        onCancel={() => setSelectedApp(null)}
        width={720}
        footer={
          selectedApp ? (
            <div className="catalog-app-detail-modal__footer-inner">
              <Button key="close" onClick={() => setSelectedApp(null)}>
                关闭
              </Button>
              <Space wrap className="catalog-app-detail-modal__footer-actions">
                {isAdmin ? (
                  <Popconfirm
                    key="delete"
                    title="确认删除该应用？"
                    onConfirm={async () => deleteApp(selectedApp._id)}
                  >
                    <Button danger>删除</Button>
                  </Popconfirm>
                ) : null}
                {isAdmin ? (
                  <Button key="edit" onClick={() => openAppEdit(selectedApp)}>
                    编辑
                  </Button>
                ) : null}
                {selectedApp.entryUrl ? (
                  <Button key="visit" type="primary" onClick={() => void handleVisitApp(selectedApp)}>
                    访问应用
                  </Button>
                ) : null}
              </Space>
            </div>
          ) : null
        }
      >
        {selectedApp ? (
          <div className="catalog-app-detail">
            <div className="catalog-app-detail__banner">
              {selectedApp.cover ? (
                <img src={selectedApp.cover} alt="" />
              ) : (
                <div className="catalog-app-detail__banner-fallback">{selectedApp.name.slice(0, 1)}</div>
              )}
              <div className="catalog-app-detail__banner-scrim" aria-hidden />
              <div className="catalog-app-detail__banner-text">
                <div className="catalog-app-detail__banner-eyebrow">
                  {categoryNameOf(selectedApp.categoryId) || '应用'}
                </div>
                <h2 className="catalog-app-detail__banner-title">{selectedApp.name}</h2>
              </div>
            </div>

            <div className="catalog-app-detail__sheet">
              {selectedApp.summary ? (
                <p className="catalog-app-detail__lead">{selectedApp.summary}</p>
              ) : null}

              {catalogDetailExtras.mediaSorted.length ? (
                <>
                  <div
                    className={`catalog-app-detail__media-carousel${
                      catalogMediaPages.length > 1
                        ? ' catalog-app-detail__media-carousel--has-pages'
                        : ''
                    }`}
                    style={
                      {
                        ['--carousel-page-count' as string]: catalogMediaPages.length
                      } as React.CSSProperties
                    }
                    onMouseEnter={() => setMediaCarouselPaused(true)}
                    onMouseLeave={() => setMediaCarouselPaused(false)}
                  >
                    <div className="catalog-app-detail__media-carousel__viewport">
                      <div
                        className="catalog-app-detail__media-carousel__track"
                        style={{
                          width: `${catalogMediaPages.length * 100}%`,
                          transform: `translateX(-${(100 / catalogMediaPages.length) * mediaCarouselPage}%)`
                        }}
                      >
                        {catalogMediaPages.map((group, pi) => (
                          <div
                            key={`media-page-${pi}`}
                            className="catalog-app-detail__media-carousel__slide"
                          >
                            {group.map((item, idx) => {
                              const globalIndex = pi * CATALOG_DETAIL_MEDIA_PER_PAGE + idx;
                              return item.type === 'video' ? (
                                <CatalogDetailMediaVideoTile
                                  key={`media-${globalIndex}-${item.url}`}
                                  item={item}
                                  onOpen={() => setMediaPreviewIndex(globalIndex)}
                                />
                              ) : (
                                <CatalogDetailMediaImageTile
                                  key={`media-${globalIndex}-${item.url}`}
                                  item={item}
                                  onOpen={() => setMediaPreviewIndex(globalIndex)}
                                />
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                    {catalogMediaPages.length > 1 ? (
                      <div
                        className="catalog-app-detail__media-carousel__dots"
                        role="tablist"
                        aria-label="图文分页"
                      >
                        {catalogMediaPages.map((_, pi) => (
                          <button
                            key={`media-dot-${pi}`}
                            type="button"
                            role="tab"
                            aria-selected={pi === mediaCarouselPage}
                            aria-label={`第 ${pi + 1} 组`}
                            className={`catalog-app-detail__media-carousel__dot ${
                              pi === mediaCarouselPage ? 'is-active' : ''
                            }`}
                            onClick={() => setMediaCarouselPage(pi)}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <CatalogDetailMediaPreviewModal
                    open={mediaPreviewIndex !== null}
                    items={catalogDetailExtras.mediaSorted}
                    activeIndex={mediaPreviewIndex ?? 0}
                    onClose={() => setMediaPreviewIndex(null)}
                    onChangeIndex={setMediaPreviewIndex}
                  />
                </>
              ) : null}

              {catalogDetailExtras.hasTextDetail ? (
                <div className="catalog-app-detail__article">
                  <h3 className="catalog-app-detail__article-title">详情</h3>
                  {selectedApp.description && selectedApp.description.trim() ? (
                    <div className="catalog-app-detail__prose">{selectedApp.description}</div>
                  ) : null}
                  {selectedApp.content && selectedApp.content.trim() ? (
                    <>
                      {selectedApp.description && selectedApp.description.trim() ? (
                        <h4 className="catalog-app-detail__article-subtitle">扩展说明</h4>
                      ) : null}
                      <div className="catalog-app-detail__prose">{selectedApp.content}</div>
                    </>
                  ) : null}
                </div>
              ) : !catalogDetailExtras.hasSummary && !catalogDetailExtras.mediaSorted.length ? (
                <p className="catalog-app-detail__empty">暂无详细说明</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        title="微信扫码登录"
        open={loginModalOpen}
        onCancel={() => {
          setLoginModalOpen(false);
          setLoginState(null);
          setLoginStatusText('请使用微信扫码登录');
        }}
        footer={[
          <Button
            key="refresh"
            type="primary"
            loading={loginLoading}
            onClick={handleLoginEntry}
          >
            刷新二维码
          </Button>
        ]}
        width={420}
      >
        <div className="catalog-login">
          {loginState?.qrUrl ? (
            <>
              <div className="catalog-login__qr">
                <img src={qrImageOf(loginState.qrUrl)} alt="微信扫码登录二维码" />
              </div>
              <div className="catalog-login__status">{loginStatusText}</div>
              <Typography.Text className="catalog-login__tip">
                微信扫码后在手机端确认，页面会自动完成登录
              </Typography.Text>
            </>
          ) : (
            <Spin spinning={loginLoading}>
              <div className="catalog-login__empty">正在生成登录二维码...</div>
            </Spin>
          )}
        </div>
      </Modal>

      <Modal
        title="会员中心"
        open={memberModalOpen}
        onCancel={() => {
          setMemberModalOpen(false);
          setMemberOrder(null);
          setMemberPayStatus('请选择会员套餐');
        }}
        footer={null}
        width={760}
      >
        <div className="member-panel">
          <div className="member-panel__hero">
            <div>
              <div className="member-panel__title">
                {memberInfo?.isMember ? '会员已开通' : '开通会员'}
              </div>
              <div className="member-panel__subtitle">
                {memberInfo?.isMember
                  ? `当前会员到期时间：${formatDateTime(memberInfo.expiredAt)}`
                  : '选择套餐后使用微信扫码支付，支付成功自动到账'}
              </div>
            </div>
            <div className={`member-panel__badge ${memberInfo?.isMember ? 'is-active' : ''}`}>
              {memberInfo?.isMember ? 'VIP' : '普通用户'}
            </div>
          </div>

          <div className="member-plan-list">
            {memberPlans.map((plan) => (
              <div key={plan.code} className="member-plan-card">
                <div className="member-plan-card__name">{plan.name}</div>
                <div className="member-plan-card__price">
                  <strong>¥{plan.price}</strong>
                  {plan.originalPrice ? <span>¥{plan.originalPrice}</span> : null}
                </div>
                <div className="member-plan-card__desc">
                  {plan.description || `${plan.durationDays} 天会员时长`}
                </div>
                <Button
                  type="primary"
                  htmlType="button"
                  block
                  loading={payingPlanCode === plan.code}
                  onClick={() => createMemberOrder(plan.code)}
                >
                  立即开通
                </Button>
              </div>
            ))}
          </div>

          <div className="member-pay-section">
            <div className="member-pay-section__header">
              <span>微信支付</span>
              <Typography.Text type="secondary">{memberPayStatus}</Typography.Text>
            </div>

            {memberPayStatus === '支付成功，会员已到账' ? (
              <div className="member-pay-success">
                <div className="member-pay-success__icon">✓</div>
                <div className="member-pay-success__title">开通成功</div>
                <div className="member-pay-success__desc">
                  会员权益已立即到账，现在可以返回继续访问会员应用。
                </div>
                <div className="member-pay-success__meta">
                  {memberInfo?.expiredAt
                    ? `当前会员有效期至 ${formatDateTime(memberInfo.expiredAt)}`
                    : '会员状态已同步更新'}
                </div>
              </div>
            ) : memberOrder ? (
              <div className="member-pay-section__body">
                <div className="member-pay-section__qr">
                  <img src={qrImageOf(memberOrder.codeUrl)} alt="会员充值二维码" />
                </div>
                <div className="member-pay-section__meta">
                  <div>订单号：{memberOrder.orderNo}</div>
                  <div>支付金额：¥{memberOrder.amount}</div>
                  <div>支付方式：微信扫码支付</div>
                </div>
              </div>
            ) : (
              <div className="member-pay-section__empty">选择套餐后，这里会显示支付二维码</div>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        title="个人中心"
        open={profileModalOpen}
        onCancel={() => setProfileModalOpen(false)}
        footer={
          currentUser
            ? [
                <Button key="refresh" onClick={refreshCurrentUser}>
                  刷新资料
                </Button>,
                <Button key="logout" danger onClick={handleLogout}>
                  退出登录
                </Button>
              ]
            : [
                <Button key="login" type="primary" onClick={handleLoginEntry}>
                  去登录
                </Button>
              ]
        }
      >
        <div className="catalog-profile">
          <div className="catalog-profile__card">
            <div className="catalog-profile__hero">
              <Avatar size={60} src={currentUser?.avatar} className="catalog-user-panel__avatar">
                {nameInitial(currentUser?.nickname)}
              </Avatar>
              <div>
                <div className="catalog-profile__name">{currentUser?.nickname || '游客访问'}</div>
                <div className="catalog-profile__status">
                  {currentUser?.wechatOpenId ? '微信账号已登录' : '当前未登录'}
                </div>
              </div>
            </div>
            <div className="catalog-profile__badge">
              {currentUser?.wechatOpenId ? '已登录' : '未登录'}
            </div>
          </div>

          <Divider />

          <div className="catalog-profile__member-entry">
            <div>
              <div className="catalog-profile__section-title">会员服务</div>
              <div className="catalog-profile__member-text">
                {memberInfo?.isMember
                  ? `会员有效期至 ${formatDateTime(memberInfo.expiredAt)}`
                  : '开通会员后可获得更完整的服务权益'}
              </div>
            </div>
            <Button type="primary" onClick={openMemberCenter}>
              {memberInfo?.isMember ? '会员中心' : '立即开通会员'}
            </Button>
          </div>

          <Divider />

          <div className="catalog-profile__summary">
            <div className="catalog-profile__summary-item">
              <span>账户类型</span>
              <strong>{currentUser?.wechatOpenId ? '微信用户' : '游客访问'}</strong>
            </div>
            <div className="catalog-profile__summary-item">
              <span>授权状态</span>
              <strong>{currentUser?.wechatOpenId ? '已授权登录' : '未授权'}</strong>
            </div>
          </div>

          <div className="catalog-profile__section-title">账户资料</div>
          <div className="catalog-profile__grid">
            <div className="catalog-profile__item">
              <span>用户昵称</span>
              <strong>{currentUser?.nickname || '未获取'}</strong>
            </div>
            <div className="catalog-profile__item">
              <span>头像来源</span>
              <strong>{currentUser?.avatar ? '微信头像' : '默认头像'}</strong>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        title={editingCategory ? '编辑分类' : '新建分类'}
        open={categoryModalOpen}
        onCancel={() => setCategoryModalOpen(false)}
        onOk={submitCategory}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={categoryForm} layout="vertical">
          <Form.Item label="分类名称" name="name" rules={[{ required: true, message: '请输入分类名称' }]}>
            <Input placeholder="例如：效率工具" />
          </Form.Item>
          <Form.Item label="分类标识" name="slug" rules={[{ required: true, message: '请输入 slug' }]}>
            <Input placeholder="efficiency-tools" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} placeholder="分类说明" />
          </Form.Item>
          <Form.Item label="图标地址" name="icon">
            <Input placeholder="https://example.com/icon.png" />
          </Form.Item>
          <Form.Item label="排序" name="sort">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="数值越小越靠前" />
          </Form.Item>
          <Form.Item label="启用" name="isActive" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingApp ? '编辑应用' : '新建应用'}
        open={appModalOpen}
        onCancel={() => {
          setAppModalOpen(false);
          setAppPackageFile(null);
          setAppPackageInfo(null);
          setAppCoverFile(null);
        }}
        onOk={submitApp}
        confirmLoading={saving}
        destroyOnClose
        width={760}
      >
        <Form form={appForm} layout="vertical">
          <div className="catalog-form-grid">
            <Form.Item label="应用名称" name="name" rules={[{ required: true, message: '请输入应用名称' }]}>
              <Input placeholder="请输入应用名称" />
            </Form.Item>
            <Form.Item label="分类" name="categoryId" rules={[{ required: true, message: '请选择分类' }]}>
              <Select
                placeholder="请选择所属分类"
                options={categories.map((item) => ({
                  label: item.name,
                  value: item._id
                }))}
              />
            </Form.Item>
          </div>

          <Form.Item label="访问级别" name="accessLevel" rules={[{ required: true, message: '请选择访问级别' }]}>
            <Select
              options={[
                { label: '登录可用', value: 'login' },
                { label: '会员', value: 'member' },
                { label: '单独授权', value: 'explicit' }
              ]}
            />
          </Form.Item>

          <Form.Item label="摘要" name="summary">
            <Input.TextArea rows={2} placeholder="请输入简短摘要，用于卡片展示" />
          </Form.Item>
          <Form.Item label="详细描述" name="description">
            <Input.TextArea rows={4} placeholder="请输入应用的详细描述" />
          </Form.Item>

          <Form.Item label="详情页图文/视频（展示在文字详情之上）">
            <Form.List name="media">
              {(fields, { add, remove }) => (
                <div className="catalog-app-media-form">
                  {fields.map((field) => {
                    const { key, name, ...restField } = field;
                    return (
                      <div key={key} className="catalog-app-media-form__block">
                        <div className="catalog-form-grid">
                          <Form.Item
                            {...restField}
                            label="类型"
                            name={[name, 'type']}
                            rules={[{ required: true, message: '请选择类型' }]}
                          >
                            <Select
                              options={[
                                { label: '图片', value: 'image' },
                                { label: '视频', value: 'video' }
                              ]}
                              onChange={() => {
                                appForm.setFieldValue(['media', name, 'url'], '');
                                appForm.setFieldValue(['media', name, 'poster'], '');
                              }}
                            />
                          </Form.Item>
                          <Form.Item
                            {...restField}
                            label="排序"
                            name={[name, 'sort']}
                            tooltip="数值越小越靠前；留空则按当前顺序"
                          >
                            <InputNumber min={0} style={{ width: '100%' }} placeholder="可选" />
                          </Form.Item>
                        </div>

                        <Form.Item
                          label="资源文件"
                          tooltip="请先选择类型。本地上传单文件不超过 20MB（含图片与视频）。"
                        >
                          <Form.Item noStyle dependencies={[['media', name, 'type']]}>
                            {({ getFieldValue }) => {
                              const rowType = getFieldValue(['media', name, 'type']);
                              const accept =
                                rowType === 'video' ? '.mp4,.webm,.mov' : '.png,.jpg,.jpeg,.webp,.gif';
                              const uploading = catalogMediaUploadKey === `${name}-main`;
                              return (
                                <Upload
                                  accept={accept}
                                  maxCount={1}
                                  showUploadList={false}
                                  beforeUpload={(file) => uploadCatalogMediaRow(name, 'main', file)}
                                >
                                  <Button loading={uploading}>上传{rowType === 'video' ? '视频' : '图片'}</Button>
                                </Upload>
                              );
                            }}
                          </Form.Item>
                        </Form.Item>
                        <Form.Item
                          {...restField}
                          name={[name, 'url']}
                          hidden
                          rules={[{ required: true, message: '请上传资源文件' }]}
                        >
                          <Input />
                        </Form.Item>
                        <Form.Item noStyle dependencies={[['media', name, 'url'], ['media', name, 'type']]}>
                          {({ getFieldValue }) => {
                            const urlVal = getFieldValue(['media', name, 'url']);
                            const rowType = getFieldValue(['media', name, 'type']);
                            if (!urlVal?.trim()) {
                              return null;
                            }
                            const resolved = resolveAppAssetUrl(urlVal);
                            return rowType === 'video' ? (
                              <div className="catalog-app-media-form__preview-wrap">
                                <video
                                  className="catalog-app-media-form__preview-video"
                                  src={resolved}
                                  controls
                                  playsInline
                                />
                              </div>
                            ) : (
                              <div className="catalog-app-media-form__preview-wrap">
                                <img className="catalog-app-media-form__preview-img" src={resolved} alt="" />
                              </div>
                            );
                          }}
                        </Form.Item>
                        <Form.Item noStyle dependencies={[['media', name, 'type']]}>
                          {({ getFieldValue }) =>
                            getFieldValue(['media', name, 'type']) === 'video' ? (
                              <>
                                <Form.Item label="视频封面（可选）" tooltip="用于视频未播放时的缩略图">
                                  <Upload
                                    accept=".png,.jpg,.jpeg,.webp,.gif"
                                    maxCount={1}
                                    showUploadList={false}
                                    beforeUpload={(file) => uploadCatalogMediaRow(name, 'poster', file)}
                                  >
                                    <Button
                                      loading={catalogMediaUploadKey === `${name}-poster`}
                                    >
                                      上传封面图
                                    </Button>
                                  </Upload>
                                </Form.Item>
                                <Form.Item {...restField} name={[name, 'poster']} hidden>
                                  <Input />
                                </Form.Item>
                                <Form.Item noStyle dependencies={[['media', name, 'poster']]}>
                                  {({ getFieldValue }) => {
                                    const posterVal = getFieldValue(['media', name, 'poster']);
                                    if (!posterVal?.trim()) {
                                      return null;
                                    }
                                    return (
                                      <div className="catalog-app-media-form__preview-wrap">
                                        <img
                                          className="catalog-app-media-form__preview-img"
                                          src={resolveAppAssetUrl(posterVal)}
                                          alt=""
                                        />
                                      </div>
                                    );
                                  }}
                                </Form.Item>
                              </>
                            ) : null
                          }
                        </Form.Item>
                        <Form.Item {...restField} label="配图说明（可选）" name={[name, 'caption']}>
                          <Input placeholder="简短说明文案" />
                        </Form.Item>
                        <Button type="link" danger onClick={() => remove(name)}>
                          移除该条
                        </Button>
                      </div>
                    );
                  })}
                  <Button
                    type="dashed"
                    block
                    onClick={() =>
                      add({ type: 'image', url: '', caption: '', sort: fields.length } as AppMediaItem)
                    }
                  >
                    添加图文/视频条目
                  </Button>
                </div>
              )}
            </Form.List>
          </Form.Item>

          <div className="catalog-form-grid catalog-form-grid--single">
            <Form.Item label="应用封面">
              <Upload
                accept=".png,.jpg,.jpeg,.webp"
                maxCount={1}
                beforeUpload={(file) => {
                  const isImage = /\.(png|jpg|jpeg|webp)$/i.test(file.name);
                  if (!isImage) {
                    messageApi.error('只能上传 png/jpg/jpeg/webp 图片');
                    return Upload.LIST_IGNORE;
                  }
                  void uploadAppCover(file);
                  return false;
                }}
                onRemove={() => {
                  setAppCoverFile(null);
                  appForm.setFieldValue('cover', '');
                }}
                fileList={
                  appCoverFile
                    ? [
                        {
                          uid: appCoverFile.uid,
                          name: appCoverFile.name,
                          status: appCoverUploading ? 'uploading' : 'done',
                          originFileObj: appCoverFile
                        } as UploadFile
                      ]
                    : []
                }
              >
                <Button loading={appCoverUploading}>上传封面图片</Button>
              </Upload>
            </Form.Item>
            <Form.Item noStyle shouldUpdate>
              {({ getFieldValue }) =>
                typeof getFieldValue('cover') === 'string' && getFieldValue('cover') ? (
                  <div style={{ marginTop: 8 }}>
                    <img
                      src={resolveAppAssetUrl(getFieldValue('cover'))}
                      alt="应用封面预览"
                      style={{ width: 180, borderRadius: 12, border: '1px solid #e5e7eb' }}
                    />
                  </div>
                ) : null
              }
            </Form.Item>
            <Form.Item hidden name="cover">
              <Input />
            </Form.Item>
          </div>
          <Form.Item
            label="zip 安装包"
            required={!editingApp}
            extra="上传后会统一解压到固定入口 web/index.html"
          >
            <Upload
              accept=".zip"
              maxCount={1}
              beforeUpload={(file) => {
                const isZip = file.name.toLowerCase().endsWith('.zip');
                if (!isZip) {
                  messageApi.error('只能上传 .zip 文件');
                  return Upload.LIST_IGNORE;
                }
                setAppPackageFile(file);
                setAppPackageInfo(null);
                return false;
              }}
              onRemove={() => {
                setAppPackageFile(null);
                if (!editingApp) {
                  setAppPackageInfo(null);
                }
              }}
              fileList={
                appPackageFile
                  ? [
                      {
                        uid: appPackageFile.uid,
                        name: appPackageFile.name,
                        status: 'done',
                        originFileObj: appPackageFile
                      } as UploadFile
                    ]
                  : []
              }
            >
              <Button>选择 zip 文件</Button>
            </Upload>
            {appPackageInfo ? (
              <div style={{ marginTop: 8 }}>
                <div>当前安装包：{appPackageInfo.packageName}</div>
              </div>
            ) : null}
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default HomePage;
