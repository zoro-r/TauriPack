import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import type Router from '@koa/router';
import DocumentApiKeyModel from '@/models/DocumentApiKey';
import DocumentCreditBalanceModel from '@/models/DocumentCreditBalance';
import DocumentCreditLedgerModel from '@/models/DocumentCreditLedger';
import DocumentParseJobModel, { type DocumentParseJobDocument } from '@/models/DocumentParseJob';
import BillingTransactionModel from '@/models/BillingTransaction';
import { chargeNewApiQuota } from '@/services/newApiService';

const MINERU_BASE_URL = 'https://mineru.net';
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MAX_PAGES = 200;
const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.jp2', '.webp', '.gif', '.bmp',
  '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'
]);

const logDocument = (event: string, payload: Record<string, unknown> = {}) => {
  console.info(`[document-service][${event}]`, payload);
};

const logDocumentError = (event: string, error: unknown, payload: Record<string, unknown> = {}) => {
  console.error(`[document-service][${event}]`, {
    ...payload,
    message: error instanceof Error ? error.message : String(error)
  });
};

export const documentUpload = (() => {
  const multer = require('@koa/multer') as typeof import('@koa/multer');
  const uploadDir = path.join(process.cwd(), 'uploads', '.tmp', 'documents');
  fs.mkdirSync(uploadDir, { recursive: true });
  return multer({ dest: uploadDir, limits: { fileSize: MAX_FILE_BYTES } });
})();

export interface UploadedDocumentFile {
  path: string;
  originalname: string;
  size: number;
}

