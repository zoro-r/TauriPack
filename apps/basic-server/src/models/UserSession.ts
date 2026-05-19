import mongoose, { Schema, type Document, type Model } from 'mongoose';

export type UserSessionStatus = 'active' | 'revoked';

export interface UserSessionDocument extends Document {
  userId: mongoose.Types.ObjectId;
  sessionId: string;
  deviceId?: string;
  deviceType?: string;
  userAgent?: string;
  ip?: string;
  status: UserSessionStatus;
  lastActiveAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSessionSchema = new Schema<UserSessionDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sessionId: { type: String, required: true, unique: true, index: true },
    deviceId: { type: String, index: true },
    deviceType: { type: String },
    userAgent: { type: String },
    ip: { type: String },
    status: {
      type: String,
      enum: ['active', 'revoked'],
      default: 'active',
      index: true
    },
    lastActiveAt: { type: Date, required: true, default: () => new Date() },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date }
  },
  { timestamps: true }
);

userSessionSchema.index({ userId: 1, status: 1, lastActiveAt: -1 });
userSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const UserSessionModel: Model<UserSessionDocument> =
  mongoose.models.UserSession ||
  mongoose.model<UserSessionDocument>('UserSession', userSessionSchema);

export default UserSessionModel;
