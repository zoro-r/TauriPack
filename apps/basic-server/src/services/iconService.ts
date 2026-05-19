import fs from 'fs';
import path from 'path';
import multer from '@koa/multer';
import { convertPngToIcons } from '@/utils/icon';

const uploadRoot = path.join(process.cwd(), 'uploads', 'icons');

const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

ensureDir(uploadRoot);

export const iconUpload = multer({ dest: uploadRoot });

export const convertIconFile = async (
  filePath: string,
  originalName: string,
  name?: string
) => {
  const outputDir = path.join(uploadRoot, Date.now().toString());
  const baseName = name || path.parse(originalName).name;
  const { icoPath, icnsPath } = await convertPngToIcons(filePath, outputDir, baseName);
  return { icoPath, icnsPath };
};

export const cleanupTempFile = (filePath: string) => {
  fs.unlink(filePath, () => undefined);
};
