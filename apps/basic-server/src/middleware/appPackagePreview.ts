import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import serve from 'koa-static';
import type Koa from 'koa';

/** 独立的短期预览凭证只开放 web 目录，不绕过应用本身的访问权限。 */
export const appPackagePreviewMiddleware: Koa.Middleware = async (ctx, next) => {
  if (!ctx.path.startsWith('/app-previews/')) return next();
  ctx.set('Cache-Control', 'private, no-store');
  ctx.set('Referrer-Policy', 'no-referrer');
  ctx.set('X-Robots-Tag', 'noindex, nofollow');
  ctx.status = 404;
  ctx.body = 'preview not found or expired';
  if (ctx.method !== 'GET' && ctx.method !== 'HEAD') return;
  const match = /^\/app-previews\/([^/]+)\/([a-f0-9]{64})\/(.*)$/.exec(ctx.path);
  if (!match) return;
  try {
    const slug = decodeURIComponent(match[1]);
    if (!/^[a-z0-9\u4e00-\u9fa5-]+$/.test(slug)) return;
    const appDir = path.resolve(process.cwd(), 'uploads', 'apps', slug);
    const metadata = JSON.parse(fs.readFileSync(path.join(appDir, '.preview.json'), 'utf8'));
    const tokenHash = crypto.createHash('sha256').update(match[2]).digest('hex');
    if (metadata.tokenHash !== tokenHash || !Number.isFinite(Date.parse(metadata.expiresAt)) ||
        Date.parse(metadata.expiresAt) <= Date.now()) return;
    const requested = decodeURIComponent(match[3]);
    if (requested.split(/[\\/]/).some(segment => segment === '..' || segment.startsWith('.'))) return;
    ctx.body = null;
    ctx.status = 200;
    ctx.path = '/' + match[3];
    await serve(path.join(appDir, 'web'))(ctx, async () => {
      ctx.status = 404;
      ctx.body = 'preview file not found';
    });
  } catch {
    ctx.status = 404;
    ctx.body = 'preview not found or expired';
  }
};
