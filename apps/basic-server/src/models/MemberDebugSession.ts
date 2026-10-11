import mongoose, { Schema } from 'mongoose';

// No TTL index: retain the operator/target audit record after the session expires.
const schema = new Schema({
  sessionId: { type: String, required: true, unique: true },
  actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  targetUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  parentSessionId: { type: String, required: true },
  ip: String,
  userAgent: String,
  expiresAt: { type: Date, required: true },
  endedAt: Date
}, { timestamps: true });
schema.index({ actorUserId: 1, createdAt: -1 });
export default mongoose.models.MemberDebugSession || mongoose.model('MemberDebugSession', schema);
