import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface DocumentCreditLedgerDocument extends Document {
  userId: mongoose.Types.ObjectId;
  type: 'recharge' | 'reserve' | 'settle' | 'refund';
  credits: number;
  jobId?: mongoose.Types.ObjectId;
  orderId?: mongoose.Types.ObjectId;
  remark?: string;
  createdAt: Date;
  updatedAt: Date;
}

const documentCreditLedgerSchema = new Schema<DocumentCreditLedgerDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['recharge', 'reserve', 'settle', 'refund'], required: true, index: true },
    credits: { type: Number, required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'DocumentParseJob', index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'MemberOrder', unique: true, sparse: true },
    remark: { type: String, trim: true }
  },
  { timestamps: true }
);

documentCreditLedgerSchema.index({ userId: 1, createdAt: -1 });

const DocumentCreditLedgerModel: Model<DocumentCreditLedgerDocument> =
  mongoose.models.DocumentCreditLedger ||
  mongoose.model<DocumentCreditLedgerDocument>('DocumentCreditLedger', documentCreditLedgerSchema);

export default DocumentCreditLedgerModel;
