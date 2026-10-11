import crypto from 'crypto';
import mongoose from 'mongoose';
import AppItemModel from '@/models/AppItem';
import AppTemporaryLinkModel from '@/models/AppTemporaryLink';

const MIN_DURATION_MS = 5 * 60 * 1000;
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ACTIVE_LINKS_PER_APP = 20;

export const temporaryAppCookieName = (appId: string) => `app_temp_${appId}`;

export const hashTemporaryAppToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

const ensureObjectId = (value: string, label: string) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new Error(`${label} is invalid`);
  }
};

const assertLocalHostedApp = (entryUrl?: string) => {
  if (!entryUrl?.startsWith('/static/apps/')) {
    throw new Error('临时链接仅支持平台本地托管的应用');
  }
};

const getOwnedApp = async (appId: string, userId: string, role: 'admin' | 'user') => {
  ensureObjectId(appId, 'appId');
  const app = await AppItemModel.findById(appId).lean();
  if (!app) {
    throw new Error('app not found');
  }
  if (role !== 'admin' && app.ownerUserId?.toString() !== userId) {
    throw new Error('无权管理该应用的临时链接');
  }
  assertLocalHostedApp(app.entryUrl);
  return app;
};

const sanitizeLink = (link: any) => ({
  _id: link._id.toString(),
  appId: link.appId.toString(),
  ownerUserId: link.ownerUserId.toString(),
  expiresAt: link.expiresAt,
  status: link.status,
  remark: link.remark,
  visitCount: link.visitCount,
  lastVisitedAt: link.lastVisitedAt,
  revokedAt: link.revokedAt,
  createdAt: link.createdAt,
  updatedAt: link.updatedAt
});

export const createAppTemporaryLink = async (input: {
  appId: string;
  userId: string;
  role: 'admin' | 'user';
  expiresAt: string;
  remark?: string;
}) => {
  const app = await getOwnedApp(input.appId, input.userId, input.role);
  const expiresAt = new Date(input.expiresAt);
  const durationMs = expiresAt.getTime() - Date.now();
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new Error('失效时间无效');
  }
  if (durationMs < MIN_DURATION_MS) {
    throw new Error('临时链接有效期不能少于 5 分钟');
  }
  if (durationMs > MAX_DURATION_MS) {
    throw new Error('临时链接有效期不能超过 30 天');
  }

  const activeCount = await AppTemporaryLinkModel.countDocuments({
    appId: app._id,
    status: 'active',
    expiresAt: { $gt: new Date() }
  });
  if (activeCount >= MAX_ACTIVE_LINKS_PER_APP) {
    throw new Error(`单个应用最多保留 ${MAX_ACTIVE_LINKS_PER_APP} 条有效临时链接`);
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const link = await AppTemporaryLinkModel.create({
    appId: app._id,
    ownerUserId: input.userId,
    tokenHash: hashTemporaryAppToken(token),
    expiresAt,
    status: 'active',
    remark: input.remark?.trim()
  });

  return {
    ...sanitizeLink(link),
    // 临时凭证放在独立路径中，由服务端直接映射应用文件；URL 不再携带查询参数或 Fragment。
    sharePath: `/share/${token}/`
  };
};

export const listAppTemporaryLinks = async (input: {
  appId: string;
  userId: string;
  role: 'admin' | 'user';
}) => {
  const app = await getOwnedApp(input.appId, input.userId, input.role);
  const links = await AppTemporaryLinkModel.find({ appId: app._id }).sort({ createdAt: -1 }).lean();
  return links.map(sanitizeLink);
};

export const revokeAppTemporaryLink = async (input: {
  appId: string;
  linkId: string;
  userId: string;
  role: 'admin' | 'user';
}) => {
  await getOwnedApp(input.appId, input.userId, input.role);
  ensureObjectId(input.linkId, 'linkId');
  const link = await AppTemporaryLinkModel.findOne({ _id: input.linkId, appId: input.appId });
  if (!link) {
    throw new Error('临时链接不存在');
  }
  link.status = 'revoked';
  link.revokedAt = new Date();
  await link.save();
  return sanitizeLink(link);
};

export const previewAppTemporaryLink = async (token: string) => {
  if (!token || token.length > 256) {
    throw new Error('临时链接无效');
  }
  const link = await AppTemporaryLinkModel.findOne({
    tokenHash: hashTemporaryAppToken(token),
    status: 'active',
    expiresAt: { $gt: new Date() }
  }).lean();
  if (!link) {
    throw new Error('临时链接已失效');
  }
  const app = await AppItemModel.findById(link.appId).lean();
  if (!app) {
    throw new Error('应用不存在');
  }
  assertLocalHostedApp(app.entryUrl);
  return {
    linkId: link._id.toString(),
    appId: app._id.toString(),
    appName: app.name,
    summary: app.summary,
    cover: app.cover,
    expiresAt: link.expiresAt,
    entryUrl: app.entryUrl!
  };
};

export const claimAppTemporaryLink = async (token: string) => {
  const preview = await previewAppTemporaryLink(token);
  const claimed = await AppTemporaryLinkModel.updateOne(
    {
      _id: preview.linkId,
      status: 'active',
      expiresAt: { $gt: new Date() }
    },
    { $inc: { visitCount: 1 }, $set: { lastVisitedAt: new Date() } }
  );
  if (claimed.modifiedCount !== 1) {
    throw new Error('临时链接已失效');
  }
  return preview;
};

export const hasValidTemporaryAppAccess = async (appId: string, token?: string) => {
  if (!token || token.length > 256) {
    return false;
  }
  return Boolean(
    await AppTemporaryLinkModel.exists({
      appId,
      tokenHash: hashTemporaryAppToken(token),
      status: 'active',
      expiresAt: { $gt: new Date() }
    })
  );
};
