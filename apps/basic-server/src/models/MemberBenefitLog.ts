import mongoose, { Schema, type Document, type Model } from 'mongoose';

export type MemberBenefitType = 'open' | 'renew' | 'expire' | 'refund';

export interface MemberBenefitLogDocument extends Document {
  userId: mongoose.Types.ObjectId;
  orderId: mongoose.Types.ObjectId;
  type: MemberBenefitType;
  beforeExpiredAt?: Date;
  afterExpiredAt?: Date;
  remark?: string;
  createdAt: Date;
  updatedAt: Date;
}

const memberBenefitLogSchema = new Schema<MemberBenefitLogDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'MemberOrder', required: true, index: true },
    type: {
      type: String,
      enum: ['open', 'renew', 'expire', 'refund'],
      required: true
    },
    beforeExpiredAt: { type: Date },
    afterExpiredAt: { type: Date },
    remark: { type: String, trim: true }
  },
  { timestamps: true }
);

memberBenefitLogSchema.index({ userId: 1, createdAt: -1 });

const MemberBenefitLogModel: Model<MemberBenefitLogDocument> =
  mongoose.models.MemberBenefitLog ||
  mongoose.model<MemberBenefitLogDocument>('MemberBenefitLog', memberBenefitLogSchema);

export default MemberBenefitLogModel;
