import crypto from 'crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import UserModel from '@/models/User';
import UserSessionModel from '@/models/UserSession';
import MemberDebugSessionModel from '@/models/MemberDebugSession';

const JOKER_USER_ID = '698433ea0cda17ab9fdcd41f';
const JOKER_OPEN_ID = 'o8yng1Rr9LW8dW1989inQTIIxVGI';
const DEBUG_TTL_SECONDS = 30 * 60;

export const canDebugMembers = (user: { _id: unknown; wechatOpenId: string; role: string }) =>
  String(user._id) === JOKER_USER_ID && user.wechatOpenId === JOKER_OPEN_ID && user.role === 'admin';

export const createMemberDebugSession = async (input: {
  actorUserId: string; parentSessionId: string; targetUserId: string; ip: string; userAgent: string;
}) => {
  if (!mongoose.isValidObjectId(input.targetUserId)) throw new Error('用户 ID 无效');
  const actor = await UserModel.findById(input.actorUserId);
  if (!actor || !canDebugMembers(actor)) throw new Error('仅 Joker 可使用此操作');
  const parent = await UserSessionModel.findOne({
    sessionId: input.parentSessionId, userId: actor._id, status: 'active', expiresAt: { $gt: new Date() }
  });
  if (!parent) throw new Error('管理员会话已失效');
  const target = await UserModel.findById(input.targetUserId);
  if (!target) throw new Error('用户不存在');
  if (target.role === 'admin') throw new Error('不能进入管理员账户');
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('Missing env: JWT_ACCESS_SECRET');
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Math.min(Date.now() + DEBUG_TTL_SECONDS * 1000, parent.expiresAt.getTime()));
  await MemberDebugSessionModel.create({ ...input, sessionId, expiresAt });
  const accessToken = jwt.sign({
    type: 'access', sub: String(target._id), sid: input.parentSessionId, debugSessionId: sessionId
  }, secret, { expiresIn: Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) });
  return { accessToken, expiresAt, user: {
    id: String(target._id), nickname: target.nickname, avatar: target.avatar,
    wechatOpenId: target.wechatOpenId, role: 'user'
  } };
};

export const verifyMemberDebugSession = async (payload: { sub: string; sid: string; debugSessionId: string }) => {
  const session = await MemberDebugSessionModel.findOne({
    sessionId: payload.debugSessionId, targetUserId: payload.sub, parentSessionId: payload.sid,
    endedAt: { $exists: false }, expiresAt: { $gt: new Date() }
  });
  if (!session) throw new Error('会员访问已结束，请返回会员管理');
  const [actor, target, parent] = await Promise.all([
    UserModel.findById(session.actorUserId), UserModel.findById(payload.sub),
    UserSessionModel.findOne({ sessionId: payload.sid, userId: session.actorUserId,
      status: 'active', expiresAt: { $gt: new Date() } })
  ]);
  if (!actor || !canDebugMembers(actor) || !parent || !target || target.role === 'admin') {
    throw new Error('会员访问权限已失效，请返回会员管理');
  }
};

export const endMemberDebugSession = async (sessionId: string) => {
  await MemberDebugSessionModel.updateOne(
    { sessionId, endedAt: { $exists: false } }, { $set: { endedAt: new Date() } }
  );
};
