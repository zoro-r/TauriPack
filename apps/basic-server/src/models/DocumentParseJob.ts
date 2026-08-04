import mongoose, { Schema, type Document, type Model } from 'mongoose';

export type DocumentParseState = 'uploading' | 'pending' | 'running' | 'done' | 'failed';

export interface DocumentParseJobDocument extends Document {
  userId: mongoose.Types.ObjectId;
  apiKeyId: string;
  originalName: string;
  sourceUrl?: string;
  mineruBatchId?: string;
  mineruTaskId?: string;
  state: DocumentParseState;
  reservedCredits: number;
  chargedCredits?: number;
  chargedQuota?: number;
  totalPages?: number;
  resultUrl?: string;
  error?: string;
  settledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const documentParseJobSchema = new Schema<DocumentParseJobDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    apiKeyId: { type: String, required: true, index: true },
    originalName: { type: String, required: true, trim: true },
    sourceUrl: { type: String },
    mineruBatchId: { type: String, unique: true, sparse: true, index: true },
    mineruTaskId: { type: String, unique: true, sparse: true, index: true },
    state: { type: String, enum: ['uploading', 'pending', 'running', 'done', 'failed'], default: 'uploading', index: true },
    reservedCredits: { type: Number, required: true, min: 0 },
    chargedCredits: { type: Number, min: 0 },
    chargedQuota: { type: Number, min: 0 },
    totalPages: { type: Number, min: 0 },
    resultUrl: { type: String },
    error: { type: String },
    settledAt: { type: Date }
  },
  { timestamps: true }
);

documentParseJobSchema.index({ userId: 1, createdAt: -1 });

const DocumentParseJobModel: Model<DocumentParseJobDocument> =
  mongoose.models.DocumentParseJob ||
  mongoose.model<DocumentParseJobDocument>('DocumentParseJob', documentParseJobSchema);

export default DocumentParseJobModel;
