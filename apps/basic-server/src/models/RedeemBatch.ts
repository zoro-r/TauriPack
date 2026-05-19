import mongoose, { Schema, type Document, type Model } from 'mongoose';

export type RedeemBatchStatus = 'draft' | 'active' | 'disabled';
export type RedeemGrantType = 'member' | 'app';

export interface RedeemGrantSnapshot {
  title: string;
  description?: string;
  memberLevel?: string;
  durationDays?: number;
  appDurationDays?: number;
  appId?: string;
  appName?: string;
  appSlug?: string;
}

export interface RedeemBatchDocument extends Document {
  name: string;
  codePrefix?: string;
  status: RedeemBatchStatus;
  grantType: RedeemGrantType;
  planId?: mongoose.Types.ObjectId;
  appId?: mongoose.Types.ObjectId;
  grantSnapshot: RedeemGrantSnapshot;
  userVisibleTitle: string;
  userVisibleDescription?: string;
  expiresAt?: Date;
  totalCount: number;
  usedCount: number;
  remark?: string;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const redeemBatchSchema = new Schema<RedeemBatchDocument>(
  {
    name: { type: String, required: true, trim: true },
    codePrefix: { type: String, trim: true },
    status: {
      type: String,
      enum: ['draft', 'active', 'disabled'],
      default: 'draft',
      index: true
    },
    grantType: {
      type: String,
      enum: ['member', 'app'],
      default: 'member',
      index: true
    },
    planId: { type: Schema.Types.ObjectId, ref: 'MemberPlan' },
    appId: { type: Schema.Types.ObjectId, ref: 'AppItem' },
    grantSnapshot: {
      title: { type: String, required: true, trim: true },
      description: { type: String, trim: true },
      memberLevel: { type: String, trim: true },
      durationDays: { type: Number, min: 1 },
      appDurationDays: { type: Number, min: 1 },
      appId: { type: String, trim: true },
      appName: { type: String, trim: true },
      appSlug: { type: String, trim: true }
    },
    userVisibleTitle: { type: String, required: true, trim: true },
    userVisibleDescription: { type: String, trim: true },
    expiresAt: { type: Date, index: true },
    totalCount: { type: Number, default: 0 },
    usedCount: { type: Number, default: 0 },
    remark: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

redeemBatchSchema.index({ status: 1, createdAt: -1 });

const RedeemBatchModel: Model<RedeemBatchDocument> =
  mongoose.models.RedeemBatch ||
  mongoose.model<RedeemBatchDocument>('RedeemBatch', redeemBatchSchema);

export default RedeemBatchModel;
