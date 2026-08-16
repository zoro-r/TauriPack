import mongoose, { Schema, type Document, type Model } from 'mongoose';

export type MemberPlanType = 'membership' | 'app_slot';
export type MemberPlanPurchaseLimit = 'unlimited' | 'once';

export interface MemberPlanDocument extends Document {
  name: string;
  code: string;
  price: number;
  originalPrice?: number;
  durationDays: number;
  planType: MemberPlanType;
  slotCount: number;
  purchaseLimit: MemberPlanPurchaseLimit;
  description?: string;
  isActive: boolean;
  isVisibleToUser: boolean;
  sort: number;
  createdAt: Date;
  updatedAt: Date;
}

const memberPlanSchema = new Schema<MemberPlanDocument>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, index: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    originalPrice: { type: Number, min: 0 },
    durationDays: { type: Number, required: true, min: 0 },
    planType: { type: String, enum: ['membership', 'app_slot'], default: 'membership', index: true },
    slotCount: { type: Number, default: 0, min: 0 },
    purchaseLimit: { type: String, enum: ['unlimited', 'once'], default: 'unlimited' },
    description: { type: String, trim: true },
    isActive: { type: Boolean, default: true, index: true },
    isVisibleToUser: { type: Boolean, default: true, index: true },
    sort: { type: Number, default: 0, index: true }
  },
  { timestamps: true }
);

memberPlanSchema.index({ isActive: 1, isVisibleToUser: 1, sort: 1, createdAt: -1 });

const MemberPlanModel: Model<MemberPlanDocument> =
  mongoose.models.MemberPlan ||
  mongoose.model<MemberPlanDocument>('MemberPlan', memberPlanSchema);

export default MemberPlanModel;
