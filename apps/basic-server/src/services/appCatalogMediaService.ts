import fs from 'fs';
import path from 'path';
import multer from '@koa/multer';

const mediaUploadRoot = path.join(process.cwd(), 'uploads', 'app-media');

const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

ensureDir(mediaUploadRoot);

/** 应用详情媒体单文件大小上限（与 multer `limits.fileSize` 一致；满足视频 ≤20MB） */
export const CATALOG_MEDIA_VIDEO_MAX_BYTES = 20 * 1024 * 1024;

export const appCatalogMediaUpload = multer({
  dest: mediaUploadRoot,
  limits: { fileSize: CATALOG_MEDIA_VIDEO_MAX_BYTES }
});

export interface UploadedCatalogMediaFile {
  path: string;
  originalname: string;
  mimetype?: string;
}

/** 与 multipart 字段 fileType 对应：正式资源区分图/视频；poster 仅图片 */
export type CatalogMediaUploadKind = 'image' | 'video' | 'poster';

const sanitizeFilename = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov']);

export const uploadAppCatalogMedia = async (
  file: UploadedCatalogMediaFile | undefined,
  kind: CatalogMediaUploadKind
) => {
  if (!file) {
    throw new Error('file is required');
  }

  const ext = path.extname(file.originalname).toLowerCase();
  if (kind === 'poster' || kind === 'image') {
    if (!IMAGE_EXT.has(ext)) {
      throw new Error('仅支持 png、jpg、jpeg、webp、gif 图片');
    }
  } else if (kind === 'video') {
    if (!VIDEO_EXT.has(ext)) {
      throw new Error('仅支持 mp4、webm、mov 视频');
    }
  }

  const finalName = `${Date.now()}-${sanitizeFilename(path.basename(file.originalname, ext))}${ext}`;
  const finalPath = path.join(mediaUploadRoot, finalName);
  fs.renameSync(file.path, finalPath);

  return {
    url: `/static/app-media/${finalName}`
  };
};

export const normalizeCatalogMediaKind = (value: unknown): CatalogMediaUploadKind => {
  if (value === 'video') return 'video';
  if (value === 'poster') return 'poster';
  return 'image';
};
