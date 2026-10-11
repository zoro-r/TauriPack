import mongoose, { Schema } from 'mongoose';

// The MongoDB _id index serializes order selection/creation across server processes.
const schema = new Schema({
  _id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  owner: String,
  leaseExpiresAt: Date,
  lastCreatedAt: Date
}, { timestamps: true });

export default mongoose.models.RechargeOrderGuard || mongoose.model('RechargeOrderGuard', schema);
