import crypto from 'crypto';
import ExcelJS from 'exceljs';
import RedeemBatchModel, { type RedeemBatchStatus } from '@/models/RedeemBatch';
import RedeemCodeModel from '@/models/RedeemCode';
import RedeemRecordModel from '@/models/RedeemRecord';
import MemberPlanModel from '@/models/MemberPlan';
import MemberAccountModel from '@/models/MemberAccount';
import MemberBenefitLogModel from '@/models/MemberBenefitLog';
import MemberOrderModel from '@/models/MemberOrder';
import AppItemModel from '@/models/AppItem';
import UserAppEntitlementModel from '@/models/UserAppEntitlement';
import UserModel from '@/models/User';

export interface RedeemBatchInput {
  name: string;
  codePrefix?: string;
  status?: RedeemBatchStatus;
  grantType?: 'member' | 'app';
  planId?: string;
  appId?: string;
  appDurationDays?: number;
  userVisibleTitle: string;
  userVisibleDescription?: string;
  expiresAt?: string;
  remark?: string;
}

export interface RedeemCodeListQuery {
  keyword?: string;
  status?: 'unused' | 'used' | 'expired' | 'disabled';
  batchId?: string;
  grantType?: 'member' | 'app';
}


export interface RedeemPreviewResult {
  code: string;
  grantType: 'member' | 'app';
  batchName: string;
  ownership?: {
    alreadyOwned: boolean;
    statusText: string;
    currentExpiredAt?: string;
    nextExpiredAt?: string;
  };
  benefit: {
    title?: string;
    description?: string;
    durationDays?: number;
    durationLabel?: string;
    appName?: string;
    expiredAt?: string;
  };
}

const createRandomCode = (prefix?: string) => {
  const code = crypto.randomBytes(10).toString('hex').toUpperCase();
  const normalizedPrefix = prefix?.trim().toUpperCase();
  return normalizedPrefix ? `${normalizedPrefix}-${code}` : code;
};

const isDuplicateKeyError = (error: unknown) => {
  const mongoError = error as { code?: number; writeErrors?: Array<{ code?: number }> };
  return (
    mongoError.code === 11000 ||
    (Array.isArray(mongoError.writeErrors) && mongoError.writeErrors.length > 0 && mongoError.writeErrors.every((item) => item.code === 11000))
  );
};

