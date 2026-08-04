import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface BillingTransactionDocument extends Document {
  userId: mongoose.Types.ObjectId;
  businessType: string;
  businessId: string;
  currency: string;
  direction: 'debit' | 'credit';
  amount: number;
  quantity?: number;
  apiKeyId?: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  remark?: string;
  metadata?: Record<string, unknown>;
  completedAt?: Date;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const billingTransactionSchema = new Schema<BillingTransactionDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    businessType: { type: String, required: true, trim: true, index: true },
    businessId: { type: String, required: true, trim: true, index: true },
    currency: { type: String, required: true, trim: true, index: true },
    direction: { type: String, enum: ['debit', 'credit'], required: true, index: true },
    amount: { type: Number, required: true, min: 1 },
    quantity: { type: Number, min: 1 },
    apiKeyId: { type: String, index: true },
    status: { type: String, enum: ['pending', 'processing', 'succeeded', 'failed'], default: 'pending', index: true },
    remark: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed },
    completedAt: { type: Date },
    error: { type: String }
  },
  { timestamps: true }
);

billingTransactionSchema.index({ businessType: 1, businessId: 1, direction: 1 }, { unique: true });
billingTransactionSchema.index({ userId: 1, createdAt: -1 });

const BillingTransactionModel: Model<BillingTransactionDocument> =
  mongoose.models.BillingTransaction ||
  mongoose.model<BillingTransactionDocument>('BillingTransaction', billingTransactionSchema);

export default BillingTransactionModel;
