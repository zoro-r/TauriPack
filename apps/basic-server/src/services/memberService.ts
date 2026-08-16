import crypto from 'crypto';
import MemberPlanModel from '@/models/MemberPlan';
import MemberOrderModel from '@/models/MemberOrder';
import MemberAccountModel from '@/models/MemberAccount';
import MemberBenefitLogModel from '@/models/MemberBenefitLog';
import AppItemModel from '@/models/AppItem';
import { ensureMemberUploadCategoryId } from '@/services/memberUploadCategoryService';
import { createNativeWechatPayOrder, queryWechatPayOrder } from '@/services/wechatPayService';
import { createNewApiRechargeOrder, creditNewApiRecharge } from '@/services/newApiService';
import { creditDocumentOrder, getDocumentRechargeOption } from '@/services/documentService';
import type { MemberPlanPurchaseLimit, MemberPlanType } from '@/models/MemberPlan';

export interface MemberPlanInput {
  name: string;
  code: string;
  price: number;
  originalPrice?: number;
  durationDays?: number;
  planType?: MemberPlanType;
  slotCount?: number;
  purchaseLimit?: MemberPlanPurchaseLimit;
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
    planType: 'membership' as const,
    slotCount: 1,
    purchaseLimit: 'unlimited' as const,
    description: '年度会员服务',
    isVisibleToUser: true,
    sort: 1
  },
  {
    name: '单个应用坑位',
    code: 'app_slot_single',
    price: 49,
    durationDays: 0,
    planType: 'app_slot' as const,
    slotCount: 1,
    purchaseLimit: 'unlimited' as const,
    description: '增加 1 个应用坑位，可重复购买',
    isVisibleToUser: true,
    sort: 2
  },
  {
    name: '基础坑位包',
    code: 'app_slot_basic',
    price: 129,
    durationDays: 0,
    planType: 'app_slot' as const,
    slotCount: 3,
    purchaseLimit: 'once' as const,
    description: '额外增加 3 个应用坑位，每个用户限购一次',
    isVisibleToUser: true,
    sort: 3
  }
];

const amountToCent = (amount: number) => Math.round(amount * 100);

