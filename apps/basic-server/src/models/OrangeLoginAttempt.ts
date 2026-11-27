import mongoose, { Schema } from 'mongoose';

interface OrangeLoginAttempt {
  _id: string;
  orangeUserId: string;
  bindingHash: string;
  expiresAt: Date;
}

const schema = new Schema<OrangeLoginAttempt>({
  _id: { type: String, required: true },
  orangeUserId: { type: String, required: true },
  bindingHash: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true }
});

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<OrangeLoginAttempt>('OrangeLoginAttempt', schema);
