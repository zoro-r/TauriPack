import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import multer from '@koa/multer';
import crypto from 'crypto';
import { resolveAppSlug } from '@/services/appCatalogService';

const appUploadRoot = path.join(process.cwd(), 'uploads', 'apps');
const tempUploadRoot = path.join(process.cwd(), 'uploads', '.tmp', 'apps');

const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

ensureDir(appUploadRoot);
ensureDir(tempUploadRoot);

export const appPackageUpload = multer({ dest: tempUploadRoot });

/** 公网地址只由服务端配置决定，不信任调用方的 Origin/Host。 */
export const getAppHostingOrigin = () => {
  const url = new URL(process.env.APP_HOSTING_ORIGIN || 'https://app.chaobenxueyuan.com');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('APP_HOSTING_ORIGIN must be an HTTP(S) origin');
  }
  return url.origin;
};

const sanitizeZipEntries = (zipPath: string) => {
  const stdout = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  const entries = stdout
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

  if (!entries.length) {
    throw new Error('zip package is empty');
  }

  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    if (normalized.startsWith('/') || segments.includes('..')) {
      throw new Error('zip package contains unsafe paths');
    }
  }
};

const walkFiles = (dir: string, baseDir: string, result: string[] = []) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '__MACOSX' || entry.name === '.DS_Store') {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      walkFiles(fullPath, baseDir, result);
      continue;
    }
    if (entry.isFile()) {
      result.push(path.relative(baseDir, fullPath));
    }
  }
  return result;
};

const detectEntryParent = (extractDir: string) => {
  const files = walkFiles(extractDir, extractDir);
  const indexCandidates = files
    .filter((file) => path.basename(file).toLowerCase() === 'index.html')
    .sort((a, b) => {
      const depthDiff = a.split(path.sep).length - b.split(path.sep).length;
      return depthDiff !== 0 ? depthDiff : a.localeCompare(b);
    });

  if (!indexCandidates.length) {
    throw new Error('zip package must contain index.html');
  }

  return path.join(extractDir, path.dirname(indexCandidates[0]));
};

const copyDir = (fromDir: string, toDir: string) => {
  ensureDir(toDir);
  const entries = fs.readdirSync(fromDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '__MACOSX' || entry.name === '.DS_Store') {
      continue;
    }
    const fromPath = path.join(fromDir, entry.name);
    const toPath = path.join(toDir, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      copyDir(fromPath, toPath);
      continue;
    }
    fs.copyFileSync(fromPath, toPath);
  }
};

export interface UploadedPackageFile {
  path: string;
  originalname: string;
}

export interface UploadAppPackageInput {
  file: UploadedPackageFile;
  appName: string;
  appId?: string;
  createPreview?: boolean;
  expireDays?: unknown;
}

const parsePreviewExpireDays = (value: unknown) => {
  if (value === undefined) return 1;
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      !/^\d+$/.test(String(value).trim())) {
    throw new Error('expireDays 必须为 1 到 365 的整数天数');
  }
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 1 || days > 365) {
    throw new Error('expireDays 必须为 1 到 365 的整数天数');
  }
  return days;
};

export const uploadAppPackage = async ({
  file,
  appName,
  appId,
  createPreview = false,
  expireDays
}: UploadAppPackageInput) => {
  const previewDays = parsePreviewExpireDays(expireDays);
  if (!file) {
    throw new Error('zip file is required');
  }
  if (!appName?.trim()) {
    throw new Error('appName is required');
  }
  if (path.extname(file.originalname).toLowerCase() !== '.zip') {
    throw new Error('only .zip files are supported');
  }

  const resolvedSlug = await resolveAppSlug(appName, appId);
  // 未上架的 API 上传也必须有独立目录，避免同名上传覆盖其他用户的包。
  const appSlug = createPreview && !appId ? `${resolvedSlug}-${crypto.randomBytes(8).toString('hex')}` : resolvedSlug;
  const stagingDir = path.join(tempUploadRoot, `${appSlug}-${Date.now()}`);
  const extractDir = path.join(stagingDir, 'extract');
  const packagePath = path.join(stagingDir, 'package.zip');
  const appDir = path.join(appUploadRoot, appSlug);
  const webDir = path.join(stagingDir, 'web');

  ensureDir(stagingDir);
  fs.renameSync(file.path, packagePath);

  try {
    sanitizeZipEntries(packagePath);
    ensureDir(extractDir);
    execFileSync('unzip', ['-q', packagePath, '-d', extractDir]);

    const entryParent = detectEntryParent(extractDir);
    copyDir(entryParent, webDir);

    const entryFilePath = path.join(webDir, 'index.html');
    if (!fs.existsSync(entryFilePath)) {
      throw new Error('index.html not found after package normalization');
    }

    const previewToken = createPreview ? crypto.randomBytes(32).toString('hex') : undefined;
    const previewExpiresAt = createPreview ? new Date(Date.now() + previewDays * 24 * 60 * 60 * 1000).toISOString() : undefined;
    if (previewToken) {
      fs.writeFileSync(path.join(stagingDir, '.preview.json'), JSON.stringify({
        tokenHash: crypto.createHash('sha256').update(previewToken).digest('hex'),
        expiresAt: previewExpiresAt
      }));
    }

    if (fs.existsSync(appDir)) {
      fs.rmSync(appDir, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(appDir), { recursive: true });
    fs.renameSync(stagingDir, appDir);

    const packageUrl = `/static/apps/${appSlug}/package.zip`;
    const entryUrl = `/static/apps/${appSlug}/web/index.html`;

    return {
      appSlug,
      packageName: file.originalname,
      packageUrl,
      entryUrl,
      ...(previewToken ? { previewPath: `/app-previews/${encodeURIComponent(appSlug)}/${previewToken}/`, previewExpiresAt } : {})
    };
  } catch (error) {
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    throw error;
  }
};
