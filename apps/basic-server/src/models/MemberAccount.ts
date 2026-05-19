import mongoose, { Schema, type Document, type Model } from 'mongoose';

export type MemberAccountStatus = 'active' | 'expired';

export interface MemberAccountDocument extends Document {
  userId: mongoose.Types.ObjectId;
  isMember: boolean;
  memberLevel: string;
  startedAt?: Date;
  expiredAt?: Date;
  sourceOrderId?: mongoose.Types.ObjectId;
  status: MemberAccountStatus;
  createdAt: Date;
  updatedAt: Date;
}

const memberAccountSchema = new Schema<MemberAccountDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    isMember: { type: Boolean, default: false, index: true },
    memberLevel: { type: String, default: 'basic' },
    startedAt: { type: Date },
    expiredAt: { type: Date, index: true },
    sourceOrderId: { type: Schema.Types.ObjectId, ref: 'MemberOrder' },
    status: {
      type: String,
      enum: ['active', 'expired'],
      default: 'expired',
      index: true
    }
  },
  { timestamps: true }
);

const MemberAccountModel: Model<MemberAccountDocument> =
  mongoose.models.MemberAccount ||
  mongoose.model<MemberAccountDocument>('MemberAccount', memberAccountSchema);

export default MemberAccountModel;
