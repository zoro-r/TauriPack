import AppCategoryModel from '@/models/AppCategory';

/** 会员自助上架默认分类（slug 固定，首次使用时自动创建） */
export const MEMBER_UPLOAD_CATEGORY_SLUG = 'my-apps';

export const ensureMemberUploadCategoryId = async (): Promise<string> => {
  const existing = await AppCategoryModel.findOne({ slug: MEMBER_UPLOAD_CATEGORY_SLUG }).lean();
  if (existing) {
    return existing._id.toString();
  }
  try {
    const created = await AppCategoryModel.create({
      name: '我的应用',
      slug: MEMBER_UPLOAD_CATEGORY_SLUG,
      description: '会员自助上架应用默认分类',
      sort: 999,
      isActive: true
    });
    return created._id.toString();
  } catch {
    const again = await AppCategoryModel.findOne({ slug: MEMBER_UPLOAD_CATEGORY_SLUG }).lean();
    if (again) {
      return again._id.toString();
    }
    throw new Error('创建默认分类「我的应用」失败');
  }
};