const buildOrderNo = () => `MB${Date.now()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

const buildGrantSnapshot = async (grantType: 'member' | 'app', input: RedeemBatchInput) => {
  if (grantType === 'member') {
    if (!input.planId) {
      throw new Error('planId is required');
    }
    const plan = await MemberPlanModel.findById(input.planId).lean();
    if (!plan) {
      throw new Error('plan not found');
    }
    return {
      plan,
      snapshot: {
        memberLevel: 'vip',
        durationDays: plan.durationDays,
        title: plan.name,
        description: plan.description
      }
    };
  }

  if (!input.appId) {
    throw new Error('appId is required');
  }
  const appDurationDays = Number(input.appDurationDays) || 0;
  if (appDurationDays <= 0) {
    throw new Error('appDurationDays is required');
  }
  const app = await AppItemModel.findById(input.appId).lean();
  if (!app) {
    throw new Error('app not found');
  }
  if (app.accessLevel !== 'explicit') {
    throw new Error('only explicit apps can be bound to app redeem batches');
  }
  return {
    app,
    snapshot: {
      appId: app._id.toString(),
      appName: app.name,
      appSlug: app.slug,
      appDurationDays,
      title: app.name,
      description: app.summary || app.description
    }
  };
};

export const listRedeemBatches = async () => {
  return RedeemBatchModel.find()
    .populate('planId', 'name code price durationDays')
    .populate('appId', 'name slug accessLevel')
    .sort({ createdAt: -1 })
    .lean();
};

export const createRedeemBatch = async (input: RedeemBatchInput, createdBy?: string) => {
  const name = String(input.name || '').trim();
  const userVisibleTitle = String(input.userVisibleTitle || '').trim();
  if (!name) {
    throw new Error('name is required');
  }
  if (!userVisibleTitle) {
    throw new Error('userVisibleTitle is required');
  }
  const grantType = input.grantType || 'member';
  const { snapshot } = await buildGrantSnapshot(grantType, input);
  return RedeemBatchModel.create({
    name,
    codePrefix: input.codePrefix?.trim(),
    status: input.status || 'draft',
    grantType,
    planId: input.planId,
    appId: input.appId,
    grantSnapshot: snapshot,
    userVisibleTitle,
    userVisibleDescription: input.userVisibleDescription?.trim(),
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
    remark: input.remark?.trim(),
    createdBy
  });
};

export const updateRedeemBatch = async (id: string, input: RedeemBatchInput) => {
  const batch = await RedeemBatchModel.findById(id);
  if (!batch) {
    throw new Error('batch not found');
  }
  const grantType = input.grantType || batch.grantType || 'member';
  const { snapshot } = await buildGrantSnapshot(grantType, {
    ...input,
    planId: input.planId || batch.planId?.toString(),
    appId: input.appId || batch.appId?.toString()
  });
  batch.name = String(input.name || batch.name).trim();
  batch.codePrefix = input.codePrefix?.trim();
  batch.status = input.status || batch.status;
  batch.grantType = grantType;
  if (input.planId) {
    batch.planId = input.planId as any;
  } else if (grantType === 'app') {
    batch.planId = undefined;
  }
  if (input.appId) {
    batch.appId = input.appId as any;
  } else if (grantType === 'member') {
    batch.appId = undefined;
  }
  batch.grantSnapshot = snapshot;
  batch.userVisibleTitle = String(input.userVisibleTitle || batch.userVisibleTitle).trim();
  batch.userVisibleDescription = input.userVisibleDescription?.trim();
  batch.expiresAt = input.expiresAt ? new Date(input.expiresAt) : batch.expiresAt;
  batch.remark = input.remark?.trim();
  await batch.save();
  return batch;
};

export const generateRedeemCodes = async (batchId: string, count: number) => {
  const batch = await RedeemBatchModel.findById(batchId);
  if (!batch) {
    throw new Error('batch not found');
  }
  const total = Math.max(Math.min(Number(count) || 0, 500), 1);
  // `unique: true` is only a schema declaration until MongoDB creates the index.
  // Wait for it here so concurrent generation requests cannot persist a duplicate code.
  await RedeemCodeModel.init();

  const created: Array<{ _id: unknown }> = [];
  const maxAttempts = 10;

  for (let attempt = 0; created.length < total && attempt < maxAttempts; attempt += 1) {
    const candidates = new Set<string>();
    const needed = total - created.length;
    while (candidates.size < needed) {
      candidates.add(createRandomCode(batch.codePrefix));
    }

    const existing = await RedeemCodeModel.find({ code: { $in: [...candidates] } }).select('code').lean();
    const existingCodes = new Set(existing.map((item) => item.code));
    const docs = [...candidates]
      .filter((code) => !existingCodes.has(code))
      .map((code) => ({
        code,
        batchId: batch._id,
        status: 'unused' as const,
        expiresAt: batch.expiresAt,
        source: 'generated' as const
      }));

    if (!docs.length) {
      continue;
    }

    try {
      created.push(...(await RedeemCodeModel.insertMany(docs, { ordered: false })));
    } catch (error) {
      const insertError = error as { insertedDocs?: Array<{ _id: unknown }> };
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      // Unordered writes keep non-conflicting codes. Retry only the remainder.
      created.push(...(insertError.insertedDocs || []));
    }
  }

  if (created.length !== total) {
    throw new Error('failed to generate unique redeem codes');
  }

  await RedeemBatchModel.updateOne({ _id: batch._id }, { $inc: { totalCount: created.length } });
  return created;
};

const REDEEM_CODES_EXPORT_MAX_ROWS = 25_000;

export const buildRedeemCodesFilter = async (query: RedeemCodeListQuery = {}) => {
  const keyword = query.keyword?.trim();
  const filter: Record<string, unknown> = {};

  if (query.status) {
    filter.status = query.status;
  }
  if (query.batchId) {
    filter.batchId = query.batchId;
  }
  if (keyword) {
    filter.code = { $regex: keyword, $options: 'i' };
  }
  if (query.grantType) {
    const batches = await RedeemBatchModel.find({ grantType: query.grantType }).select('_id').lean();
    filter.batchId = {
      $in: batches.map((item) => item._id)
    };
    if (query.batchId) {
      filter.batchId = query.batchId;
    }
  }

  return filter;
};

export const listRedeemCodes = async (query: RedeemCodeListQuery & { page?: string | number; pageSize?: string | number } = {}) => {
  const filter = await buildRedeemCodesFilter(query);

  let page = Math.max(1, Math.floor(Number(query.page)) || 1);
  let pageSize = Math.floor(Number(query.pageSize)) || 20;
  pageSize = Math.min(100, Math.max(5, pageSize));

  const total = await RedeemCodeModel.countDocuments(filter);
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  page = Math.min(page, totalPages);

  const list = await RedeemCodeModel.find(filter)
    .populate('batchId', 'name status userVisibleTitle expiresAt grantType')
    .populate('usedBy', 'nickname wechatOpenId')
    .sort({ createdAt: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .lean();

  return { list, total, page, pageSize };
};

const redeemCodeStatusLabel = (status: string) => {
  if (status === 'used') return '已使用';
  if (status === 'expired') return '已过期';
  if (status === 'disabled') return '已停用';
  return '未使用';
};

/** 将单条 Mongoose lean 兑换码转成 Excel 列对象 */
const redeemCodeRowToExportFields = (row: any) => {
  const batch = typeof row.batchId === 'object' && row.batchId ? row.batchId : null;
  const user = typeof row.usedBy === 'object' && row.usedBy ? row.usedBy : null;
  const grantLabel = batch?.grantType === 'app' ? '单应用' : '会员';

  const usedAt =
    row.usedAt instanceof Date
      ? row.usedAt.toISOString().replace('T', ' ').slice(0, 19)
      : row.usedAt
        ? String(row.usedAt)
        : '';

  let expiresAt = '';
  if (row.expiresAt instanceof Date) {
    expiresAt = row.expiresAt.toISOString().replace('T', ' ').slice(0, 19);
  } else if (row.expiresAt) {
    expiresAt = String(row.expiresAt);
  }

  const batchName =
    typeof batch?.name === 'string' && batch.name
      ? batch.name
      : typeof batch?.userVisibleTitle === 'string' && batch.userVisibleTitle
        ? batch.userVisibleTitle
        : '';

  return {
    code: row.code ?? '',
    statusLabel: redeemCodeStatusLabel(String(row.status || '')),
    batchName,
    grantLabel,
    nickname: user?.nickname || '',
    openId: user?.wechatOpenId || '',
    usedAt,
    expiresAt
  };
};

export const buildRedeemCodesExportXlsx = async (query: RedeemCodeListQuery = {}) => {
  const filter = await buildRedeemCodesFilter(query);
  const total = await RedeemCodeModel.countDocuments(filter);
  const rows = await RedeemCodeModel.find(filter)
    .populate('batchId', 'name status userVisibleTitle expiresAt grantType')
    .populate('usedBy', 'nickname wechatOpenId')
    .sort({ createdAt: -1 })
    .limit(REDEEM_CODES_EXPORT_MAX_ROWS)
    .lean();

  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('兑换码', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  sheet.columns = [
    { header: '兑换码', key: 'code', width: 28 },
    { header: '状态', key: 'statusLabel', width: 12 },
    { header: '所属活动', key: 'batchName', width: 28 },
    { header: '权益类型', key: 'grantLabel', width: 12 },
    { header: '使用人', key: 'nickname', width: 16 },
    { header: '用户标识', key: 'openId', width: 32 },
    { header: '使用时间', key: 'usedAt', width: 22 },
    { header: '过期时间', key: 'expiresAt', width: 22 }
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };

  for (const row of rows) {
    sheet.addRow(redeemCodeRowToExportFields(row));
  }

  const rawBuf = await workbook.xlsx.writeBuffer();

  return {
    buffer: Buffer.from(rawBuf),
    rowCount: rows.length,
    totalMatching: total,
    truncated: total > rows.length
  };
};

const normalizeMemberAccount = async (userId: string) => {
  const account = await MemberAccountModel.findOne({ userId });
  if (!account) {
    return null;
  }
  if (account.expiredAt && account.expiredAt.getTime() < Date.now() && account.status !== 'expired') {
    account.status = 'expired';
    account.isMember = false;
    await account.save();
  }
  return account;
};

const getRedeemContext = async (code: string) => {
  const normalizedCode = code.trim().toUpperCase();
  const redeemCodeDoc = await RedeemCodeModel.findOne({ code: normalizedCode });
  if (!redeemCodeDoc) {
    throw new Error('兑换码不存在');
  }
  if (redeemCodeDoc.status !== 'unused') {
    throw new Error('兑换码不可用');
  }
  if (redeemCodeDoc.expiresAt && redeemCodeDoc.expiresAt.getTime() < Date.now()) {
    redeemCodeDoc.status = 'expired';
    await redeemCodeDoc.save();
    throw new Error('兑换码已过期');
  }

  const batch = await RedeemBatchModel.findById(redeemCodeDoc.batchId);
  if (!batch) {
    throw new Error('兑换批次不存在');
  }
  if (batch.status !== 'active') {
    throw new Error('兑换批次不可用');
  }
  if (batch.expiresAt && batch.expiresAt.getTime() < Date.now()) {
    throw new Error('兑换活动已过期');
  }

  return { normalizedCode, redeemCodeDoc, batch };
};

export const previewRedeemCode = async (userId: string, code: string): Promise<RedeemPreviewResult> => {
  const user = await UserModel.findById(userId).lean();
  if (!user) {
    throw new Error('user not found');
  }

  const { normalizedCode, batch } = await getRedeemContext(code);

  if (batch.grantType === 'app') {
    const appId = batch.appId?.toString() || batch.grantSnapshot.appId;
    if (!appId) {
      throw new Error('兑换应用未配置');
    }
    const app = await AppItemModel.findById(appId).lean();
    if (!app) {
      throw new Error('兑换应用不存在');
    }
    const now = new Date();
    const existingEntitlement = await UserAppEntitlementModel.findOne({
      userId,
      appId: app._id,
      status: 'active'
    }).lean();
    const currentExpiredAt =
      existingEntitlement?.expiredAt && existingEntitlement.expiredAt.getTime() > now.getTime()
        ? existingEntitlement.expiredAt
        : undefined;
    const baseDate = currentExpiredAt && currentExpiredAt.getTime() > now.getTime() ? currentExpiredAt : now;
    const nextExpiredAt = new Date(
      baseDate.getTime() + (batch.grantSnapshot.appDurationDays || 0) * 24 * 60 * 60 * 1000
    );
    return {
      code: normalizedCode,
      grantType: 'app',
      batchName: batch.name,
      ownership: {
        alreadyOwned: Boolean(currentExpiredAt),
        statusText: currentExpiredAt ? '当前已拥有该应用权限，本次兑换将续期' : '当前未拥有该应用权限，本次兑换将立即开通',
        currentExpiredAt: currentExpiredAt?.toISOString(),
        nextExpiredAt: nextExpiredAt.toISOString()
      },
      benefit: {
        title: app.name,
        description:
          app.summary ||
          app.description ||
          batch.userVisibleDescription ||
          '兑换成功后可获得该应用的访问权限',
        appName: app.name,
        durationDays: batch.grantSnapshot.appDurationDays,
        durationLabel: `${batch.grantSnapshot.appDurationDays || 0} 天`
      }
    };
  }

  const account = await normalizeMemberAccount(userId);
  const beforeExpiredAt = account?.expiredAt;
  const now = new Date();
  const baseDate =
    beforeExpiredAt && beforeExpiredAt.getTime() > now.getTime() ? beforeExpiredAt : now;
  const nextExpiredAt = new Date(
    baseDate.getTime() + (batch.grantSnapshot.durationDays || 0) * 24 * 60 * 60 * 1000
  );

  return {
    code: normalizedCode,
    grantType: 'member',
    batchName: batch.name,
    ownership: {
      alreadyOwned: Boolean(beforeExpiredAt && beforeExpiredAt.getTime() > now.getTime()),
      statusText:
        beforeExpiredAt && beforeExpiredAt.getTime() > now.getTime()
          ? '当前会员仍在有效期内，本次兑换将顺延时长'
          : '当前会员未开通或已过期，本次兑换将立即开通',
      currentExpiredAt: beforeExpiredAt?.toISOString(),
      nextExpiredAt: nextExpiredAt.toISOString()
    },
    benefit: {
      title: batch.userVisibleTitle || batch.grantSnapshot.title,
      description: batch.userVisibleDescription || batch.grantSnapshot.description,
      durationDays: batch.grantSnapshot.durationDays,
      durationLabel: `${batch.grantSnapshot.durationDays || 0} 天`,
      expiredAt: nextExpiredAt.toISOString()
    }
  };
};

export const redeemCode = async (userId: string, code: string) => {
  const user = await UserModel.findById(userId).lean();
  if (!user) {
    throw new Error('user not found');
  }
  const { redeemCodeDoc, batch } = await getRedeemContext(code);

  if (batch.grantType === 'app') {
    const appId = batch.appId?.toString() || batch.grantSnapshot.appId;
    if (!appId) {
      throw new Error('兑换应用未配置');
    }
    const app = await AppItemModel.findById(appId).lean();
    if (!app) {
      throw new Error('兑换应用不存在');
    }
    const appDurationDays = batch.grantSnapshot.appDurationDays || 0;
    if (appDurationDays <= 0) {
      throw new Error('兑换应用时长未配置');
    }
    const now = new Date();
    const existingEntitlement = await UserAppEntitlementModel.findOne({
      userId: user._id,
      appId: app._id,
      status: 'active'
    });
    const currentExpiredAt =
      existingEntitlement?.expiredAt && existingEntitlement.expiredAt.getTime() > now.getTime()
        ? existingEntitlement.expiredAt
        : undefined;
    const entitlementBaseDate =
      currentExpiredAt && currentExpiredAt.getTime() > now.getTime() ? currentExpiredAt : now;
    const entitlementExpiredAt = new Date(
      entitlementBaseDate.getTime() + appDurationDays * 24 * 60 * 60 * 1000
    );

    redeemCodeDoc.status = 'used';
    redeemCodeDoc.usedBy = user._id as any;
    redeemCodeDoc.usedAt = new Date();
    await redeemCodeDoc.save();

    batch.usedCount += 1;
    await batch.save();

    const order = await MemberOrderModel.create({
      orderNo: buildOrderNo(),
      userId: user._id,
      orderType: 'app',
      bizId: app._id,
      amount: 0,
      status: 'paid',
      payChannel: 'redeem_code',
      paidAt: new Date(),
      title: batch.userVisibleTitle || app.name,
      description: `兑换码兑换应用：${redeemCodeDoc.code}`,
      snapshot: {
        code: redeemCodeDoc.code,
        batchId: batch._id.toString(),
        batchName: batch.name,
        grantType: 'app',
        grantSnapshot: batch.grantSnapshot,
        appId: app._id.toString(),
        appName: app.name,
        appSlug: app.slug,
        userVisibleTitle: batch.userVisibleTitle,
        userVisibleDescription: batch.userVisibleDescription
      }
    });

    const record = await RedeemRecordModel.create({
      codeId: redeemCodeDoc._id,
      batchId: batch._id,
      userId: user._id,
      grantType: 'app',
      grantSnapshot: batch.grantSnapshot,
      result: 'success'
    });

    const entitlement =
      existingEntitlement ||
      new UserAppEntitlementModel({
        userId: user._id,
        appId: app._id
      });
    entitlement.status = 'active';
    entitlement.sourceType = 'redeem';
    entitlement.sourceOrderId = order._id as any;
    entitlement.sourceRedeemRecordId = record._id as any;
    entitlement.grantedAt = now;
    entitlement.expiredAt = entitlementExpiredAt;
    await entitlement.save();

    return {
      success: true,
      message: '兑换成功',
      benefit: {
        title: app.name,
        description:
          app.summary ||
          app.description ||
          batch.userVisibleDescription ||
          `${app.name} 权限已到账`,
        expiredAt: entitlementExpiredAt.toISOString()
      }
    };
  }

  const account = await normalizeMemberAccount(userId);
  const beforeExpiredAt = account?.expiredAt;
  const now = new Date();
  const baseDate =
    beforeExpiredAt && beforeExpiredAt.getTime() > now.getTime() ? beforeExpiredAt : now;
  const nextExpiredAt = new Date(
    baseDate.getTime() + (batch.grantSnapshot.durationDays || 0) * 24 * 60 * 60 * 1000
  );

  const nextAccount =
    account ||
    new MemberAccountModel({
      userId
    });
  nextAccount.isMember = true;
  nextAccount.memberLevel = batch.grantSnapshot.memberLevel || 'vip';
  nextAccount.startedAt = account?.startedAt || now;
  nextAccount.expiredAt = nextExpiredAt;
  nextAccount.status = 'active';
  await nextAccount.save();

  redeemCodeDoc.status = 'used';
  redeemCodeDoc.usedBy = user._id as any;
  redeemCodeDoc.usedAt = new Date();
  await redeemCodeDoc.save();

  batch.usedCount += 1;
  await batch.save();

  const order = await MemberOrderModel.create({
    orderNo: buildOrderNo(),
    userId: user._id,
    orderType: 'redeem',
    bizId: batch.planId,
    planId: batch.planId,
    amount: 0,
    status: 'paid',
    payChannel: 'redeem_code',
    paidAt: new Date(),
    title: batch.userVisibleTitle || batch.grantSnapshot.title,
    description: `兑换码兑换：${redeemCodeDoc.code}`,
    snapshot: {
      code: redeemCodeDoc.code,
      batchId: batch._id.toString(),
      batchName: batch.name,
      grantType: 'member',
      grantSnapshot: batch.grantSnapshot,
      userVisibleTitle: batch.userVisibleTitle,
      userVisibleDescription: batch.userVisibleDescription
    }
  });

  const record = await RedeemRecordModel.create({
    codeId: redeemCodeDoc._id,
    batchId: batch._id,
    userId: user._id,
    grantType: 'member',
    grantSnapshot: batch.grantSnapshot,
    beforeExpiredAt,
    afterExpiredAt: nextExpiredAt,
    result: 'success'
  });

  await MemberBenefitLogModel.create({
    userId: user._id,
    orderId: order._id,
    type: beforeExpiredAt ? 'renew' : 'open',
    beforeExpiredAt,
    afterExpiredAt: nextExpiredAt,
    remark: `兑换码发放：${batch.userVisibleTitle}`
  });

  return {
    success: true,
    message: '兑换成功',
    benefit: {
      title: batch.userVisibleTitle,
      description: batch.userVisibleDescription,
      expiredAt: nextExpiredAt
    }
  };
};