const buildOrderNo = () => `MB${Date.now()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

const buildRechargeOrderNo = () => `AR${Date.now()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
const buildDocumentRechargeOrderNo = () => `DR${Date.now()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

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
  const legacy = await MemberPlanModel.findOne({ code: 'membership_yearly' });
  if (legacy && !(await MemberPlanModel.exists({ code: 'yearly' }))) {
    legacy.code = 'yearly';
    legacy.price = 299;
    legacy.durationDays = 365;
    legacy.planType = 'membership';
    legacy.slotCount = 1;
    legacy.purchaseLimit = 'unlimited';
    legacy.description = '年度会员服务';
    legacy.isActive = true;
    legacy.isVisibleToUser = true;
    legacy.sort = 1;
    await legacy.save();
  }
  for (const item of DEFAULT_PLANS) {
    await MemberPlanModel.updateOne({ code: item.code }, { $setOnInsert: item }, { upsert: true });
  }
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

/** 会员上架应用等场景使用的「当前是否在有效期内」判断（与列表访问逻辑一致） */
export const isMemberActive = async (userId: string) => {
  const account = await normalizeMemberAccount(userId);
  if (!account?.isMember || account.status !== 'active') {
    return false;
  }
  if (account.expiredAt && account.expiredAt.getTime() < Date.now()) {
    return false;
  }
  return true;
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
    planType?: MemberPlanType;
  };

  if ((plan.planType || 'membership') === 'app_slot') {
    return order;
  }

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

  if (order.orderType === 'member') {
    await grantMemberBenefit(order._id.toString());
  }
  if (order.orderType === 'recharge') {
    const snapshot = order.snapshot as { quota?: number; remoteUserId?: string } | undefined;
    const quota = Number(snapshot?.quota || 0);
    const remoteUserId = String(snapshot?.remoteUserId || '');
    if (!quota || !remoteUserId) {
      throw new Error('充值订单缺少额度信息');
    }
    await creditNewApiRecharge({
      orderId: order._id.toString(),
      userId: order.userId.toString(),
      quota,
      remoteUserId
    });
  }
  if (order.orderType === 'service' && (order.snapshot as { service?: string } | undefined)?.service === 'document_credits') {
    const credits = Number((order.snapshot as { credits?: number }).credits || 0);
    if (!credits) throw new Error('文档解析充值订单缺少页数信息');
    await creditDocumentOrder({ orderId: order._id.toString(), userId: order.userId.toString(), credits });
  }
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
    durationDays: Number(input.durationDays ?? (input.planType === 'app_slot' ? 0 : 365)),
    planType: input.planType || 'membership',
    slotCount: Math.max(0, Number(input.slotCount || 0)),
    purchaseLimit: input.purchaseLimit || 'unlimited',
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
  plan.durationDays = Number(input.durationDays ?? (input.planType === 'app_slot' ? 0 : 365));
  plan.planType = input.planType || plan.planType || 'membership';
  plan.slotCount = Math.max(0, Number(input.slotCount ?? plan.slotCount ?? 0));
  plan.purchaseLimit = input.purchaseLimit || plan.purchaseLimit || 'unlimited';
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

  const memberUploadCategoryId = await ensureMemberUploadCategoryId();

  const quota = await getMemberAppQuota(userId);

  return {
    isMember: Boolean(account?.isMember && account?.status === 'active'),
    memberLevel: account?.memberLevel || 'basic',
    status: account?.status || 'expired',
    startedAt: account?.startedAt,
    expiredAt: account?.expiredAt,
    latestOrder,
    memberUploadCategoryId,
    ownedAppCount: quota.usedSlotCount,
    purchasedSlotCount: quota.purchasedSlotCount,
    totalSlotCount: quota.totalSlotCount,
    availableSlotCount: quota.availableSlotCount,
    slotPackagePurchased: quota.slotPackagePurchased
  };
};

export const getMemberAppQuota = async (userId: string) => {
  const active = await isMemberActive(userId);
  const orders = await MemberOrderModel.find({ userId, orderType: 'member', status: 'paid' })
    .select('snapshot')
    .lean();
  const purchasedSlotCount = orders.reduce((total, order) => {
    const snapshot = order.snapshot as { type?: string; slotCount?: number } | undefined;
    return total + (snapshot?.type === 'app_slot' ? Math.max(0, Number(snapshot.slotCount || 0)) : 0);
  }, 0);
  const totalSlotCount = (active ? 1 : 0) + purchasedSlotCount;
  const usedSlotCount = await AppItemModel.countDocuments({ ownerUserId: userId });
  return {
    isMember: active,
    purchasedSlotCount,
    totalSlotCount,
    usedSlotCount,
    availableSlotCount: Math.max(0, totalSlotCount - usedSlotCount),
    slotPackagePurchased: orders.some((order) => {
      const snapshot = order.snapshot as { type?: string; code?: string } | undefined;
      return snapshot?.type === 'app_slot' && snapshot.code === 'app_slot_basic';
    })
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

  const planType = plan.planType || 'membership';
  const purchaseLimit = plan.purchaseLimit || 'unlimited';
  if (planType === 'app_slot' && !(await isMemberActive(userId))) {
    throw new Error('请先开通有效会员，再购买应用坑位');
  }
  const purchaseKey = planType === 'app_slot' && purchaseLimit === 'once' ? plan.code : undefined;
  if (purchaseKey) {
    const existingPaid = await MemberOrderModel.findOne({ userId, purchaseKey, status: 'paid' }).lean();
    if (existingPaid) {
      throw new Error('基础坑位包每个用户只能购买一次');
    }
    const existingPending = await MemberOrderModel.findOne({
      userId,
      purchaseKey,
      status: 'pending',
      expiredAt: { $gt: new Date() }
    }).lean();
    if (existingPending?.wechatPrepayCodeUrl) {
      return {
        id: existingPending._id.toString(),
        orderNo: existingPending.orderNo,
        amount: existingPending.amount,
        status: existingPending.status,
        payChannel: existingPending.payChannel,
        codeUrl: existingPending.wechatPrepayCodeUrl,
        planType
      };
    }
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
      type: planType,
      slotCount: plan.slotCount || 0,
      purchaseLimit,
      description: plan.description
    },
    purchaseKey
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
    codeUrl,
    planType
  };
};

export const createApiRechargeOrder = async (userId: string, amount: number) => {
  const recharge = await createNewApiRechargeOrder(userId, amount);
  const orderNo = buildRechargeOrderNo();
  const forceOneFen = shouldForceOneFen(userId);
  const payableAmount = forceOneFen ? 0.01 : recharge.amount;
  const description = `API 账户充值 ${recharge.amount} 元`;
  const codeUrl = await createNativeWechatPayOrder({
    outTradeNo: orderNo,
    description,
    amountCent: amountToCent(payableAmount)
  });
  const order = await MemberOrderModel.create({
    orderNo,
    userId,
    orderType: 'recharge',
    amount: payableAmount,
    status: 'pending',
    payChannel: 'wechat_native',
    wechatPrepayCodeUrl: codeUrl,
    expiredAt: new Date(Date.now() + 30 * 60 * 1000),
    title: 'API 账户充值',
    description,
    snapshot: {
      quota: recharge.quota,
      remoteUserId: recharge.remoteUserId
    }
  });
  payLog('recharge.create.success', {
    userId,
    orderId: order._id.toString(),
    orderNo,
    amount: recharge.amount,
    payableAmount,
    quota: recharge.quota
  });
  return {
    id: order._id.toString(),
    orderNo,
    amount: payableAmount,
    quota: recharge.quota,
    status: order.status,
    payChannel: order.payChannel,
    codeUrl
  };
};

export const createDocumentCreditOrder = async (userId: string, amount: number) => {
  const recharge = getDocumentRechargeOption(amount);
  const orderNo = buildDocumentRechargeOrderNo();
  const forceOneFen = shouldForceOneFen(userId);
  const payableAmount = forceOneFen ? 0.01 : recharge.amount;
  const codeUrl = await createNativeWechatPayOrder({
    outTradeNo: orderNo,
    description: `文档解析页数充值 ${recharge.credits} 页`,
    amountCent: amountToCent(payableAmount)
  });
  const order = await MemberOrderModel.create({
    orderNo, userId, orderType: 'service', amount: payableAmount, status: 'pending',
    payChannel: 'wechat_native', wechatPrepayCodeUrl: codeUrl,
    expiredAt: new Date(Date.now() + 30 * 60 * 1000), title: '文档解析页数充值',
    description: `充值 ${recharge.credits} 页文档解析额度`,
    snapshot: { service: 'document_credits', credits: recharge.credits, originalAmount: recharge.amount }
  });
  return { id: order._id.toString(), orderNo, amount: payableAmount, credits: recharge.credits, status: order.status, payChannel: order.payChannel, codeUrl };
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
    if (order.orderType === 'member') {
      await grantMemberBenefit(order._id.toString());
    }
    if (order.orderType === 'recharge') {
      const snapshot = order.snapshot as { quota?: number; remoteUserId?: string } | undefined;
      await creditNewApiRecharge({
        orderId: order._id.toString(),
        userId: order.userId.toString(),
        quota: Number(snapshot?.quota || 0),
        remoteUserId: String(snapshot?.remoteUserId || '')
      });
    }
    if (order.orderType === 'service' && (order.snapshot as { service?: string } | undefined)?.service === 'document_credits') {
      await creditDocumentOrder({ orderId: order._id.toString(), userId: order.userId.toString(), credits: Number((order.snapshot as { credits?: number }).credits || 0) });
    }
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
