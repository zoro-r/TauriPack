import mongoose, { Schema, type Model, type Document } from 'mongoose';

export interface CloudPackage {
  appSlug: string;
  appName: string;
  packageSize: number;
  status: 'uploading' | 'ready';
  createdAt: Date;
  previewExpiresAt: Date;
  previewUrl?: string;
  temporaryFileName?: string;
}
interface MemberCloudSpaceDocument extends Document { packages: CloudPackage[] }

// 一个账户一条文档：用单文档原子更新同时预占容量和创建上传记录，无需副本集事务。
const packageSchema = new Schema({
  appSlug: { type: String, required: true },
  appName: { type: String, required: true },
  packageSize: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['uploading', 'ready'], required: true },
  createdAt: { type: Date, required: true },
  previewExpiresAt: { type: Date, required: true },
  previewUrl: String,
  temporaryFileName: String
}, { _id: false });

const schema = new Schema<MemberCloudSpaceDocument>({
  _id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  packages: { type: [packageSchema], default: [] }
}, { timestamps: true });
schema.index({ 'packages.previewExpiresAt': 1 });

const MemberCloudSpaceModel: Model<MemberCloudSpaceDocument> = mongoose.models.MemberCloudSpace || mongoose.model<MemberCloudSpaceDocument>('MemberCloudSpace', schema);
export default MemberCloudSpaceModel;
