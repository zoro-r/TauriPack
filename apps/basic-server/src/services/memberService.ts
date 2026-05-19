import crypto from 'crypto';
import MemberPlanModel from '@/models/MemberPlan';
import MemberOrderModel from '@/models/MemberOrder';
import MemberAccountModel from '@/models/MemberAccount';
import MemberBenefitLogModel from '@/models/MemberBenefitLog';
import { createNativeWechatPayOrder, queryWechatPayOrder } from '@/services/wechatPayService';

export interface MemberPlanInput {
  name: string;
  code: string;
  price: number;
  originalPrice?: number;
  durationDays: number;
  description?: string;
  isActive?: boolean;
  isVisibleToUser?: boolean;
  sort?: number;
}

const DEFAULT_PLANS = [
  {
    name: '年度会员',
    code: 'yearly',
    price: 299,
    durationDays: 365,
    description: '年度会员服务',
    isVisibleToUser: true,
    sort: 1
  }
];

const amountToCent = (amount: number) => Math.round(amount * 100);

const buildOrderNo = () => `MB${Date.now()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

const getForceOneFenUserIds = () =>
  String(process.env.MEMBER_PAY_FORCE_1FEN_USER_IDS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const shouldForceOneFen = (userId: string) => getForceOneFenUserIds().includes(userId);

const payLog = (tag: string, payload: Record<string, unknown>) => {
  console.info(`[member-pay][${tag}]`, payload);
};

const ensureDefaultPlans = async () => {
  const count = await MemberPlanModel.countDocuments();
  if (count > 0) {
    return;
  }
  await MemberPlanModel.insertMany(DEFAULT_PLANS);
};

const normalizeMemberAccount = async (userId: string) => {
  const account = await MemberAccountModel.findOne({ userId });
  if (!account) {
    return null;
  }
  if (account.expiredAt && account.expiredAt.getTime() < Date.now() && account.status !== 'expired') {
    account.status = 'expired';
    account.isMember = false;
    await account.save();
  }
  return account;
};

const grantMemberBenefit = async (orderId: string) => {
  const order = await MemberOrderModel.findById(orderId).populate('planId');
  if (!order) {
    throw new Error('order not found');
  }
  if (order.status !== 'paid') {
    payLog('grant.skip', {
      orderId,
      orderNo: order.orderNo,
      status: order.status
    });
    return order;
  }

  const existingLog = await MemberBenefitLogModel.findOne({ orderId: order._id });
  if (existingLog) {
    payLog('grant.idempotent', {
      orderId,
      orderNo: order.orderNo
    });
    return order;
  }

  const plan = order.planId as unknown as {
    durationDays: number;
    name: string;
  };

  const account = await normalizeMemberAccount(order.userId.toString());
  const beforeExpiredAt = account?.expiredAt;
  const now = new Date();
  const baseDate =
    beforeExpiredAt && beforeExpiredAt.getTime() > now.getTime() ? beforeExpiredAt : now;
  const nextExpiredAt = new Date(baseDate.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

  const nextAccount =
    account ||
    new MemberAccountModel({
      userId: order.userId
    });

  nextAccount.isMember = true;
  nextAccount.memberLevel = 'vip';
  nextAccount.startedAt = account?.startedAt || now;
  nextAccount.expiredAt = nextExpiredAt;
  nextAccount.sourceOrderId = order._id;
  nextAccount.status = 'active';
  await nextAccount.save();

  await MemberBenefitLogModel.create({
    userId: order.userId,
    orderId: order._id,
    type: beforeExpiredAt ? 'renew' : 'open',
    beforeExpiredAt,
    afterExpiredAt: nextExpiredAt,
    remark: `会员套餐：${plan.name}`
  });

  payLog('grant.success', {
    orderId,
    orderNo: order.orderNo,
    userId: String(order.userId),
    beforeExpiredAt,
    afterExpiredAt: nextExpiredAt
  });

  return order;
};

const markOrderAsPaid = async (payload: {
  orderNo: string;
  transactionId?: string;
  successTime?: string;
}) => {
  const order = await MemberOrderModel.findOne({ orderNo: payload.orderNo });
  if (!order) {
    throw new Error('order not found');
  }

  if (order.status !== 'paid') {
    payLog('order.markPaid', {
      orderNo: payload.orderNo,
      transactionId: payload.transactionId,
      successTime: payload.successTime
    });
    order.status = 'paid';
    order.wechatTransactionId = payload.transactionId;
    order.paidAt = payload.successTime ? new Date(payload.successTime) : new Date();
    await order.save();
  }

  await grantMemberBenefit(order._id.toString());
  return order;
};

export const listMemberPlans = async () => {
  await ensureDefaultPlans();
  return MemberPlanModel.find({ isActive: true, isVisibleToUser: true })
    .sort({ sort: 1, createdAt: -1 })
    .lean();
};

export const listAllMemberPlans = async () => {
  await ensureDefaultPlans();
  return MemberPlanModel.find().sort({ sort: 1, createdAt: -1 }).lean();
};

export const createMemberPlan = async (input: MemberPlanInput) => {
  await ensureDefaultPlans();
  const code = String(input.code || '').trim();
  const name = String(input.name || '').trim();
  if (!name) {
    throw new Error('name is required');
  }
  if (!code) {
    throw new Error('code is required');
  }
  const exists = await MemberPlanModel.findOne({ code }).lean();
  if (exists) {
    throw new Error('plan code already exists');
  }
  return MemberPlanModel.create({
    name,
    code,
    price: Number(input.price),
    originalPrice: input.originalPrice !== undefined ? Number(input.originalPrice) : undefined,
    durationDays: Number(input.durationDays),
    description: input.description?.trim(),
    isActive: typeof input.isActive === 'boolean' ? input.isActive : true,
    isVisibleToUser:
      typeof input.isVisibleToUser === 'boolean' ? input.isVisibleToUser : true,
    sort: typeof input.sort === 'number' ? input.sort : 0
  });
};

export const updateMemberPlan = async (id: string, input: MemberPlanInput) => {
  const plan = await MemberPlanModel.findById(id);
  if (!plan) {
    throw new Error('plan not found');
  }
  const code = String(input.code || '').trim();
  const name = String(input.name || '').trim();
  if (!name) {
    throw new Error('name is required');
  }
  if (!code) {
    throw new Error('code is required');
  }
  const exists = await MemberPlanModel.findOne({ code, _id: { $ne: id } }).lean();
  if (exists) {
    throw new Error('plan code already exists');
  }

  plan.name = name;
  plan.code = code;
  plan.price = Number(input.price);
  plan.originalPrice =
    input.originalPrice !== undefined && input.originalPrice !== null
      ? Number(input.originalPrice)
      : undefined;
  plan.durationDays = Number(input.durationDays);
  plan.description = input.description?.trim();
  plan.isActive = typeof input.isActive === 'boolean' ? input.isActive : plan.isActive;
  plan.isVisibleToUser =
    typeof input.isVisibleToUser === 'boolean'
      ? input.isVisibleToUser
      : plan.isVisibleToUser;
  plan.sort = typeof input.sort === 'number' ? input.sort : plan.sort;
  await plan.save();
  return plan;
};

export const getMemberMe = async (userId: string) => {
  const account = await normalizeMemberAccount(userId);
  const latestOrder = await MemberOrderModel.findOne({ userId })
    .populate('planId', 'name code price durationDays')
    .sort({ createdAt: -1 })
    .lean();

  return {
    isMember: Boolean(account?.isMember && account?.status === 'active'),
    memberLevel: account?.memberLevel || 'basic',
    status: account?.status || 'expired',
    startedAt: account?.startedAt,
    expiredAt: account?.expiredAt,
    latestOrder
  };
};

export const listMemberOrders = async (userId: string) => {
  const items = await MemberOrderModel.find({ userId, status: 'paid' })
    .populate('planId', 'name code price durationDays')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  return items;
};

export const createMemberOrder = async (userId: string, planCode: string) => {
  await ensureDefaultPlans();
  const plan = await MemberPlanModel.findOne({ code: planCode, isActive: true });
  if (!plan) {
    throw new Error('plan not found');
  }

  const orderNo = buildOrderNo();
  const description = `${plan.name}充值`;
  const forceOneFen = shouldForceOneFen(userId);
  const payableAmount = forceOneFen ? 0.01 : plan.price;
  payLog('order.create.start', {
    userId,
    planCode,
    orderNo,
    amount: plan.price,
    payableAmount,
    forceOneFen
  });
  const codeUrl = await createNativeWechatPayOrder({
    outTradeNo: orderNo,
    description,
    amountCent: amountToCent(payableAmount)
  });

  const order = await MemberOrderModel.create({
    orderNo,
    userId,
    orderType: 'member',
    bizId: plan._id,
    planId: plan._id,
    amount: payableAmount,
    status: 'pending',
    payChannel: 'wechat_native',
    wechatPrepayCodeUrl: codeUrl,
    expiredAt: new Date(Date.now() + 30 * 60 * 1000),
    title: plan.name,
    description,
    snapshot: {
      name: plan.name,
      code: plan.code,
      price: plan.price,
      durationDays: plan.durationDays,
      description: plan.description
    }
  });

  payLog('order.create.success', {
    userId,
    planCode,
    orderId: order._id.toString(),
    orderNo: order.orderNo,
    amount: order.amount,
    forceOneFen
  });

  return {
    id: order._id.toString(),
    orderNo: order.orderNo,
    amount: order.amount,
    status: order.status,
    payChannel: order.payChannel,
    codeUrl
  };
};

export const getMemberOrderDetail = async (userId: string, orderId: string) => {
  const order = await MemberOrderModel.findOne({ _id: orderId, userId })
    .populate('planId', 'name code price durationDays')
    .lean();
  if (!order) {
    throw new Error('order not found');
  }
  return order;
};

export const syncMemberOrderStatus = async (userId: string, orderId: string) => {
  const order = await MemberOrderModel.findOne({ _id: orderId, userId });
  if (!order) {
    throw new Error('order not found');
  }
  payLog('order.sync.start', {
    userId,
    orderId,
    orderNo: order.orderNo,
    status: order.status
  });
  if (order.status === 'paid') {
    await grantMemberBenefit(order._id.toString());
    return getMemberOrderDetail(userId, orderId);
  }

  const wechatOrder = await queryWechatPayOrder(order.orderNo);
  payLog('order.sync.queryResult', {
    orderNo: order.orderNo,
    tradeState: wechatOrder.trade_state,
    transactionId: wechatOrder.transaction_id
  });

  if (wechatOrder.trade_state === 'SUCCESS') {
    await markOrderAsPaid({
      orderNo: order.orderNo,
      transactionId: wechatOrder.transaction_id,
      successTime: wechatOrder.success_time
    });
  } else if (wechatOrder.trade_state === 'CLOSED' || wechatOrder.trade_state === 'PAYERROR') {
    payLog('order.sync.closed', {
      orderNo: order.orderNo,
      tradeState: wechatOrder.trade_state
    });
    order.status = 'closed';
    await order.save();
  }

  return getMemberOrderDetail(userId, orderId);
};

export const settleMemberOrderByWechatCallback = async (payload: {
  orderNo: string;
  tradeState: string;
  transactionId?: string;
  successTime?: string;
}) => {
  payLog('callback.settle.start', payload);
  if (payload.tradeState === 'SUCCESS') {
    await markOrderAsPaid({
      orderNo: payload.orderNo,
      transactionId: payload.transactionId,
      successTime: payload.successTime
    });
    return;
  }

  if (payload.tradeState === 'CLOSED' || payload.tradeState === 'PAYERROR') {
    const order = await MemberOrderModel.findOne({ orderNo: payload.orderNo });
    if (order && order.status === 'pending') {
      payLog('callback.settle.closed', {
        orderNo: payload.orderNo,
        tradeState: payload.tradeState
      });
      order.status = 'closed';
      await order.save();
    }
  }
};
