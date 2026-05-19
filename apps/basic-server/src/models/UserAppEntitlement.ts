import mongoose, { Schema, type Document, type Model } from 'mongoose';

export type UserAppEntitlementStatus = 'active' | 'revoked';
export type UserAppEntitlementSourceType = 'redeem' | 'purchase' | 'admin_grant';

export interface UserAppEntitlementDocument extends Document {
  userId: mongoose.Types.ObjectId;
  appId: mongoose.Types.ObjectId;
  status: UserAppEntitlementStatus;
  sourceType: UserAppEntitlementSourceType;
  sourceOrderId?: mongoose.Types.ObjectId;
  sourceRedeemRecordId?: mongoose.Types.ObjectId;
  grantedAt: Date;
  expiredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userAppEntitlementSchema = new Schema<UserAppEntitlementDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    appId: { type: Schema.Types.ObjectId, ref: 'AppItem', required: true, index: true },
    status: {
      type: String,
      enum: ['active', 'revoked'],
      default: 'active',
      index: true
    },
    sourceType: {
      type: String,
      enum: ['redeem', 'purchase', 'admin_grant'],
      required: true
    },
    sourceOrderId: { type: Schema.Types.ObjectId, ref: 'MemberOrder' },
    sourceRedeemRecordId: { type: Schema.Types.ObjectId, ref: 'RedeemRecord' },
    grantedAt: { type: Date, default: Date.now },
    expiredAt: { type: Date, index: true }
  },
  { timestamps: true }
);

userAppEntitlementSchema.index({ userId: 1, appId: 1 }, { unique: true });

const UserAppEntitlementModel: Model<UserAppEntitlementDocument> =
  mongoose.models.UserAppEntitlement ||
  mongoose.model<UserAppEntitlementDocument>('UserAppEntitlement', userAppEntitlementSchema);

export default UserAppEntitlementModel;
