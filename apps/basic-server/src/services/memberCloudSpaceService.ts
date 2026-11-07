import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import MemberCloudSpaceModel, { type CloudPackage } from '@/models/MemberCloudSpace';
import { getAppHostingOrigin, uploadAppPackage, type UploadAppPackageInput } from '@/services/appPackageService';

export const APP_HOSTING_SIZE_LIMIT = 50 * 1024 * 1024;
const UPLOAD_RESERVATION_MS = 10 * 60 * 1000;

const packageDir = (slug: string) => {
  // 只操作本服务生成的目录，绝不把请求参数当文件路径使用。
  if (!/^preview-[a-f0-9]{32}$/.test(slug)) throw new Error('无效的云空间包标识');
  return path.join(process.cwd(), 'uploads', 'apps', slug);
};
const removeFiles = (slug: string, temporaryFileName?: string) => {
  fs.rmSync(packageDir(slug), { recursive: true, force: true });
  const temporaryRoot = path.join(process.cwd(), 'uploads', '.tmp', 'apps');
  if (!fs.existsSync(temporaryRoot)) return;
  if (temporaryFileName && /^[a-f0-9]{32}$/.test(temporaryFileName)) {
    fs.rmSync(path.join(temporaryRoot, temporaryFileName), { force: true });
  }
  for (const entry of fs.readdirSync(temporaryRoot)) {
    if (entry.startsWith(slug + '-') && /^\d+$/.test(entry.slice(slug.length + 1))) {
      fs.rmSync(path.join(temporaryRoot, entry), { recursive: true, force: true });
    }
  }
};
const readPackages = async (userId: string): Promise<CloudPackage[]> => {
  const account = await MemberCloudSpaceModel.findById(userId).lean();
  return account?.packages || [];
};
const activePackages = (packages: CloudPackage[], now = new Date()) =>
  packages.filter(item => item.previewExpiresAt > now);
const quotaFor = (packages: CloudPackage[]) => ({
  usedBytes: activePackages(packages).reduce((sum, item) => sum + item.packageSize, 0),
  limitBytes: APP_HOSTING_SIZE_LIMIT
});

export const cleanupMemberCloudSpace = async (userId: string) => {
  const now = new Date();
  const expired = (await readPackages(userId)).filter(item => item.previewExpiresAt <= now);
  for (const item of expired) {
    // 先删文件，失败时保留记录供下一轮重试；不处理任何历史未知目录。
    removeFiles(item.appSlug, item.temporaryFileName);
    await MemberCloudSpaceModel.updateOne({ _id: userId }, {
      $pull: { packages: { appSlug: item.appSlug, previewExpiresAt: { $lte: now } } }
    });
  }
};

export const getMemberCloudQuota = async (userId: string) => {
  await cleanupMemberCloudSpace(userId);
  return quotaFor(await readPackages(userId));
};

export const listMemberCloudPackages = async (userId: string, query: { page?: unknown; pageSize?: unknown } = {}) => {
  await cleanupMemberCloudSpace(userId);
  const packages = await readPackages(userId);
  const all = activePackages(packages).filter(item => item.status === 'ready')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.appSlug.localeCompare(b.appSlug));
  const paged = query.page !== undefined || query.pageSize !== undefined;
  const parse = (value: unknown, fallback: number) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new Error('page 和 pageSize 必须为正整数');
    }
    return Number(value);
  };
  const page = parse(query.page, 1);
  const pageSize = paged ? Math.min(parse(query.pageSize, 100), 500) : all.length;
  const list = (paged ? all.slice((page - 1) * pageSize, page * pageSize) : all).map(item => ({
    appSlug: item.appSlug, slug: item.appSlug, appName: item.appName,
    packageSize: item.packageSize, createdAt: item.createdAt.toISOString(),
    previewExpiresAt: item.previewExpiresAt.toISOString(), previewUrl: item.previewUrl
  }));
  return { list, total: all.length, page, pageSize, ...quotaFor(packages) };
};