const getRequiredEnv = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env: ${key}`);
  return value;
};

const hashKey = (key: string) =>
  crypto.createHmac('sha256', process.env.DOCUMENT_API_KEY_HASH_SECRET || getRequiredEnv('JWT_ACCESS_SECRET'))
    .update(key.trim())
    .digest('hex');

const mineruHeaders = () => ({
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Authorization: `Bearer ${getRequiredEnv('MINERU_API_TOKEN')}`
});

const requestJson = <T>(method: 'GET' | 'POST', requestPath: string, body?: unknown): Promise<T> =>
  new Promise((resolve, reject) => {
    const url = new URL(requestPath, MINERU_BASE_URL);
    const rawBody = body === undefined ? '' : JSON.stringify(body);
    const startedAt = Date.now();
    logDocument('upstream.request.start', { method, path: requestPath, hasBody: body !== undefined });
    const request = https.request(url, {
      method,
      headers: {
        ...mineruHeaders(),
        ...(rawBody ? { 'Content-Length': Buffer.byteLength(rawBody) } : {})
      }
    }, (response) => {
      const chunks: Uint8Array[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(new Uint8Array(chunk)));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let payload: any;
        try { payload = JSON.parse(raw); } catch { reject(new Error('文档解析服务响应异常')); return; }
        if ((response.statusCode || 500) >= 400 || payload?.code !== 0) {
          logDocument('upstream.request.failed', { method, path: requestPath, status: response.statusCode || 500, elapsedMs: Date.now() - startedAt, code: payload?.code });
          reject(new Error(`文档解析服务请求失败 (${response.statusCode || 500})`));
          return;
        }
        logDocument('upstream.request.success', { method, path: requestPath, status: response.statusCode || 200, elapsedMs: Date.now() - startedAt });
        resolve(payload.data as T);
      });
    });
    request.on('error', (error) => {
      logDocumentError('upstream.request.error', error, { method, path: requestPath, elapsedMs: Date.now() - startedAt });
      reject(error);
    });
    if (rawBody) request.write(rawBody);
    request.end();
  });

const uploadToSignedUrl = (urlText: string, filePath: string) =>
  new Promise<void>((resolve, reject) => {
    const url = new URL(urlText);
    const options = { method: 'PUT', headers: { 'Content-Length': fs.statSync(filePath).size } };
    const handleResponse = (response: http.IncomingMessage) => {
      response.resume();
      if ((response.statusCode || 500) >= 200 && (response.statusCode || 500) < 300) resolve();
      else reject(new Error(`文件上传失败 (${response.statusCode || 500})`));
    };
    const request = url.protocol === 'https:'
      ? https.request(url, options, handleResponse)
      : http.request(url, options, handleResponse);
    request.on('error', reject);
    fs.createReadStream(filePath).on('error', reject).pipe(request);
  });

const getReservedCredits = () => {
  const fallback = MAX_PAGES * getPagePrice();
  const configured = Number(process.env.DOCUMENT_RESERVE_CREDITS_PER_JOB || fallback);
  return Number.isInteger(configured) && configured > 0 && configured <= fallback ? configured : fallback;
};

const isDocumentBillingEnabled = () => process.env.DOCUMENT_BILLING_ENABLED === 'true';

const getQuotaPerPage = () => {
  const configured = Number(process.env.DOCUMENT_QUOTA_PER_PAGE || 50000);
  return Number.isInteger(configured) && configured > 0 ? configured : 50000;
};

const getPagePrice = () => {
  const configured = Number(process.env.DOCUMENT_CREDITS_PER_PAGE || 1);
  return Number.isInteger(configured) && configured > 0 ? configured : 1;
};

const chargeDocumentJobQuota = async (job: DocumentParseJobDocument, totalPages: number) => {
  const quota = totalPages * getQuotaPerPage();
  const charge = await BillingTransactionModel.findOneAndUpdate(
    { businessType: 'document_parse', businessId: job._id.toString(), direction: 'debit' },
    {
      $setOnInsert: {
        userId: job.userId,
        businessType: 'document_parse',
        businessId: job._id.toString(),
        currency: 'new_api_quota',
        direction: 'debit',
        amount: quota,
        quantity: totalPages,
        apiKeyId: job.apiKeyId,
        status: 'pending'
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (charge.status === 'succeeded') return charge.amount;

  const locked = await BillingTransactionModel.findOneAndUpdate(
    { _id: charge._id, status: { $in: ['pending', 'failed'] } },
    { $set: { status: 'processing', error: undefined } },
    { new: true }
  );
  if (!locked) throw new Error('文档解析扣费处理中，请稍后查询任务结果');

  try {
    await chargeNewApiQuota({ userId: job.userId.toString(), quota: locked.amount });
    await BillingTransactionModel.updateOne(
      { _id: locked._id, status: 'processing' },
      { $set: { status: 'succeeded', completedAt: new Date(), error: undefined } }
    );
    return locked.amount;
  } catch (error) {
    const message = error instanceof Error ? error.message : '扣除 New-API 额度失败';
    await BillingTransactionModel.updateOne(
      { _id: locked._id },
      { $set: { status: 'failed', error: message } }
    );
    throw error;
  }
};

export const getDocumentRechargeOptions = () => {
  const creditsPerYuan = Number(process.env.DOCUMENT_CREDITS_PER_YUAN || 0);
  const amounts = String(process.env.DOCUMENT_RECHARGE_AMOUNTS || '')
    .split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item) && item > 0);
  if (!Number.isFinite(creditsPerYuan) || creditsPerYuan <= 0) return [];
  return [...new Set(amounts)].sort((a, b) => a - b).map((amount) => ({ amount, credits: Math.round(amount * creditsPerYuan) }));
};

export const getDocumentRechargeOption = (amount: number) => {
  const option = getDocumentRechargeOptions().find((item) => item.amount === amount);
  if (!option) throw new Error('文档解析充值金额无效，请使用已配置档位');
  return option;
};

export const rememberDocumentApiKey = async (input: { userId: string; keyId: string; secret: string; name?: string }) => {
  const keyHash = hashKey(input.secret);
  const keyFingerprint = keyHash.slice(0, 12);
  logDocument('key.bind.start', { userId: input.userId, keyId: input.keyId, keyFingerprint });
  const existing = await DocumentApiKeyModel.findOne({ $or: [{ newApiKeyId: input.keyId }, { keyHash }] });
  if (existing && existing.userId.toString() !== input.userId) {
    logDocument('key.bind.conflict', { userId: input.userId, keyId: input.keyId, keyFingerprint, boundUserId: existing.userId.toString() });
    throw new Error('该 API Key 已绑定到其他账户');
  }
  await DocumentApiKeyModel.findOneAndUpdate(
    existing ? { _id: existing._id } : { keyHash },
    { $set: { userId: input.userId, newApiKeyId: input.keyId, keyHash, name: input.name } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  logDocument('key.bind.success', { userId: input.userId, keyId: input.keyId, keyFingerprint });
};

export const registerDocumentApiKey = async (input: { userId: string; secret: string }) => {
  const secret = input.secret.trim();
  if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(secret)) throw new Error('API Key 格式无效');
  const keyHash = hashKey(secret);
  const keyFingerprint = keyHash.slice(0, 12);
  logDocument('key.register.start', { userId: input.userId, keyFingerprint });
  const existing = await DocumentApiKeyModel.findOne({ keyHash });
  if (existing && existing.userId.toString() !== input.userId) {
    logDocument('key.register.conflict', { userId: input.userId, keyFingerprint, boundUserId: existing.userId.toString() });
    throw new Error('该 API Key 已绑定到其他账户');
  }
  if (!existing) {
    await DocumentApiKeyModel.create({ userId: input.userId, keyHash, name: '手动绑定密钥' });
  }
  logDocument('key.register.success', { userId: input.userId, keyFingerprint, existed: Boolean(existing) });
};

export const authenticateDocumentApiKey = async (authorization: string) => {
  const key = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!key) throw new Error('Authorization Bearer API Key 不可为空');
  const keyHash = hashKey(key);
  const keyFingerprint = keyHash.slice(0, 12);
  logDocument('key.authenticate.start', { keyFingerprint });
  const apiKey = await DocumentApiKeyModel.findOne({ keyHash }).lean();
  if (!apiKey) {
    logDocument('key.authenticate.miss', { keyFingerprint });
    throw new Error('该 API Key 尚未启用文档解析，请在控制台重新创建或复制一次密钥');
  }
  logDocument('key.authenticate.success', { keyFingerprint, userId: apiKey.userId.toString(), keyId: apiKey.newApiKeyId || 'manual' });
  return { userId: apiKey.userId.toString(), apiKeyId: apiKey.newApiKeyId || 'manual' };
};

export const getDocumentWallet = async (userId: string) => {
  const balance = await DocumentCreditBalanceModel.findOneAndUpdate(
    { userId }, { $setOnInsert: { availableCredits: 0, frozenCredits: 0 } }, { upsert: true, new: true }
  ).lean();
  return {
    availableCredits: balance.availableCredits,
    frozenCredits: balance.frozenCredits,
    creditsPerPage: getPagePrice(),
    rechargeOptions: getDocumentRechargeOptions()
  };
};

export const listDocumentConsumptions = async (userId: string) => {
  const items = await BillingTransactionModel.find({
    userId,
    businessType: 'document_parse',
    currency: 'new_api_quota',
    direction: 'debit'
  }).sort({ createdAt: -1 }).limit(100).lean();
  return items.map((item) => ({
    id: item._id.toString(),
    jobId: item.businessId,
    pages: item.quantity,
    quota: item.amount,
    status: item.status,
    error: item.error,
    createdAt: item.createdAt,
    completedAt: item.completedAt
  }));
};

export const creditDocumentOrder = async (input: { orderId: string; userId: string; credits: number }) => {
  try {
    await DocumentCreditLedgerModel.create({ userId: input.userId, type: 'recharge', credits: input.credits, orderId: input.orderId, remark: '文档解析充值' });
  } catch (error: any) {
    if (error?.code === 11000) return;
    throw error;
  }
  await DocumentCreditBalanceModel.findOneAndUpdate(
    { userId: input.userId }, { $inc: { availableCredits: input.credits }, $setOnInsert: { frozenCredits: 0 } }, { upsert: true, new: true }
  );
};

const refundJob = async (job: DocumentParseJobDocument, reason: string) => {
  if (job.settledAt) return;
  if (job.reservedCredits > 0) {
    await DocumentCreditBalanceModel.findOneAndUpdate(
      { userId: job.userId }, { $inc: { availableCredits: job.reservedCredits, frozenCredits: -job.reservedCredits } }
    );
    await DocumentCreditLedgerModel.create({ userId: job.userId, type: 'refund', credits: job.reservedCredits, jobId: job._id, remark: reason });
  }
  job.state = 'failed';
  job.error = reason;
  job.settledAt = new Date();
  await job.save();
};

export const createDocumentParseJob = async (input: { userId: string; apiKeyId: string; file: UploadedDocumentFile; modelVersion?: string }) => {
  if (!input.file) throw new Error('file is required');
  const extension = path.extname(input.file.originalname).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error('不支持的文档格式');
  const reservedCredits = isDocumentBillingEnabled() ? getReservedCredits() : 0;
  if (reservedCredits > 0) {
    const balance = await DocumentCreditBalanceModel.findOneAndUpdate(
      { userId: input.userId, availableCredits: { $gte: reservedCredits } },
      { $inc: { availableCredits: -reservedCredits, frozenCredits: reservedCredits }, $setOnInsert: { availableCredits: 0, frozenCredits: 0 } },
      { new: true }
    );
    if (!balance) throw new Error(`文档解析余额不足，单次任务需预冻结 ${reservedCredits} 页额度`);
  }

  const job = await DocumentParseJobModel.create({ userId: input.userId, apiKeyId: input.apiKeyId, originalName: input.file.originalname, state: 'uploading', reservedCredits });
  if (reservedCredits > 0) {
    await DocumentCreditLedgerModel.create({ userId: input.userId, type: 'reserve', credits: -reservedCredits, jobId: job._id, remark: '提交文档解析任务' });
  }
  try {
    const upload = await requestJson<{ batch_id: string; file_urls: string[] }>('POST', '/api/v4/file-urls/batch', {
      files: [{ name: input.file.originalname, data_id: job._id.toString() }],
      model_version: input.modelVersion === 'pipeline' ? 'pipeline' : 'vlm'
    });
    if (!upload.batch_id || !upload.file_urls?.[0]) throw new Error('解析服务未返回上传链接');
    await uploadToSignedUrl(upload.file_urls[0], input.file.path);
    job.mineruBatchId = upload.batch_id;
    job.state = 'pending';
    await job.save();
    return job;
  } catch (error) {
    await refundJob(job, error instanceof Error ? error.message : '提交解析任务失败');
    throw error;
  } finally {
    fs.unlink(input.file.path, () => undefined);
  }
};

export const createDocumentParseJobFromUrl = async (input: { userId: string; apiKeyId: string; url: string; modelVersion?: string }) => {
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(input.url);
  } catch {
    throw new Error('url 必须是可访问的 HTTP 或 HTTPS 文件地址');
  }
  if (!['http:', 'https:'].includes(sourceUrl.protocol)) {
    throw new Error('url 必须是可访问的 HTTP 或 HTTPS 文件地址');
  }
  const reservedCredits = isDocumentBillingEnabled() ? getReservedCredits() : 0;
  if (reservedCredits > 0) {
    const balance = await DocumentCreditBalanceModel.findOneAndUpdate(
      { userId: input.userId, availableCredits: { $gte: reservedCredits } },
      { $inc: { availableCredits: -reservedCredits, frozenCredits: reservedCredits } },
      { new: true }
    );
    if (!balance) throw new Error(`文档解析余额不足，单次任务需预冻结 ${reservedCredits} 页额度`);
  }

  const originalName = path.basename(sourceUrl.pathname) || 'remote-document';
  const job = await DocumentParseJobModel.create({
    userId: input.userId, apiKeyId: input.apiKeyId, originalName, sourceUrl: sourceUrl.toString(),
    state: 'pending', reservedCredits
  });
  if (reservedCredits > 0) {
    await DocumentCreditLedgerModel.create({ userId: input.userId, type: 'reserve', credits: -reservedCredits, jobId: job._id, remark: '提交文档解析任务' });
  }
  try {
    const task = await requestJson<{ task_id: string }>('POST', '/api/v4/extract/task', {
      url: sourceUrl.toString(),
      model_version: input.modelVersion === 'pipeline' ? 'pipeline' : 'vlm'
    });
    if (!task.task_id) throw new Error('解析服务未返回任务 ID');
    job.mineruTaskId = task.task_id;
    await job.save();
    return job;
  } catch (error) {
    await refundJob(job, error instanceof Error ? error.message : '提交解析任务失败');
    throw error;
  }
};

export const refreshDocumentParseJob = async (job: DocumentParseJobDocument) => {
  if ((!job.mineruBatchId && !job.mineruTaskId) || job.settledAt) return job;
  try {
    const result = job.mineruTaskId
      ? await requestJson<any>('GET', `/api/v4/extract/task/${encodeURIComponent(job.mineruTaskId)}`)
      : await requestJson<any>('GET', `/api/v4/extract-results/batch/${encodeURIComponent(job.mineruBatchId || '')}`);
    const item = job.mineruTaskId
      ? result
      : Array.isArray(result) ? result[0] : Array.isArray(result?.extract_result) ? result.extract_result[0] : result;
    const state = String(item?.state || 'pending');
    const totalPages = Number(item?.extract_progress?.total_pages || item?.total_pages || 0);
    if (state === 'done') {
      if (job.reservedCredits === 0) {
        const pages = Math.max(1, totalPages || 1);
        const chargedQuota = await chargeDocumentJobQuota(job, pages);
        job.state = 'done'; job.totalPages = totalPages || undefined; job.chargedCredits = 0; job.chargedQuota = chargedQuota; job.resultUrl = item?.full_zip_url; job.error = undefined; job.settledAt = new Date(); await job.save();
        return job;
      }
      const actualCredits = Math.max(1, totalPages || job.reservedCredits) * getPagePrice();
      if (actualCredits > job.reservedCredits) {
        await refundJob(job, '文档页数超出预冻结额度');
        return job;
      }
      const refund = job.reservedCredits - actualCredits;
      if (refund) {
        await DocumentCreditBalanceModel.findOneAndUpdate({ userId: job.userId }, { $inc: { availableCredits: refund, frozenCredits: -job.reservedCredits } });
        await DocumentCreditLedgerModel.create({ userId: job.userId, type: 'settle', credits: -actualCredits, jobId: job._id, remark: `文档解析结算 ${totalPages || 1} 页` });
      } else {
        await DocumentCreditBalanceModel.findOneAndUpdate({ userId: job.userId }, { $inc: { frozenCredits: -job.reservedCredits } });
      }
      job.state = 'done'; job.totalPages = totalPages || undefined; job.chargedCredits = actualCredits; job.resultUrl = item?.full_zip_url; job.settledAt = new Date(); await job.save();
    } else if (state === 'failed') {
      await refundJob(job, String(item?.err_msg || '文档解析失败'));
    } else {
      job.state = state === 'running' ? 'running' : 'pending';
      if (totalPages) job.totalPages = totalPages;
      await job.save();
    }
  } catch (error) {
    job.error = error instanceof Error ? error.message : '获取解析状态失败';
    await job.save();
  }
  return job;
};

export const getDocumentJobForUser = async (userId: string, jobId: string) => {
  const job = await DocumentParseJobModel.findOne({ _id: jobId, userId });
  if (!job) throw new Error('文档解析任务不存在');
  return refreshDocumentParseJob(job);
};
