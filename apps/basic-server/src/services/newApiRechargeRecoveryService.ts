import MemberOrderModel from '@/models/MemberOrder';
import NewApiRechargeModel from '@/models/NewApiRecharge';
import { creditNewApiRecharge } from '@/services/newApiService';
import { reconcileRechargePayment } from '@/services/rechargeOrderService';

// Only retry work that has not sent a quota update. Ambiguous results require reconciliation.
const recoverPendingPayments = async () => {
  // Active queries recover payments even if the callback never arrived or could not be persisted.
  const pending = await MemberOrderModel.find({
    orderType: 'recharge', status: 'pending', payChannel: 'wechat_native',
    createdAt: { $lte: new Date(Date.now() - 30_000) },
    $or: [{ paymentCheckedAt: { $exists: false } }, { paymentCheckedAt: { $lte: new Date(Date.now() - 30_000) } }]
  }).sort({ paymentCheckedAt: 1, createdAt: 1 }).limit(20);
  for (let offset = 0; offset < pending.length; offset += 5) {
    await Promise.all(pending.slice(offset, offset + 5).map(async (order) => {
      try {
        const claim = await MemberOrderModel.updateOne({
          _id: order._id, status: 'pending',
          $or: [{ paymentCheckedAt: { $exists: false } }, { paymentCheckedAt: { $lte: new Date(Date.now() - 30_000) } }]
        }, { $set: { paymentCheckedAt: new Date() } });
        if (!claim.matchedCount) return;
        await reconcileRechargePayment(order);
      } catch (error) {
        console.error('[newApiRechargeRecovery] payment query failed', {
          orderNo: order.orderNo, message: error instanceof Error ? error.message : String(error)
        });
      }
    }));
  }
};

const recoverPaidRecharges = async () => {
  const orders = await MemberOrderModel.aggregate([
    { $match: { orderType: 'recharge', status: 'paid', payChannel: 'wechat_native' } },
    { $lookup: {
      from: NewApiRechargeModel.collection.name,
      localField: '_id', foreignField: 'orderId', as: 'recharge'
    } },
    { $match: { $or: [
      { recharge: { $size: 0 } },
      { recharge: { $elemMatch: {
        $or: [{ status: 'pending' }, { status: 'failed', retrySafe: true }],
        updatedAt: { $lte: new Date(Date.now() - 60_000) }
      } } }
    ] } },
    { $sort: { updatedAt: 1 } },
    { $limit: 20 }
  ]);
  for (let offset = 0; offset < orders.length; offset += 5) {
    await Promise.all(orders.slice(offset, offset + 5).map(async (order) => {
      try {
        await creditNewApiRecharge({
          orderId: String(order._id), userId: String(order.userId),
          remoteUserId: String(order.snapshot?.remoteUserId || ''),
          quota: Number(order.snapshot?.quota || 0)
        });
      } catch (error) {
        console.error('[newApiRechargeRecovery] recovery failed', {
          orderId: String(order._id), message: error instanceof Error ? error.message : String(error)
        });
      }
    }));
  }
};

export const recoverNewApiRecharges = async () => {
  const results = await Promise.allSettled([recoverPendingPayments(), recoverPaidRecharges()]);
  for (const result of results) {
    if (result.status === 'rejected') console.error('[newApiRechargeRecovery] batch failed', result.reason);
  }
};

export const startNewApiRechargeRecovery = async () => {
  // The unique orderId index and atomic claim also protect against multiple server processes.
  await NewApiRechargeModel.init();
  await MemberOrderModel.init();
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await recoverNewApiRecharges();
    } catch (error) {
      console.error('[newApiRechargeRecovery] scan failed', error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void run(); }, 30_000);
  timer.unref();
  void run();
};
