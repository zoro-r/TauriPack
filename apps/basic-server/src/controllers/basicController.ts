import type Router from '@koa/router';
import { cleanupTempFile, convertIconFile } from '@/services/iconService';
import { error as errorResponse, fail, success } from '@/utils/tool';

export const getRoot = (ctx: Router.RouterContext) => {
  ctx.body = success({
    message: 'basic-server up',
    env: process.env.NODE_ENV || 'development'
  });
};

export const getHealth = (ctx: Router.RouterContext) => {
  ctx.body = success({ status: 'ok' });
};

export const convertIcon = async (ctx: Router.RouterContext) => {
  const file = ctx.file;
  if (!file) {
    ctx.body = fail('file is required');
    return;
  }

  const body = ctx.request.body as { name?: string } | undefined;
  try {
    const { icoPath, icnsPath } = await convertIconFile(
      file.path,
      file.originalname,
      body?.name
    );
    ctx.body = success({ icoPath, icnsPath });
  } catch (err) {
    ctx.body = errorResponse('convert failed', err);
  } finally {
    cleanupTempFile(file.path);
  }
};
