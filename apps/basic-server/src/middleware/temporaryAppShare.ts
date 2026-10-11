import fs from 'fs';
import path from 'path';
import type Koa from 'koa';
import {
  claimAppTemporaryLink,
  previewAppTemporaryLink,
  temporaryAppCookieName
} from '@/services/appTemporaryLinkService';

const SHARE_PREFIX = '/share/';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

const expiredPage = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>临时链接已失效</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: linear-gradient(145deg, #f8f5ef, #f3ede3); color: #262626; }
      main { width: min(100%, 460px); padding: 44px 32px; text-align: center; background: rgba(255, 255, 255, .94); border: 1px solid rgba(183, 154, 116, .2); border-radius: 20px; box-shadow: 0 18px 50px rgba(91, 67, 39, .12); }
      .icon { display: grid; place-items: center; width: 64px; height: 64px; margin: 0 auto 20px; border-radius: 50%; background: #f5eadc; color: #a77c48; font-size: 30px; }
      h2 { margin: 0 0 12px; font-size: 24px; }
      p { margin: 0; color: #737373; line-height: 1.7; }
      .actions { display: flex; justify-content: center; gap: 12px; margin-top: 28px; }
      a { min-width: 128px; padding: 11px 18px; border: 1px solid #b79a74; border-radius: 9px; color: #8d6b42; text-decoration: none; font-weight: 600; transition: .2s ease; }
      a:hover { background: #faf6f0; }
      a.primary { background: #b79a74; color: #fff; }
      a.primary:hover { background: #a58964; }
      @media (max-width: 420px) { main { padding: 36px 20px; } .actions { flex-direction: column; } a { width: 100%; } }
    </style>
  </head>
  <body>
    <main>
      <div class="icon" aria-hidden="true">⌛</div>
      <h2>临时链接已失效</h2>
      <p>该体验链接已过期或被停止使用。你可以浏览平台上的其他应用，或登录后查看自己已获得的应用。</p>
      <div class="actions">
        <a class="primary" href="/">浏览更多应用</a>
        <a href="/login">登录平台</a>
      </div>
    </main>
  </body>
</html>`;

const injectShareBase = (html: string, shareBase: string) => {
  const baseTag = `<base href="${shareBase}">`;
  return /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${baseTag}`)
    : `${baseTag}${html}`;
};

/**
 * 将 /share/:code/ 下的请求直接映射到对应应用目录。
 * 浏览器地址始终保持临时链接，不经过前端页面，也不发生二次跳转。
 */
export const temporaryAppShareMiddleware: Koa.Middleware = async (ctx, next) => {
  if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
    await next();
    return;
  }
  if (!ctx.path.startsWith(SHARE_PREFIX)) {
    await next();
    return;
  }

  const parts = ctx.path.slice(SHARE_PREFIX.length).split('/');
  const token = parts.shift() || '';
  if (!TOKEN_PATTERN.test(token)) {
    ctx.status = 404;
    ctx.type = 'text/html';
    ctx.body = expiredPage;
    return;
  }

  try {
    const requestedPath = decodeURIComponent(parts.join('/'));
    if (requestedPath.split('/').includes('..')) {
      ctx.status = 404;
      return;
    }

    const isEntryRequest = !requestedPath || requestedPath === 'index.html';
    const link = isEntryRequest && ctx.method === 'GET'
      ? await claimAppTemporaryLink(token)
      : await previewAppTemporaryLink(token);
    const remainingMs = Math.max(0, new Date(link.expiresAt).getTime() - Date.now());

    // 兼容应用包中仍使用 /static/apps/... 绝对路径的资源引用。
    ctx.cookies.set(temporaryAppCookieName(link.appId), token, {
      httpOnly: true,
      secure: ctx.secure,
      sameSite: 'lax',
      overwrite: true,
      path: '/static/apps/',
      maxAge: remainingMs
    });

    const uploadsRoot = path.resolve(process.cwd(), 'uploads');
    const entryRelativePath = link.entryUrl.replace(/^\/static\//, '');
    const entryFile = path.resolve(uploadsRoot, entryRelativePath);
    const appRoot = path.dirname(entryFile);
    let targetFile = isEntryRequest ? entryFile : path.resolve(appRoot, requestedPath);

    if (targetFile !== appRoot && !targetFile.startsWith(`${appRoot}${path.sep}`)) {
      ctx.status = 404;
      return;
    }
    if (fs.existsSync(targetFile) && fs.statSync(targetFile).isDirectory()) {
      targetFile = path.join(targetFile, 'index.html');
    }
    // 支持应用自身的前端路由刷新：无扩展名的路径回退到入口文件。
    if (!fs.existsSync(targetFile) && !path.extname(requestedPath)) {
      targetFile = entryFile;
    }
    if (!fs.existsSync(targetFile) || !fs.statSync(targetFile).isFile()) {
      ctx.status = 404;
      return;
    }

    ctx.set('Cache-Control', 'private, no-store');
    ctx.set('X-Robots-Tag', 'noindex, nofollow');
    ctx.type = path.extname(targetFile);
    if (ctx.method === 'HEAD') {
      ctx.status = 200;
      return;
    }
    if (targetFile === entryFile) {
      const html = fs.readFileSync(targetFile, 'utf8');
      ctx.type = 'text/html';
      ctx.body = injectShareBase(html, `${SHARE_PREFIX}${token}/`);
      return;
    }
    ctx.body = fs.createReadStream(targetFile);
  } catch (error) {
    ctx.status = 410;
    ctx.type = 'text/html';
    ctx.body = expiredPage;
  }
};
