import mongoose, { Schema, type Document, type Model } from 'mongoose';

export type RedeemCodeStatus = 'unused' | 'used' | 'expired' | 'disabled';

export interface RedeemCodeDocument extends Document {
  code: string;
  batchId: mongoose.Types.ObjectId;
  status: RedeemCodeStatus;
  usedBy?: mongoose.Types.ObjectId;
  usedAt?: Date;
  expiresAt?: Date;
  boundUserId?: mongoose.Types.ObjectId;
  source: 'generated' | 'imported';
  createdAt: Date;
  updatedAt: Date;
}

const redeemCodeSchema = new Schema<RedeemCodeDocument>(
  {
    code: { type: String, required: true, unique: true, index: true, trim: true },
    batchId: { type: Schema.Types.ObjectId, ref: 'RedeemBatch', required: true, index: true },
    status: {
      type: String,
      enum: ['unused', 'used', 'expired', 'disabled'],
      default: 'unused',
      index: true
    },
    usedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    usedAt: { type: Date },
    expiresAt: { type: Date, index: true },
    boundUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    source: {
      type: String,
      enum: ['generated', 'imported'],
      default: 'generated'
    }
  },
  { timestamps: true }
);

redeemCodeSchema.index({ batchId: 1, status: 1, createdAt: -1 });

const RedeemCodeModel: Model<RedeemCodeDocument> =
  mongoose.models.RedeemCode ||
  mongoose.model<RedeemCodeDocument>('RedeemCode', redeemCodeSchema);

export default RedeemCodeModel;
