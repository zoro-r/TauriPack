import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface DocumentApiKeyDocument extends Document {
  userId: mongoose.Types.ObjectId;
  newApiKeyId?: string;
  keyHash: string;
  name?: string;
  createdAt: Date;
  updatedAt: Date;
}

const documentApiKeySchema = new Schema<DocumentApiKeyDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    newApiKeyId: { type: String, unique: true, sparse: true, index: true },
    keyHash: { type: String, required: true, unique: true, index: true },
    name: { type: String, trim: true }
  },
  { timestamps: true }
);

const DocumentApiKeyModel: Model<DocumentApiKeyDocument> =
  mongoose.models.DocumentApiKey ||
  mongoose.model<DocumentApiKeyDocument>('DocumentApiKey', documentApiKeySchema);

export default DocumentApiKeyModel;
