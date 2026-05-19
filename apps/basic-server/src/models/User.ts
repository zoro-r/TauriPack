import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface UserDocument extends Document {
  wechatOpenId: string;
  wechatUnionId?: string;
  nickname?: string;
  avatar?: string;
  role: 'user' | 'admin';
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDocument>(
  {
    wechatOpenId: { type: String, required: true, unique: true, index: true },
    wechatUnionId: { type: String },
    nickname: { type: String },
    avatar: { type: String },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
      index: true
    }
  },
  { timestamps: true }
);

const UserModel: Model<UserDocument> =
  mongoose.models.User || mongoose.model<UserDocument>('User', userSchema);

export default UserModel;
