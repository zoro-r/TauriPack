import mongoose, { Schema, type Document, type Model } from 'mongoose';

export type AppTemporaryLinkStatus = 'active' | 'revoked';

export interface AppTemporaryLinkDocument extends Document {
  appId: mongoose.Types.ObjectId;
  ownerUserId: mongoose.Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  status: AppTemporaryLinkStatus;
  remark?: string;
  visitCount: number;
  lastVisitedAt?: Date;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const appTemporaryLinkSchema = new Schema<AppTemporaryLinkDocument>(
  {
    appId: { type: Schema.Types.ObjectId, ref: 'AppItem', required: true, index: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ['active', 'revoked'],
      default: 'active',
      index: true
    },
    remark: { type: String, trim: true },
    visitCount: { type: Number, default: 0, min: 0 },
    lastVisitedAt: { type: Date },
    revokedAt: { type: Date }
  },
  { timestamps: true }
);

appTemporaryLinkSchema.index({ appId: 1, ownerUserId: 1, createdAt: -1 });

const AppTemporaryLinkModel: Model<AppTemporaryLinkDocument> =
  mongoose.models.AppTemporaryLink ||
  mongoose.model<AppTemporaryLinkDocument>('AppTemporaryLink', appTemporaryLinkSchema);

export default AppTemporaryLinkModel;
