import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import OrangeLoginAttemptModel from '@/models/OrangeLoginAttempt';
import UserModel from '@/models/User';

export const orangeLoginOrigin = 'https://app.chaobenxueyuan.com';
export const orangeBindingLifetime = 10 * 60 * 1000;
export const orangeBindingCookie = '__Host-chaoben-orange-link';
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const isDuplicate = (error: unknown) => (error as { code?: number } | null)?.code === 11000;

export class OrangeLoginError extends Error {}

export async function startOrangeLogin(ticket: unknown) {
  const secret = process.env.APP_CHAOBEN_LOGIN_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret) < 32) throw new OrangeLoginError('橙子登录绑定尚未启用');
  if (typeof ticket !== 'string' || ticket.length > 1024) throw new OrangeLoginError('橙子登录凭证无效');
  let claims: jwt.JwtPayload | string;
  try {
    claims = jwt.verify(ticket, secret, {
      algorithms: ['HS256'], issuer: 'orange-education-desktop', audience: orangeLoginOrigin, maxAge: '60s'
    });
  } catch {
    throw new OrangeLoginError('橙子登录凭证已失效，请重新打开超本云');
  }
  if (typeof claims !== 'object' || !uuid.test(claims.sub ?? '') || !uuid.test(claims.jti ?? '') ||
    typeof claims.iat !== 'number' || claims.exp !== claims.iat + 60 || claims.iat > Date.now() / 1000) {
    throw new OrangeLoginError('橙子登录凭证无效');
  }
  const key = randomBytes(32).toString('base64url');
  try {
    await OrangeLoginAttemptModel.create({
      _id: claims.jti,
      orangeUserId: claims.sub,
      bindingHash: hash(key),
      expiresAt: new Date(Date.now() + orangeBindingLifetime)
    });
  } catch (error) {
    if (isDuplicate(error)) throw new OrangeLoginError('橙子登录凭证已使用，请重新打开超本云');
    throw error;
  }
  const linkedUser = await UserModel.findOne({ orangeUserId: claims.sub }).select('_id').lean();
  return { key, linkedUserId: linkedUser?._id.toString() };
}

export async function findOrangeLoginAttempt(key?: string) {
  if (!key || !/^[\w-]{43}$/.test(key)) throw new OrangeLoginError('绑定已过期，请刷新二维码');
  const attempt = await OrangeLoginAttemptModel.findOne({ bindingHash: hash(key), expiresAt: { $gt: new Date() } }).lean();
  if (!attempt) throw new OrangeLoginError('绑定已过期，请刷新二维码');
  return attempt;
}

export async function linkOrangeUser(userId: string, orangeUserId: string) {
  await UserModel.init();
  try {
    const result = await UserModel.updateOne(
      { _id: userId, $or: [{ orangeUserId: { $exists: false } }, { orangeUserId }] },
      { $set: { orangeUserId } }
    );
    if (!result.matchedCount) throw new OrangeLoginError('此超本云账号已绑定其他橙子账号');
  } catch (error) {
    if (isDuplicate(error)) throw new OrangeLoginError('当前橙子账号已绑定其他超本云账号');
    throw error;
  }
}
