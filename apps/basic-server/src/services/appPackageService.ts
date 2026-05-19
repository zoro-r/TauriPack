import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import multer from '@koa/multer';
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
}

export const uploadAppPackage = async ({
  file,
  appName,
  appId
}: UploadAppPackageInput) => {
  if (!file) {
    throw new Error('zip file is required');
  }
  if (!appName?.trim()) {
    throw new Error('appName is required');
  }
  if (path.extname(file.originalname).toLowerCase() !== '.zip') {
    throw new Error('only .zip files are supported');
  }

  const appSlug = await resolveAppSlug(appName, appId);
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
      entryUrl
    };
  } catch (error) {
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    throw error;
  }
};
