import fs from 'fs';
import path from 'path';
import multer from '@koa/multer';

const coverUploadRoot = path.join(process.cwd(), 'uploads', 'covers');

const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

ensureDir(coverUploadRoot);

export const appCoverUpload = multer({ dest: coverUploadRoot });

export interface UploadedCoverFile {
  path: string;
  originalname: string;
  mimetype?: string;
}

const sanitizeFilename = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

export const uploadAppCover = async (file?: UploadedCoverFile) => {
  if (!file) {
    throw new Error('cover file is required');
  }
  const ext = path.extname(file.originalname).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    throw new Error('only png/jpg/jpeg/webp files are supported');
  }

  const finalName = `${Date.now()}-${sanitizeFilename(path.basename(file.originalname, ext))}${ext}`;
  const finalPath = path.join(coverUploadRoot, finalName);
  fs.renameSync(file.path, finalPath);

  return {
    coverUrl: `/static/covers/${finalName}`
  };
};
