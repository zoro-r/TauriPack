import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface AppCategoryDocument extends Document {
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  sort: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const appCategorySchema = new Schema<AppCategoryDocument>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true, trim: true },
    description: { type: String, trim: true },
    icon: { type: String, trim: true },
    sort: { type: Number, default: 0, index: true },
    isActive: { type: Boolean, default: true, index: true }
  },
  { timestamps: true }
);

appCategorySchema.index({ isActive: 1, sort: 1, createdAt: -1 });

const AppCategoryModel: Model<AppCategoryDocument> =
  mongoose.models.AppCategory ||
  mongoose.model<AppCategoryDocument>('AppCategory', appCategorySchema);

export default AppCategoryModel;
