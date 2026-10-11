import crypto from 'crypto';
import mongoose from 'mongoose';
import MemberOrderModel, { type MemberOrderDocument } from '@/models/MemberOrder';
import RechargeOrderGuardModel from '@/models/RechargeOrderGuard';
import { createNewApiRechargeOrder } from '@/services/newApiService';
import { createNativeWechatPayOrder, queryWechatPayOrder, closeWechatPayOrder } from '@/services/wechatPayService';
import { recordWechatPayment, closeLocalWechatOrder } from '@/services/wechatPaymentStateService';

const isMissingWechatOrder = (error: unknown) => (error as { code?: string })?.code === 'ORDER_NOT_EXIST';
const viewOrder = (order: MemberOrderDocument) => ({
  id: String(order._id), orderNo: order.orderNo, amount: order.amount,
  quota: Number(order.snapshot?.quota || 0), status: order.status,
  payChannel: order.payChannel, codeUrl: order.wechatPrepayCodeUrl || ''
});

export const reconcileRechargePayment = async (order: MemberOrderDocument) => {
  let payment;
  try { payment = await queryWechatPayOrder(order.orderNo); }
  catch (error) {
    // Do not release a slot on a network error, or while a preparation request may be in flight.
    if (isMissingWechatOrder(error) && order.expiredAt && order.expiredAt <= new Date() &&
      (!order.paymentPreparingUntil || order.paymentPreparingUntil <= new Date())) {
      // The scan snapshot may predate a preparation claim. Recheck the live lease atomically.
      await MemberOrderModel.updateOne({ _id: order._id, status: 'pending',
        $or: [{ paymentPreparingUntil: { $exists: false } }, { paymentPreparingUntil: { $lte: new Date() } }] },
      { $set: { status: 'closed' } });
      return;
    }
    throw error;
  }
  if (payment.trade_state === 'SUCCESS') {
    await recordWechatPayment({ orderNo: order.orderNo, transactionId: payment.transaction_id,
      successTime: payment.success_time, appid: payment.appid, mchid: payment.mchid, amount: payment.amount });
  } else if (['CLOSED', 'REVOKED', 'PAYERROR'].includes(payment.trade_state || '')) {
    await closeLocalWechatOrder(order.orderNo);
  } else if (payment.trade_state === 'NOTPAY' && order.expiredAt && order.expiredAt <= new Date()) {
    // If payment wins the race with close, the close call fails; the next query/callback recovers it.
    await closeWechatPayOrder(order.orderNo);
    await closeLocalWechatOrder(order.orderNo);
  }
};