export const deleteMemberCloudPackage = async (userId: string, slug: string) => {
  packageDir(slug);
  const item = (await readPackages(userId)).find(item => item.appSlug === slug && item.status === 'ready');
  if (!item) throw new Error('云空间包不存在或无权操作');
  removeFiles(item.appSlug, item.temporaryFileName);
  await MemberCloudSpaceModel.updateOne({ _id: userId }, { $pull: { packages: { appSlug: slug } } });
  return { appSlug: slug };
};

export const uploadMemberCloudPackage = async (userId: string, input: UploadAppPackageInput) => {
  const hostingOrigin = getAppHostingOrigin();
  if (!input.file) throw new Error('zip file is required');
  const slug = `preview-${crypto.randomBytes(16).toString('hex')}`;
  let reserved = false;
  try {
    const size = fs.statSync(input.file.path).size;
    if (size > APP_HOSTING_SIZE_LIMIT) throw new Error('会员云空间上限为 50MB，当前 ZIP 包过大');
    await cleanupMemberCloudSpace(userId);
    // upsert 只负责初始化。并发初始化可能触发唯一键冲突，随后继续原子预占。
    try {
      await MemberCloudSpaceModel.updateOne({ _id: userId }, { $setOnInsert: { packages: [] } }, { upsert: true });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
    }
    const now = new Date();
    const reservationExpiresAt = new Date(now.getTime() + UPLOAD_RESERVATION_MS);
    const result = await MemberCloudSpaceModel.updateOne({ _id: userId, $expr: {
      $lte: [{ $add: [size, { $sum: { $map: {
        input: { $filter: { input: '$packages', as: 'package', cond: { $gt: ['$$package.previewExpiresAt', '$$NOW'] } } },
        as: 'package', in: '$$package.packageSize'
      } } }] }, APP_HOSTING_SIZE_LIMIT]
    } }, { $push: { packages: {
      appSlug: slug, appName: input.appName, packageSize: size, status: 'uploading',
      temporaryFileName: path.basename(input.file.path),
      createdAt: now, previewExpiresAt: reservationExpiresAt
    } } });
    if (!result.modifiedCount) throw new Error('会员云空间容量不足，上限为 50MB，请删除部分课件后重试');
    reserved = true;
    const uploaded = await uploadAppPackage({ ...input, createPreview: true, storageSlug: slug });
    const previewUrl = new URL(uploaded.previewPath!, hostingOrigin).toString();
    const committed = await MemberCloudSpaceModel.updateOne({ _id: userId,
      $expr: { $lt: ['$$NOW', reservationExpiresAt] }, packages: { $elemMatch: {
      appSlug: slug, status: 'uploading', previewExpiresAt: { $gt: new Date() }
    } } }, { $set: {
      'packages.$.status': 'ready', 'packages.$.previewUrl': previewUrl,
      'packages.$.previewExpiresAt': new Date(uploaded.previewExpiresAt!)
    }, $unset: { 'packages.$.temporaryFileName': 1 } });
    if (!committed.modifiedCount) throw new Error('上传预占已过期，请重新上传');
    const { previewPath, ...info } = uploaded;
    return { ...info, appName: input.appName.trim(), packageSize: size, createdAt: now.toISOString(), previewUrl };
  } catch (err) {
    if (reserved) {
      removeFiles(slug);
      await MemberCloudSpaceModel.updateOne({ _id: userId }, { $pull: { packages: { appSlug: slug } } });
    }
    throw err;
  } finally {
    fs.rmSync(input.file.path, { force: true });
  }
};

export const startMemberCloudCleanup = () => {
  const sweep = async () => {
    try {
      const accounts = await MemberCloudSpaceModel.find({ 'packages.previewExpiresAt': { $lte: new Date() } }).select('_id').lean();
      for (const account of accounts) await cleanupMemberCloudSpace(String(account._id));
    } catch (err) {
      console.error('清理会员云空间过期包失败', err);
    }
  };
  void sweep();
  const timer = setInterval(() => { void sweep(); }, 60 * 60 * 1000);
  timer.unref();
};
