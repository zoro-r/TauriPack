import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface NewApiRechargeDocument extends Document {
  orderId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  remoteUserId: string;
  quota: number;
  status: 'pending' | 'crediting' | 'credited' | 'failed';
  error?: string;
  creditedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const newApiRechargeSchema = new Schema<NewApiRechargeDocument>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'MemberOrder', required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    remoteUserId: { type: String, required: true, index: true },
    quota: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['pending', 'crediting', 'credited', 'failed'], default: 'pending', index: true },
    error: { type: String },
    creditedAt: { type: Date }
  },
  { timestamps: true }
);

const NewApiRechargeModel: Model<NewApiRechargeDocument> =
  mongoose.models.NewApiRecharge || mongoose.model<NewApiRechargeDocument>('NewApiRecharge', newApiRechargeSchema);

export default NewApiRechargeModel;
