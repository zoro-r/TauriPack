import MemberOrderModel from '@/models/MemberOrder';

export interface WechatPaymentResult {
  orderNo: string;
  transactionId?: string;
  successTime?: string;
  appid?: string;
  mchid?: string;
  amount?: { total?: number; currency?: string };
}

export const recordWechatPayment = async (payment: WechatPaymentResult) => {
  const order = await MemberOrderModel.findOne({ orderNo: payment.orderNo, payChannel: 'wechat_native' });
  if (!order) throw new Error('order not found');
  if (!payment.transactionId || !payment.appid || !payment.mchid ||
    payment.appid !== process.env.WECHAT_PAY_APPID || payment.mchid !== process.env.WECHAT_PAY_MCHID ||
    !Number.isSafeInteger(payment.amount?.total) || payment.amount?.total !== Math.round(order.amount * 100) ||
    payment.amount?.currency !== 'CNY') {
    throw new Error('微信支付商户、应用、金额或币种与订单不一致');
  }
  if (order.wechatTransactionId && order.wechatTransactionId !== payment.transactionId) {
    throw new Error('微信支付流水与订单不一致');
  }
  if (order.status === 'paid' || order.status === 'refunded') return order;
  const paidAt = payment.successTime ? new Date(payment.successTime) : new Date();
  if (!Number.isFinite(paidAt.getTime())) throw new Error('微信支付时间无效');
  const updated = await MemberOrderModel.findOneAndUpdate(
    { _id: order._id, status: { $in: ['pending', 'closed'] },
      $or: [{ wechatTransactionId: { $exists: false } }, { wechatTransactionId: payment.transactionId }] },
    { $set: { status: 'paid', wechatTransactionId: payment.transactionId, paidAt } },
    { new: true }
  );
  if (updated) return updated;
  const current = await MemberOrderModel.findById(order._id);
  if (!current || !['paid', 'refunded'].includes(current.status) || current.wechatTransactionId !== payment.transactionId) {
    throw new Error('支付状态已变化，请重新核对');
  }
  return current;
};

export const closeLocalWechatOrder = async (orderNo: string) => {
  // A late close/query result must never overwrite a successful payment callback.
  await MemberOrderModel.updateOne({ orderNo, status: 'pending', payChannel: 'wechat_native' },
    { $set: { status: 'closed' } });
};
