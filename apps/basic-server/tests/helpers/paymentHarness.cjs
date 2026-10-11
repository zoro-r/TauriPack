const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '../../src');
const copy = row => row && {...row, snapshot: row.snapshot && {...row.snapshot}};
const comparable = value => value?.getTime ? value.getTime() : String(value);
function matches(row, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some(condition => matches(row, condition));
    const actual = row[key];
    if (value && typeof value === 'object' && Object.keys(value).some(key => key.startsWith('$'))) {
      return Object.entries(value).every(([operator, expected]) => {
        if (operator === '$exists') return (actual !== undefined) === expected;
        if (operator === '$in') return expected.includes(actual);
        if (operator === '$gt') return actual !== undefined && comparable(actual) > comparable(expected);
        if (operator === '$lte') return actual !== undefined && comparable(actual) <= comparable(expected);
        throw new Error(`unmocked operator ${operator}`);
      });
    }
    return comparable(actual) === comparable(value);
  });
}
function update(row, changes) {
  Object.assign(row, changes.$set);
  for (const key of Object.keys(changes.$unset || {})) delete row[key];
}
function query(getRows) {
  let limit = Infinity;
  const result = {sort: () => result, limit: n => {limit = n; return result;}, populate: () => result,
    lean: async () => getRows().slice(0, limit).map(copy),
    then: (resolve, reject) => Promise.resolve(getRows().slice(0, limit).map(copy)).then(resolve, reject)};
  return result;
}
function load(file, mocks) {
  const context = {exports:{}, Buffer, process:{env:{WECHAT_PAY_APPID:'app-test',WECHAT_PAY_MCHID:'merchant-test'}}, console:{info(){},error(){}},
    setInterval, clearInterval, require: name => {
      if (mocks[name]) return mocks[name];
      if (name === 'crypto') return require('node:crypto');
      if (name === 'mongoose') return {Types:{ObjectId: class {constructor(value){this.value=value;} toString(){return this.value;}}}};
      return {};
    }};
  vm.runInNewContext(ts.transpile(fs.readFileSync(path.join(root,file), 'utf8'),
    {module:ts.ModuleKind.CommonJS, esModuleInterop:true, target:ts.ScriptTarget.ES2020}), context);
  return context.exports;
}
function setup(options = {}) {
  const rows = [];
  const guards = [];
  const events = [];
  const credits = new Set();
  let wechatCalls = 0;
  let closes = 0;
  const missing = () => Object.assign(new Error('order missing'), {code:'ORDER_NOT_EXIST'});
  const Order = {
    init: async () => {},
    find: filter => query(() => rows.filter(row => matches(row, filter))),
    findOne: async filter => copy(rows.find(row => matches(row, filter))),
    findById: async id => copy(rows.find(row => String(row._id) === String(id))),
    create: async row => {
      events.push('local-create');
      if (options.createError) throw new Error('local insert failed');
      if (rows.some(other => other.status === 'pending' && other.userId === row.userId &&
        (other.rechargeKey === row.rechargeKey || other.rechargeSlot === row.rechargeSlot))) throw Object.assign(new Error('duplicate'), {code:11000});
      const stored = {_id:`order-${rows.length}`, createdAt:new Date(), ...row};
      rows.push(stored); return copy(stored);
    },
    findOneAndUpdate: async (filter, change, config) => {
      const row = rows.find(item => matches(item, filter));
      if (!row) return null;
      if (change.$set.wechatPrepayCodeUrl && options.updateError) throw new Error('QR save failed');
      const previous = copy(row); update(row, change);
      return config.new ? copy(row) : previous;
    },
    updateOne: async (filter, change) => {
      const row = rows.find(item => matches(item, filter));
      if (row) update(row, change);
      return {matchedCount:row ? 1 : 0};
    },
    aggregate: async () => rows.filter(row => row.status === 'paid' && !credits.has(row._id)).map(copy)
  };
  const Guard = {
    findOneAndUpdate: async (filter, change) => {
      let row = guards.find(item => matches(item, filter));
      if (!row && guards.some(item => String(item._id) === String(filter._id))) throw Object.assign(new Error('duplicate guard'), {code:11000});
      if (!row) {row={_id:filter._id}; guards.push(row);}
      update(row, change); return copy(row);
    },
    updateOne: async (filter, change) => {
      const row = guards.find(item => matches(item, filter));
      if (row) update(row, change);
      return {matchedCount:row ? 1 : 0};
    }
  };
  const wechat = {
    createNativeWechatPayOrder: async payload => {
      wechatCalls++; events.push('wechat-create');
      const row = rows.find(item => item.orderNo === payload.outTradeNo);
      if (!row) throw new Error('missing local order before WeChat');
      if (options.wechatError) throw new Error('wechat timeout');
      if (options.concurrentPaid) {row.status='paid';row.wechatTransactionId='tx-test';}
      return 'weixin://test-qr';
    },
    queryWechatPayOrder: async () => {
      if (options.queryError) throw new Error('query timeout');
      if (options.queryMissing) throw missing();
      return options.queryResult || {trade_state:'NOTPAY'};
    },
    closeWechatPayOrder: async () => {closes++; if (options.closeError) throw new Error('close failed');}
  };
  const mocks = {'@/models/MemberOrder':Order, '@/models/RechargeOrderGuard':Guard,
    '@/services/wechatPayService':wechat, '@/models/NewApiRecharge':{collection:{name:'newapirecharges'},init:async()=>{}},
    '@/services/newApiService':{createNewApiRechargeOrder:async (_,amount) => ({amount, quota:amount*500000,remoteUserId:'123'}),
      creditNewApiRecharge:async input => {credits.add(input.orderId);}}};
  const payment = load('services/wechatPaymentStateService.ts', mocks);
  mocks['@/services/wechatPaymentStateService'] = payment;
  const recharge = load('services/rechargeOrderService.ts', mocks);
  mocks['@/services/rechargeOrderService'] = recharge;
  const recovery = load('services/newApiRechargeRecoveryService.ts', mocks);
  const member = load('services/memberService.ts', mocks);
  return {...payment,...recharge,...recovery,...member,rows,guards,events,credits, options,
    wechatCalls:()=>wechatCalls,closes:()=>closes,
    create:(amount=30,userId='698433ea0cda17ab9fdcd420')=>recharge.createOrReuseApiRechargeOrder(userId,amount),
    resetCadence:()=>guards.forEach(row=>{row.lastCreatedAt=new Date(0);})};
}
module.exports = {setup, load};
