import mongoose, { Schema, type Document, type Model } from 'mongoose';

export type WechatLoginStatus = 'PENDING' | 'SCANNED' | 'SUCCESS' | 'EXPIRED';

export interface WechatLoginStateDocument extends Document {
  state: string;
  status: WechatLoginStatus;
  userId?: mongoose.Types.ObjectId;
  loginCode?: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const wechatLoginStateSchema = new Schema<WechatLoginStateDocument>(
  {
    state: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ['PENDING', 'SCANNED', 'SUCCESS', 'EXPIRED'],
      default: 'PENDING',
      index: true
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    loginCode: { type: String, index: true },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: true }
);

wechatLoginStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const WechatLoginStateModel: Model<WechatLoginStateDocument> =
  mongoose.models.WechatLoginState ||
  mongoose.model<WechatLoginStateDocument>('WechatLoginState', wechatLoginStateSchema);

export default WechatLoginStateModel;
