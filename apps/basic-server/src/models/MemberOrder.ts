import mongoose, { Schema, type Document, type Model } from 'mongoose';

export type MemberOrderStatus = 'pending' | 'paid' | 'closed' | 'refunded';
export type MemberPayChannel = 'wechat_native' | 'redeem_code';
export type MemberOrderType = 'member' | 'app' | 'recharge' | 'service' | 'redeem';

export interface MemberOrderDocument extends Document {
  orderNo: string;
  userId: mongoose.Types.ObjectId;
  orderType: MemberOrderType;
  bizId?: mongoose.Types.ObjectId;
  planId?: mongoose.Types.ObjectId;
  amount: number;
  status: MemberOrderStatus;
  payChannel: MemberPayChannel;
  wechatPrepayCodeUrl?: string;
  wechatTransactionId?: string;
  paidAt?: Date;
  expiredAt?: Date;
  title: string;
  description: string;
  snapshot?: Record<string, unknown>;
  purchaseKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const memberOrderSchema = new Schema<MemberOrderDocument>(
  {
    orderNo: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orderType: {
      type: String,
      enum: ['member', 'app', 'recharge', 'service', 'redeem'],
      default: 'member',
      index: true
    },
    bizId: { type: Schema.Types.ObjectId, index: true },
    planId: { type: Schema.Types.ObjectId, ref: 'MemberPlan' },
    amount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['pending', 'paid', 'closed', 'refunded'],
      default: 'pending',
      index: true
    },
    payChannel: {
      type: String,
      enum: ['wechat_native', 'redeem_code'],
      default: 'wechat_native'
    },
    wechatPrepayCodeUrl: { type: String },
    wechatTransactionId: { type: String, index: true },
    paidAt: { type: Date },
    expiredAt: { type: Date, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    snapshot: { type: Schema.Types.Mixed },
    purchaseKey: { type: String }
  },
  { timestamps: true }
);

memberOrderSchema.index({ userId: 1, createdAt: -1 });
memberOrderSchema.index({ orderType: 1, bizId: 1, createdAt: -1 });
memberOrderSchema.index(
  { userId: 1, purchaseKey: 1 },
  { unique: true, partialFilterExpression: { purchaseKey: { $exists: true }, status: 'paid' } }
);

const MemberOrderModel: Model<MemberOrderDocument> =
  mongoose.models.MemberOrder ||
  mongoose.model<MemberOrderDocument>('MemberOrder', memberOrderSchema);

export default MemberOrderModel;
