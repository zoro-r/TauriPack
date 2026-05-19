import mongoose, { Schema, type Document, type Model } from 'mongoose';

export type AppMediaKind = 'image' | 'video';

export interface AppMediaItem {
  type: AppMediaKind;
  url: string;
  poster?: string;
  caption?: string;
  sort?: number;
}

export interface AppItemDocument extends Document {
  name: string;
  slug: string;
  categoryId: mongoose.Types.ObjectId;
  accessLevel: 'login' | 'member' | 'explicit';
  summary?: string;
  description?: string;
  cover?: string;
  publisher?: string;
  content?: string;
  /** 结构化图文/视频，用于详情展示（按 sort 排序） */
  media: AppMediaItem[];
  packageName?: string;
  packageUrl?: string;
  entryUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const appMediaSubSchema = new Schema<AppMediaItem>(
  {
    type: { type: String, enum: ['image', 'video'], required: true },
    url: { type: String, required: true, trim: true },
    poster: { type: String, trim: true },
    caption: { type: String, trim: true },
    sort: { type: Number }
  },
  { _id: false }
);

const appItemSchema = new Schema<AppItemDocument>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true, trim: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'AppCategory', required: true, index: true },
    accessLevel: {
      type: String,
      enum: ['login', 'member', 'explicit'],
      default: 'login',
      index: true
    },
    summary: { type: String, trim: true },
    description: { type: String, trim: true },
    cover: { type: String, trim: true },
    publisher: { type: String, trim: true },
    content: { type: String, trim: true },
    media: { type: [appMediaSubSchema], default: [] },
    packageName: { type: String, trim: true },
    packageUrl: { type: String, trim: true },
    entryUrl: { type: String, trim: true }
  },
  { timestamps: true }
);

appItemSchema.index({ categoryId: 1, createdAt: -1 });
appItemSchema.index({ name: 'text', summary: 'text', description: 'text', publisher: 'text', content: 'text' });

const AppItemModel: Model<AppItemDocument> =
  mongoose.models.AppItem || mongoose.model<AppItemDocument>('AppItem', appItemSchema);

export default AppItemModel;
