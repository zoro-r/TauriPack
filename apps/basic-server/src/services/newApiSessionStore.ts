import crypto from 'crypto';
import NewApiManagedSessionModel from '@/models/NewApiManagedSession';

export interface ManagedSessionState {
  cookie: string;
  bearerToken?: string;
  refreshCookie?: string;
  sessionId?: string;
  sessionExpiresAt?: number;
  expiresAt: number;
}

const encryptSession = (scope: string, secret: string, value: ManagedSessionState) => {
  const key = crypto.createHash('sha256').update(`new-api-session-store:v1:${secret}`).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', new Uint8Array(key), new Uint8Array(iv));
  cipher.setAAD(new Uint8Array(Buffer.from(scope)));
  const encrypted = Buffer.concat([new Uint8Array(cipher.update(JSON.stringify(value), 'utf8')), new Uint8Array(cipher.final())]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
};

const decryptSession = (scope: string, secret: string, value: string): ManagedSessionState => {
  try {
    const [version, iv, tag, data] = value.split('.');
    if (version !== 'v1') throw new Error('Unsupported session encryption');
    const key = crypto.createHash('sha256').update(`new-api-session-store:v1:${secret}`).digest();
    const cipher = crypto.createDecipheriv('aes-256-gcm', new Uint8Array(key), new Uint8Array(Buffer.from(iv, 'base64')));
    cipher.setAAD(new Uint8Array(Buffer.from(scope)));
    cipher.setAuthTag(new Uint8Array(Buffer.from(tag, 'base64')));
    const session = JSON.parse(Buffer.concat([new Uint8Array(cipher.update(new Uint8Array(Buffer.from(data, 'base64')))), new Uint8Array(cipher.final())]).toString('utf8'));
    if (!Number.isFinite(session.expiresAt) || typeof session.cookie !== 'string') throw new Error('Invalid session');
    return session;
  } catch {
    // Do not silently log in again after a key/configuration error and leak sessions.
    throw new Error('API 托管会话无法解密，请检查服务器密钥配置');
  }
};

// A lease serializes token rotation across processes; the _id also binds server and both user IDs.
export const withStoredManagedSession = async <T>(
  scope: string,
  secret: string,
  action: (store: { session?: ManagedSessionState; save: (value?: ManagedSessionState) => Promise<void> }) => Promise<T>
): Promise<T> => {
  const id = crypto.createHash('sha256').update(scope).digest('hex');
  const owner = crypto.randomBytes(16).toString('hex');
  try {
    await NewApiManagedSessionModel.updateOne({ _id: id }, { $setOnInsert: { _id: id } }, { upsert: true });
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
  }
  const deadline = Date.now() + 10000;
  let row: any;
  do {
    row = await NewApiManagedSessionModel.findOneAndUpdate(
      { _id: id, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: new Date() } }] },
      { $set: { leaseOwner: owner, leaseUntil: new Date(Date.now() + 90000) } },
      { new: true }
    ).select('+encryptedSession').lean();
    if (row) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  if (!row) throw new Error('API 账户会话正在更新，请稍后重试');
  try {
    const session = row.encryptedSession ? decryptSession(scope, secret, row.encryptedSession) : undefined;
    return await action({ session, save: async (value) => {
      const update = value
        ? { $set: { encryptedSession: encryptSession(scope, secret, value) } }
        : { $unset: { encryptedSession: 1 } };
      const result = await NewApiManagedSessionModel.updateOne(
        { _id: id, leaseOwner: owner, leaseUntil: { $gt: new Date() } }, update
      );
      if (result.matchedCount !== 1) throw new Error('API 账户会话更新锁已失效，请重试');
    } });
  } finally {
    await NewApiManagedSessionModel.updateOne(
      { _id: id, leaseOwner: owner }, { $unset: { leaseOwner: 1, leaseUntil: 1 } }
    );
  }
};
