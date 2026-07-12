import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import logger from 'koa-logger';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import fs from 'fs';
import serve from 'koa-static';
import { initRouter } from '@/routers';
import { fail, wechatFail } from '@/utils/tool';
import { requireUser } from '@/middleware/auth';
import AppItemModel from '@/models/AppItem';
import MemberAccountModel from '@/models/MemberAccount';
import UserAppEntitlementModel from '@/models/UserAppEntitlement';

dotenv.config();

const app = new Koa();
app.proxy = true;

const buildMongoUri = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const envUri = isProduction ? process.env.MONGO_URI_PROD : process.env.MONGO_URI_DEV;
  if (envUri) {
    return envUri;
  }
  const host = process.env.MONGO_HOST || '127.0.0.1';
  const port = process.env.MONGO_PORT || '27017';
  const db = process.env.MONGO_DB || 'test';
  const user = process.env.MONGO_USER || '';
  const password = process.env.MONGO_PASSWORD || '';
  const authSource = process.env.MONGO_AUTH_SOURCE || 'admin';

  if (user && password) {
    return `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(
      password
    )}@${host}:${port}/${db}?authSource=${encodeURIComponent(authSource)}`;
  }
  return `mongodb://${host}:${port}/${db}`;
};

mongoose
  .connect(buildMongoUri())
  .then(() => {
    console.log('MongoDB connected');
  })
  .catch((error) => {
    console.error('MongoDB connection failed:', error);
  });

const allowedOrigins = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:5174',
  'http://localhost:5174',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
  'https://app.chaobenxueyuan.com'
]);

app.use(
  cors({
    credentials: true,
    origin: (ctx) => {
      const requestOrigin = ctx.get('Origin');
      if (!requestOrigin) return '';
      if (allowedOrigins.has(requestOrigin)) return requestOrigin;
      return '';
    }
  })
);
app.use(logger());
app.use(async (ctx, next) => {
  if (ctx.path === '/api/pay/wechat/notify' && ctx.method.toUpperCase() === 'POST') {
    let rawBody = '';
    await new Promise<void>((resolve, reject) => {
      ctx.req.on('data', (chunk) => {
        rawBody += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      });
      ctx.req.on('end', () => resolve());
      ctx.req.on('error', reject);
    });

    ctx.state.rawBody = rawBody;
    try {
      ctx.request.body = rawBody ? JSON.parse(rawBody) : {};
    } catch (error) {
      ctx.body = wechatFail('Invalid notify payload');
      return;
    }
    await next();
    return;
  }

  return bodyParser()(ctx, next);
});

initRouter(app);

const staticPath = path.resolve(process.cwd(), 'uploads');
app.use(async (ctx, next) => {
  if (ctx.path.startsWith('/static/')) {
    if (ctx.path.startsWith('/static/apps/')) {
      try {
        const appSlug = ctx.path.replace('/static/apps/', '').split('/')[0];
        if (!appSlug) {
          ctx.status = 404;
          ctx.body = 'app not found';
          return;
        }
        const appItem = await AppItemModel.findOne({ slug: decodeURIComponent(appSlug) }).lean();
        if (!appItem) {
          ctx.status = 404;
          ctx.body = 'app not found';
          return;
        }

        /** 会员自助上架应用在库中有 ownerUserId；其静态站点对访客直接开放（不做登录/会员/授权校验） */
        const isMemberSelfListed = Boolean(appItem.ownerUserId);
        if (isMemberSelfListed) {
          const relativePath = ctx.path.replace('/static/', '');
          ctx.path = '/' + relativePath;
          return serve(staticPath)(ctx, next);
        }

        const user = await requireUser(ctx);
        if (user.role !== 'admin') {
          if (appItem.accessLevel === 'member') {
            const memberAccount = await MemberAccountModel.findOne({ userId: user._id }).lean();
            const isMember =
              Boolean(memberAccount?.isMember && memberAccount?.status === 'active') &&
              (!memberAccount?.expiredAt || memberAccount.expiredAt.getTime() > Date.now());
            if (!isMember) {
              const forbiddenTarget = `/forbidden/member?redirect=${encodeURIComponent(ctx.href)}`;
              ctx.redirect(forbiddenTarget);
              return;
            }
          }

          if (appItem.accessLevel === 'explicit') {
            const entitlement = await UserAppEntitlementModel.findOne({
              userId: user._id,
              appId: appItem._id,
              status: 'active',
              $or: [{ expiredAt: { $exists: false } }, { expiredAt: null }, { expiredAt: { $gt: new Date() } }]
            }).lean();
            if (!entitlement) {
              const forbiddenTarget = `/forbidden/app?redirect=${encodeURIComponent(ctx.href)}`;
              ctx.redirect(forbiddenTarget);
              return;
            }
          }

          if (appItem.accessLevel === 'owner') {
            if (appItem.ownerUserId?.toString() !== user._id.toString()) {
              const forbiddenTarget = `/forbidden/app?redirect=${encodeURIComponent(ctx.href)}`;
              ctx.redirect(forbiddenTarget);
              return;
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '未登录';
        if (
          message === '未登录' ||
          message === '登录已过期，请重新登录' ||
          message === '会话已在其他设备登录，请重新登录'
        ) {
          const loginTarget = `/login?redirect=${encodeURIComponent(ctx.href)}&reason=${encodeURIComponent(message)}`;
          ctx.redirect(loginTarget);
          return;
        }
        ctx.status = 401;
        ctx.body = message;
        return;
      }
    }

    const relativePath = ctx.path.replace('/static/', '');
    ctx.path = '/' + relativePath;
    return serve(staticPath)(ctx, next);
  }
  await next();
});

const clientDist =
  process.env.CLIENT_DIST || path.join(__dirname, '../../base-client/dist');
app.use(serve(clientDist));

app.use(async (ctx, next) => {
  if (ctx.path.startsWith('/api/')) {
    ctx.body = fail('API not found');
    return;
  }

  if (path.extname(ctx.path) !== '') {
    await next();
    return;
  }

  const indexPath = path.join(clientDist, 'index.html');
  if (fs.existsSync(indexPath)) {
    ctx.type = 'text/html';
    ctx.body = fs.readFileSync(indexPath, 'utf8');
    return;
  }

  ctx.body = 'Frontend build not found. Please run build in base-client.';
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`basic-server listening on ${port}`);
});
