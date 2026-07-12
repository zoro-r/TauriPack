import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface NewApiAccountDocument extends Document {
  userId: mongoose.Types.ObjectId;
  newApiUserId: string;
  username: string;
  displayName?: string;
  status: 'provisioned' | 'sync_error';
  lastSyncedAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const newApiAccountSchema = new Schema<NewApiAccountDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
    },
    newApiUserId: { type: String, required: true, index: true },
    username: { type: String, required: true, unique: true, index: true },
    displayName: { type: String },
    status: {
      type: String,
      enum: ['provisioned', 'sync_error'],
      default: 'provisioned',
      index: true
    },
    lastSyncedAt: { type: Date },
    lastError: { type: String }
  },
  { timestamps: true }
);

const NewApiAccountModel: Model<NewApiAccountDocument> =
  mongoose.models.NewApiAccount ||
  mongoose.model<NewApiAccountDocument>('NewApiAccount', newApiAccountSchema);

export default NewApiAccountModel;
