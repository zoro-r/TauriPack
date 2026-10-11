const {test} = require('node:test');
const assert = require('node:assert/strict');
const {setup} = require('./helpers/paymentHarness.cjs');
const payment = order => ({orderNo:order.orderNo,transactionId:'tx-test',successTime:'2026-10-11T04:00:00Z',
  appid:'app-test',mchid:'merchant-test',amount:{total:Math.round(order.amount*100),currency:'CNY'}});

test('50 duplicate payment callbacks persist the same paid state and defer remote credit',async()=>{
  const env=setup();await env.create();
  const payload={...payment(env.rows[0]),tradeState:'SUCCESS'};
  await Promise.all(Array.from({length:50},()=>env.settleMemberOrderByWechatCallback(payload)));
  assert.equal(env.rows[0].status,'paid');assert.equal(env.rows[0].wechatTransactionId,'tx-test');
  assert.equal(env.credits.size,0);
  await env.recoverNewApiRecharges();assert.equal(env.credits.size,1);
});
test('concurrent close notification cannot overwrite payment success',async()=>{
  for(const closeFirst of [true,false]){
    const env=setup();await env.create();const order=env.rows[0];
    const paid=()=>env.recordWechatPayment(payment(order));
    const closed=()=>env.closeLocalWechatOrder(order.orderNo);
    await Promise.all(closeFirst?[closed(),paid()]:[paid(),closed()]);
    assert.equal(order.status,'paid');assert.equal(order.wechatTransactionId,'tx-test');
  }
});
test('late duplicate callback never restores a refunded order',async()=>{
  const env=setup();await env.create();const order=env.rows[0];
  await env.recordWechatPayment(payment(order));order.status='refunded';
  await env.settleMemberOrderByWechatCallback({...payment(order),tradeState:'SUCCESS'});
  assert.equal(order.status,'refunded');assert.equal(env.credits.size,0);
});
test('wrong merchant, app, amount, currency and transaction are rejected',async()=>{
  const env=setup();await env.create();const order=env.rows[0];
  for(const patch of [{appid:'wrong'},{mchid:'wrong'},{amount:{total:1,currency:'CNY'}},{amount:{total:3000,currency:'USD'}}]){
    await assert.rejects(env.recordWechatPayment({...payment(order),...patch}),/不一致/);
    assert.equal(order.status,'pending');
  }
  await env.recordWechatPayment(payment(order));
  await assert.rejects(env.recordWechatPayment({...payment(order),transactionId:'different'}),/流水/);
});
test('lost callback is recovered by active WeChat query, then credited',async()=>{
  const env=setup();await env.create();const order=env.rows[0];order.createdAt=new Date(0);
  env.options.queryResult={trade_state:'SUCCESS',transaction_id:'tx-test',appid:'app-test',mchid:'merchant-test',amount:{total:3000,currency:'CNY'}};
  await env.recoverNewApiRecharges();await env.recoverNewApiRecharges();
  assert.equal(order.status,'paid');assert.equal(env.credits.size,1);
});
test('expired unpaid order is closed remotely before releasing local slot',async()=>{
  const env=setup();await env.create();const order=env.rows[0];order.expiredAt=new Date(0);
  await env.reconcileRechargePayment({...order});assert.equal(env.closes(),1);assert.equal(order.status,'closed');
  env.resetCadence();await env.create();assert.equal(env.rows.length,2);
});
test('failed remote close does not release pending order',async()=>{
  const env=setup({closeError:true});await env.create();const order=env.rows[0];order.expiredAt=new Date(0);
  await assert.rejects(env.reconcileRechargePayment({...order}),/close failed/);assert.equal(order.status,'pending');
});
test('network query error is not evidence of expiry or nonpayment',async()=>{
  const env=setup({queryError:true});await env.create();const order=env.rows[0];order.expiredAt=new Date(0);
  await assert.rejects(env.reconcileRechargePayment({...order}),/query timeout/);assert.equal(order.status,'pending');assert.equal(env.closes(),0);
});
test('expired missing remote order only closes after any in-flight preparation expires',async()=>{
  const env=setup({queryMissing:true});await env.create();const order=env.rows[0];order.expiredAt=new Date(0);
  order.paymentPreparingUntil=new Date(Date.now()+90000);
  await assert.rejects(env.reconcileRechargePayment({...order}),/missing/);assert.equal(order.status,'pending');
  delete order.paymentPreparingUntil;await env.reconcileRechargePayment({...order});assert.equal(order.status,'closed');
});
test('stale recovery snapshot cannot close a currently preparing order',async()=>{
  const env=setup({queryMissing:true});await env.create();const order=env.rows[0];order.expiredAt=new Date(0);
  const snapshot={...order};order.paymentPreparingUntil=new Date(Date.now()+90000);
  await env.reconcileRechargePayment(snapshot);assert.equal(order.status,'pending');
});