const prepareOrder = async (order: MemberOrderDocument) => {
  if (order.wechatPrepayCodeUrl) return viewOrder(order);
  if (order.expiredAt && order.expiredAt <= new Date()) throw new Error('原充值订单已过期，正在核对支付状态，请稍后重试');
  const attemptId = crypto.randomUUID();
  const previous = await MemberOrderModel.findOneAndUpdate(
    { _id: order._id, status: 'pending', wechatPrepayCodeUrl: { $exists: false },
      $or: [{ paymentPreparingUntil: { $exists: false } }, { paymentPreparingUntil: { $lte: new Date() } }] },
    { $set: { paymentAttemptId: attemptId, paymentPreparingUntil: new Date(Date.now() + 90_000), paymentAttempted: true } },
    { new: false }
  );
  if (!previous) {
    const current = await MemberOrderModel.findById(order._id);
    if (current && (current.wechatPrepayCodeUrl || current.status === 'paid')) return viewOrder(current);
    throw new Error('充值订单正在准备，请稍后重试');
  }
  try {
    if (previous.paymentAttempted) {
      let exists = true;
      try {
        const payment = await queryWechatPayOrder(order.orderNo);
        if (payment.trade_state === 'SUCCESS') {
          return viewOrder(await recordWechatPayment({ orderNo: order.orderNo, transactionId: payment.transaction_id,
            successTime: payment.success_time, appid: payment.appid, mchid: payment.mchid, amount: payment.amount }));
        }
        if (payment.trade_state === 'NOTPAY') {
          // Native cannot reliably reissue a lost QR with the same order number. Close it before replacement.
          await closeWechatPayOrder(order.orderNo);
          await closeLocalWechatOrder(order.orderNo);
          throw new Error('原订单未支付且支付链接未保存，已关闭，请重新发起充值');
        }
        if (['CLOSED', 'REVOKED', 'PAYERROR'].includes(payment.trade_state || '')) {
          await closeLocalWechatOrder(order.orderNo);
          throw new Error('原订单已关闭，请重新发起充值');
        }
      } catch (error) { if (isMissingWechatOrder(error)) exists = false; else throw error; }
      if (exists) throw new Error('原订单支付状态待确认，请稍后重试');
    }
    const codeUrl = await createNativeWechatPayOrder({ outTradeNo: order.orderNo,
      description: order.description, amountCent: Math.round(order.amount * 100), expiresAt: order.expiredAt });
    const updated = await MemberOrderModel.findOneAndUpdate(
      { _id: order._id, paymentAttemptId: attemptId },
      { $set: { wechatPrepayCodeUrl: codeUrl } }, { new: true }
    );
    if (!updated) throw new Error('订单支付准备状态已变化，请稍后重试');
    return viewOrder(updated);
  } catch (error) {
    console.error('[rechargeOrder] preparation failed', { orderNo: order.orderNo,
      message: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    await MemberOrderModel.updateOne({ _id: order._id, paymentAttemptId: attemptId },
      { $unset: { paymentAttemptId: 1, paymentPreparingUntil: 1 } });
  }
};

export const createOrReuseApiRechargeOrder = async (userId: string, amount: number) => {
  const recharge = await createNewApiRechargeOrder(userId, amount);
  const forceOneFen = String(process.env.MEMBER_PAY_FORCE_1FEN_USER_IDS || '').split(',').map(value => value.trim()).includes(userId);
  const payableAmount = forceOneFen ? 0.01 : recharge.amount;
  const key = crypto.createHash('sha256').update(JSON.stringify([recharge.amount, payableAmount, recharge.quota, recharge.remoteUserId])).digest('hex');
  // Wait for unique indexes before accepting a new request; old orders lack these fields and are unaffected.
  await MemberOrderModel.init();
  const owner = crypto.randomUUID();
  let guard;
  try {
    guard = await RechargeOrderGuardModel.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(userId), $or: [{ owner: { $exists: false } }, { leaseExpiresAt: { $lte: new Date() } }] },
      { $set: { owner, leaseExpiresAt: new Date(Date.now() + 30_000) } }, { upsert: true, new: true }
    );
  } catch (error) {
    if ((error as { code?: number })?.code === 11000) throw new Error('充值请求正在处理，请稍后重试');
    throw error;
  }
  let order: MemberOrderDocument | undefined;
  try {
    const pending = await MemberOrderModel.find({ userId, orderType: 'recharge', payChannel: 'wechat_native', status: 'pending' }).sort({ createdAt: -1 });
    order = pending.find(item => item.expiredAt && item.expiredAt > new Date() &&
      (item.rechargeKey === key || (!item.rechargeKey && item.amount === payableAmount &&
        Number(item.snapshot?.quota) === recharge.quota && String(item.snapshot?.remoteUserId) === recharge.remoteUserId)));
    if (!order) {
      if (pending.length >= 3) throw new Error('最多保留 3 笔待支付充值订单，请先支付或等待旧订单核对关闭');
      if (guard.lastCreatedAt && Date.now() - guard.lastCreatedAt.getTime() < 5000) throw new Error('充值下单过于频繁，请 5 秒后重试');
      const slot = [0, 1, 2].find(value => !pending.some(item => item.rechargeSlot === value));
      const reserved = await RechargeOrderGuardModel.updateOne(
        { _id: guard._id, owner, leaseExpiresAt: { $gt: new Date() } }, { $set: { lastCreatedAt: new Date() } }
      );
      if (!reserved.matchedCount) throw new Error('充值请求已过期，请重试');
      try {
        order = await MemberOrderModel.create({
          orderNo: `AR${Date.now()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          userId, orderType: 'recharge', amount: payableAmount, status: 'pending', payChannel: 'wechat_native',
          expiredAt: new Date(Date.now() + 30 * 60 * 1000), title: 'API 账户充值',
          description: `API 账户充值 ${recharge.amount} 元`, rechargeKey: key, rechargeSlot: slot,
          snapshot: { quota: recharge.quota, remoteUserId: recharge.remoteUserId, originalAmount: recharge.amount }
        });
      } catch (error) {
        if ((error as { code?: number })?.code === 11000) throw new Error('充值请求正在处理，请稍后重试');
        throw error;
      }
    }
  } finally {
    await RechargeOrderGuardModel.updateOne({ _id: guard._id, owner }, { $unset: { owner: 1, leaseExpiresAt: 1 } });
  }
  return prepareOrder(order!);
};
