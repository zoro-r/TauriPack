import crypto from 'crypto';
import https from 'https';
import { resolveSensitiveValue } from '@/utils/sensitiveConfig';

const API_BASE = 'https://api.mch.weixin.qq.com';

interface WechatNativeCreateResponse {
  code_url?: string;
}

interface WechatOrderQueryResponse {
  transaction_id?: string;
  trade_state?:
    | 'SUCCESS'
    | 'REFUND'
    | 'NOTPAY'
    | 'CLOSED'
    | 'REVOKED'
    | 'USERPAYING'
    | 'PAYERROR';
  success_time?: string;
}

interface WechatCallbackResource {
  algorithm: string;
  ciphertext: string;
  associated_data?: string;
  nonce: string;
  original_type: string;
}

export interface WechatPayCallbackPayload {
  id: string;
  create_time: string;
  event_type: string;
  resource_type: string;
  summary: string;
  resource: WechatCallbackResource;
}

export interface WechatPayCallbackTransaction {
  transaction_id: string;
  out_trade_no: string;
  trade_state:
    | 'SUCCESS'
    | 'REFUND'
    | 'NOTPAY'
    | 'CLOSED'
    | 'REVOKED'
    | 'USERPAYING'
    | 'PAYERROR';
  success_time?: string;
}

const getRequiredEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing env: ${key}`);
  }
  return value;
};

const payApiLog = (tag: string, payload: Record<string, unknown>) => {
  console.info(`[wechat-pay][${tag}]`, payload);
};

const getPrivateKey = () =>
  resolveSensitiveValue(getRequiredEnv('WECHAT_PAY_PRIVATE_KEY')).replace(/\\n/g, '\n');

const getPlatformPublicKey = () =>
  resolveSensitiveValue(getRequiredEnv('WECHAT_PAY_PLATFORM_PUBLIC_KEY')).replace(/\\n/g, '\n');

const buildAuthorization = (
  method: 'GET' | 'POST',
  pathWithQuery: string,
  body = ''
) => {
  const mchid = getRequiredEnv('WECHAT_PAY_MCHID');
  const serialNo = getRequiredEnv('WECHAT_PAY_SERIAL_NO');
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `${method}\n${pathWithQuery}\n${timestamp}\n${nonceStr}\n${body}\n`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(message);
  signer.end();
  const signature = signer.sign(getPrivateKey(), 'base64');

  return `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`;
};

const requestWechatPay = <T>(
  method: 'GET' | 'POST',
  pathWithQuery: string,
  body?: Record<string, unknown>
) =>
  new Promise<T>((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = https.request(
      `${API_BASE}${pathWithQuery}`,
      {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'TauriPack/1.0 (+https://app.chaobenxueyuan.com)',
          Authorization: buildAuthorization(method, pathWithQuery, payload)
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          const statusCode = res.statusCode || 500;
          const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
          if (statusCode >= 200 && statusCode < 300) {
            resolve(parsed as T);
            return;
          }
          reject(new Error(String(parsed.message || raw || 'wechat pay request failed')));
        });
      }
    );

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });

export const createNativeWechatPayOrder = async (payload: {
  outTradeNo: string;
  description: string;
  amountCent: number;
}) => {
  const appid = getRequiredEnv('WECHAT_PAY_APPID');
  const mchid = getRequiredEnv('WECHAT_PAY_MCHID');
  const notifyUrl = getRequiredEnv('WECHAT_PAY_NOTIFY_URL');
  payApiLog('native.create.start', {
    appid,
    mchid,
    outTradeNo: payload.outTradeNo,
    amountCent: payload.amountCent,
    notifyUrl
  });

  const response = await requestWechatPay<WechatNativeCreateResponse>(
    'POST',
    '/v3/pay/transactions/native',
    {
      appid,
      mchid,
      description: payload.description,
      out_trade_no: payload.outTradeNo,
      notify_url: notifyUrl,
      amount: {
        total: payload.amountCent,
        currency: 'CNY'
      }
    }
  );

  if (!response.code_url) {
    throw new Error('wechat pay code_url missing');
  }

  payApiLog('native.create.success', {
    outTradeNo: payload.outTradeNo,
    hasCodeUrl: Boolean(response.code_url)
  });

  return response.code_url;
};

export const queryWechatPayOrder = async (outTradeNo: string) => {
  const mchid = getRequiredEnv('WECHAT_PAY_MCHID');
  payApiLog('order.query.start', {
    outTradeNo,
    mchid
  });
  const result = await requestWechatPay<WechatOrderQueryResponse>(
    'GET',
    `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(
      mchid
    )}`
  );
  payApiLog('order.query.success', {
    outTradeNo,
    tradeState: result.trade_state,
    transactionId: result.transaction_id
  });
  return result;
};

export const verifyWechatPayCallbackSignature = (payload: {
  timestamp: string;
  nonce: string;
  body: string;
  signature: string;
}) => {
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${payload.timestamp}\n${payload.nonce}\n${payload.body}\n`);
  verifier.end();
  return verifier.verify(getPlatformPublicKey(), payload.signature, 'base64');
};

export const decryptWechatPayCallbackResource = (resource: WechatCallbackResource) => {
  const apiV3Key = resolveSensitiveValue(getRequiredEnv('WECHAT_PAY_API_V3_KEY'));
  const encoder = new TextEncoder();
  const key = encoder.encode(apiV3Key);
  const iv = encoder.encode(resource.nonce);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    iv
  );
  if (resource.associated_data) {
    decipher.setAAD(encoder.encode(resource.associated_data));
  }
  const ciphertext = Uint8Array.from(Buffer.from(resource.ciphertext, 'base64'));
  const authTag = ciphertext.slice(ciphertext.length - 16);
  const data = ciphertext.slice(0, ciphertext.length - 16);
  decipher.setAuthTag(authTag);
  const decrypted = `${decipher.update(data, undefined, 'utf8')}${decipher.final('utf8')}`;
  return JSON.parse(decrypted) as WechatPayCallbackTransaction;
};
