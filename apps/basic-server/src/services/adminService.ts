import mongoose from 'mongoose';
import UserModel from '@/models/User';
import MemberAccountModel from '@/models/MemberAccount';
import MemberOrderModel from '@/models/MemberOrder';
import { syncMemberOrderStatus } from '@/services/memberService';
import { reconcileNewApiRecharge, type RechargeReconciliation } from '@/services/newApiService';

export interface AdminListQuery {
  keyword?: string;
  role?: 'user' | 'admin';
  memberStatus?: 'active' | 'expired';
  page?: string | number;
  pageSize?: string | number;
}

export interface AdminOrderQuery {
  keyword?: string;
  userKeyword?: string;
  status?: 'pending' | 'paid' | 'closed' | 'refunded';
  orderType?: 'member' | 'app' | 'recharge' | 'service' | 'redeem';
  payChannel?: 'wechat_native' | 'redeem_code';
  page?: string | number;
  pageSize?: string | number;
}

const toPage = (value?: string | number) => Math.max(Number(value) || 1, 1);
const toPageSize = (value?: string | number) => Math.min(Math.max(Number(value) || 20, 1), 100);

const ensureObjectId = (value: string, label: string) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new Error(`${label} is invalid`);
  }
};

export const listAdminUsers = async (query: AdminListQuery) => {
  const page = toPage(query.page);
  const pageSize = toPageSize(query.pageSize);
  const userFilter: Record<string, unknown> = {};
  const keyword = query.keyword?.trim();

  if (keyword) {
    userFilter.$or = [
      { nickname: { $regex: keyword, $options: 'i' } },
      { wechatOpenId: { $regex: keyword, $options: 'i' } }
    ];
  }
  if (query.role) {
    userFilter.role = query.role;
  }
  if (query.memberStatus) {
    const memberUserIds = await MemberAccountModel.find({ status: query.memberStatus }).distinct('userId');
    userFilter._id = { $in: memberUserIds };
  }

  const users = await UserModel.find(userFilter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .lean();
  const total = await UserModel.countDocuments(userFilter);
  const userIds = users.map((user) => user._id);
  const accounts = await MemberAccountModel.find({ userId: { $in: userIds } }).lean();
  const accountMap = new Map(accounts.map((account) => [String(account.userId), account]));

  const items = users.map((user) => ({
    id: user._id.toString(),
    nickname: user.nickname,
    avatar: user.avatar,
    wechatOpenId: user.wechatOpenId,
    role: user.role || 'user',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    member: accountMap.get(user._id.toString()) || null
  }));

  return { items, total, page, pageSize };
};

export const getAdminUserDetail = async (id: string) => {
  ensureObjectId(id, 'userId');
  const user = await UserModel.findById(id).lean();
  if (!user) {
    throw new Error('user not found');
  }
  const [member, orders] = await Promise.all([
    MemberAccountModel.findOne({ userId: id }).lean(),
    MemberOrderModel.find({ userId: id })
      .populate('planId', 'name code price durationDays')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean()
  ]);

  return {
    id: user._id.toString(),
    nickname: user.nickname,
    avatar: user.avatar,
    wechatOpenId: user.wechatOpenId,
    role: user.role || 'user',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    member,
    orders
  };
};

export const updateAdminUserRole = async (id: string, role: 'user' | 'admin') => {
  ensureObjectId(id, 'userId');
  if (!['user', 'admin'].includes(role)) {
    throw new Error('role is invalid');
  }
  const user = await UserModel.findByIdAndUpdate(id, { role }, { new: true, runValidators: true }).lean();
  if (!user) {
    throw new Error('user not found');
  }
  return {
    id: user._id.toString(),
    role: user.role || 'user'
  };
};

export const updateAdminUserMember = async (
  id: string,
  input: { isMember?: boolean; expiredAt?: string; memberLevel?: string }
) => {
  ensureObjectId(id, 'userId');
  const user = await UserModel.findById(id).lean();
  if (!user) {
    throw new Error('user not found');
  }

  const account =
    (await MemberAccountModel.findOne({ userId: id })) ||
    new MemberAccountModel({ userId: id });
  const isMember = Boolean(input.isMember);
  const expiredAt = input.expiredAt ? new Date(input.expiredAt) : undefined;

  account.isMember = isMember;
  account.memberLevel = input.memberLevel?.trim() || (isMember ? 'vip' : 'basic');
  account.status = isMember ? 'active' : 'expired';
  account.startedAt = isMember ? account.startedAt || new Date() : account.startedAt;
  account.expiredAt = isMember ? expiredAt || account.expiredAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : undefined;
  await account.save();

  return account;
};

export const listAdminOrders = async (query: AdminOrderQuery) => {
  const page = toPage(query.page);
  const pageSize = toPageSize(query.pageSize);
  const filter: Record<string, unknown> = {};
  const keyword = query.keyword?.trim();
  const userKeyword = query.userKeyword?.trim();

  if (query.status) {
    filter.status = query.status;
  }
  if (query.orderType) {
    filter.orderType = query.orderType;
  }
  if (query.payChannel) {
    filter.payChannel = query.payChannel;
  }
  if (keyword) {
    filter.$or = [
      { orderNo: { $regex: keyword, $options: 'i' } },
      { wechatTransactionId: { $regex: keyword, $options: 'i' } },
      { description: { $regex: keyword, $options: 'i' } }
    ];
  }
  if (userKeyword) {
    const matchedUsers = await UserModel.find({
      $or: [
        { nickname: { $regex: userKeyword, $options: 'i' } },
        { wechatOpenId: { $regex: userKeyword, $options: 'i' } }
      ]
    })
      .select('_id')
      .lean();
    filter.userId = {
      $in: matchedUsers.map((item) => item._id)
    };
  }

  const [items, total] = await Promise.all([
    MemberOrderModel.find(filter)
      .populate('userId', 'nickname avatar wechatOpenId role')
      .populate('planId', 'name code price durationDays')
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    MemberOrderModel.countDocuments(filter)
  ]);

  return { items, total, page, pageSize };
};

export const getAdminOrderDetail = async (id: string) => {
  ensureObjectId(id, 'orderId');
  const order = await MemberOrderModel.findById(id)
    .populate('userId', 'nickname avatar wechatOpenId role')
    .populate('planId', 'name code price durationDays')
    .lean();
  if (!order) {
    throw new Error('order not found');
  }
  return order;
};

export const syncAdminOrder = async (
  id: string,
  options: { rechargeResolution?: RechargeReconciliation } = {}
) => {
  ensureObjectId(id, 'orderId');
  const order = await MemberOrderModel.findById(id).lean();
  if (!order) {
    throw new Error('order not found');
  }
  if (order.payChannel !== 'wechat_native') {
    return getAdminOrderDetail(id);
  }

  if (options.rechargeResolution) {
    if (order.orderType !== 'recharge' || order.status !== 'paid') {
      throw new Error('只有已支付的充值订单可以进行入账核对');
    }
    await reconcileNewApiRecharge({
      orderId: id,
      resolution: options.rechargeResolution
    });
    if (options.rechargeResolution === 'credited') {
      return getAdminOrderDetail(id);
    }
  }

  return syncMemberOrderStatus(order.userId.toString(), id);
};
