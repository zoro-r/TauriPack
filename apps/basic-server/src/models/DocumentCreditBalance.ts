import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface DocumentCreditBalanceDocument extends Document {
  userId: mongoose.Types.ObjectId;
  availableCredits: number;
  frozenCredits: number;
  createdAt: Date;
  updatedAt: Date;
}

const documentCreditBalanceSchema = new Schema<DocumentCreditBalanceDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    availableCredits: { type: Number, required: true, default: 0, min: 0 },
    frozenCredits: { type: Number, required: true, default: 0, min: 0 }
  },
  { timestamps: true }
);

const DocumentCreditBalanceModel: Model<DocumentCreditBalanceDocument> =
  mongoose.models.DocumentCreditBalance ||
  mongoose.model<DocumentCreditBalanceDocument>('DocumentCreditBalance', documentCreditBalanceSchema);

export default DocumentCreditBalanceModel;
