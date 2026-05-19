import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface RedeemRecordDocument extends Document {
  codeId: mongoose.Types.ObjectId;
  batchId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  grantType: 'member' | 'app';
  grantSnapshot: {
    title: string;
    description?: string;
    memberLevel?: string;
    durationDays?: number;
    appId?: string;
    appName?: string;
    appSlug?: string;
  };
  beforeExpiredAt?: Date;
  afterExpiredAt?: Date;
  result: 'success' | 'failed';
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const redeemRecordSchema = new Schema<RedeemRecordDocument>(
  {
    codeId: { type: Schema.Types.ObjectId, ref: 'RedeemCode', required: true, index: true },
    batchId: { type: Schema.Types.ObjectId, ref: 'RedeemBatch', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    grantType: { type: String, enum: ['member', 'app'], default: 'member' },
    grantSnapshot: {
      title: { type: String, required: true, trim: true },
      description: { type: String, trim: true },
      memberLevel: { type: String, trim: true },
      durationDays: { type: Number, min: 1 },
      appId: { type: String, trim: true },
      appName: { type: String, trim: true },
      appSlug: { type: String, trim: true }
    },
    beforeExpiredAt: { type: Date },
    afterExpiredAt: { type: Date },
    result: { type: String, enum: ['success', 'failed'], required: true, index: true },
    errorMessage: { type: String, trim: true }
  },
  { timestamps: true }
);

redeemRecordSchema.index({ userId: 1, createdAt: -1 });

const RedeemRecordModel: Model<RedeemRecordDocument> =
  mongoose.models.RedeemRecord ||
  mongoose.model<RedeemRecordDocument>('RedeemRecord', redeemRecordSchema);

export default RedeemRecordModel;
