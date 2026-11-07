import mongoose, { Schema } from 'mongoose';

// Private server-side credentials. Never join this collection into account responses.
const schema = new Schema({
  _id: { type: String, required: true },
  encryptedSession: { type: String, select: false },
  leaseOwner: { type: String, select: false },
  leaseUntil: { type: Date, select: false }
}, { timestamps: true });

export default mongoose.models.NewApiManagedSession || mongoose.model('NewApiManagedSession', schema);
