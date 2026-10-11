const {test} = require('node:test');
const assert = require('node:assert/strict');
const {setup} = require('./helpers/paymentHarness.cjs');

test('local order is durable before WeChat; repeated requests reuse the same QR', async () => {
  const env=setup();const first=await env.create();const second=await env.create();
  assert.deepEqual(env.events,['local-create','wechat-create']);
  assert.equal(first.id,second.id);assert.equal(env.rows.length,1);assert.equal(env.wechatCalls(),1);
});
test('50 simultaneous identical requests never create duplicate local or WeChat orders',async()=>{
  const env=setup();const results=await Promise.allSettled(Array.from({length:50},()=>env.create()));
  assert.ok(results.some(result=>result.status==='fulfilled'));
  assert.equal(env.rows.length,1);assert.equal(env.wechatCalls(),1);
});
test('different amount within 5 seconds is blocked; reuse is exempt',async()=>{
  const env=setup();await env.create(30);
  await assert.rejects(env.create(50),/5 秒/);await env.create(30);
  assert.equal(env.rows.length,1);
});
test('max three pending orders; expired but unconfirmed orders still occupy slots',async()=>{
  const env=setup();for(const amount of [10,50,100]){env.resetCadence();await env.create(amount);}
  env.rows[0].expiredAt=new Date(0);env.resetCadence();
  await assert.rejects(env.create(200),/3 笔/);assert.equal(env.rows.length,3);
});
test('local insert failure never calls WeChat',async()=>{
  const env=setup({createError:true});await assert.rejects(env.create(),/insert failed/);assert.equal(env.wechatCalls(),0);
});
test('WeChat timeout keeps the local order; confirmed missing order retries the same number',async()=>{
  const env=setup({wechatError:true});await assert.rejects(env.create(),/wechat timeout/);
  const number=env.rows[0].orderNo;assert.equal(env.rows[0].status,'pending');
  env.options.wechatError=false;env.options.queryMissing=true;await env.create();
  assert.equal(env.rows.length,1);assert.equal(env.rows[0].orderNo,number);assert.equal(env.wechatCalls(),2);
});
test('unknown WeChat state cannot trigger another native request',async()=>{
  const env=setup({wechatError:true});await assert.rejects(env.create());
  env.options.wechatError=false;env.options.queryError=true;
  await assert.rejects(env.create(),/query timeout/);assert.equal(env.wechatCalls(),1);
});
test('lost QR with an existing unpaid WeChat order is closed before replacement',async()=>{
  const env=setup({updateError:true});await assert.rejects(env.create(),/QR save failed/);
  env.options.updateError=false;await assert.rejects(env.create(),/已关闭/);
  assert.equal(env.closes(),1);assert.equal(env.rows[0].status,'closed');assert.equal(env.wechatCalls(),1);
});
test('QR persistence cannot overwrite a concurrent paid callback',async()=>{
  const env=setup({concurrentPaid:true});const result=await env.create();
  assert.equal(result.status,'paid');assert.equal(env.rows[0].wechatTransactionId,'tx-test');
});
test('different users have isolated cadence and pending orders',async()=>{
  const env=setup();await env.create(30);await env.create(30,'698433ea0cda17ab9fdcd421');
  assert.equal(env.rows.length,2);assert.equal(env.wechatCalls(),2);
});
test('legacy pending recharge without deduplication fields reuses the saved QR',async()=>{
  const env=setup();const first=await env.create();delete env.rows[0].rechargeKey;delete env.rows[0].rechargeSlot;
  const second=await env.create();assert.equal(second.id,first.id);assert.equal(env.rows.length,1);assert.equal(env.wechatCalls(),1);
});
test('a paid order releases its slot and does not prevent a later recharge of the same amount',async()=>{
  const env=setup();await env.create();env.rows[0].status='paid';env.resetCadence();
  await env.create();assert.equal(env.rows.length,2);assert.equal(env.wechatCalls(),2);
});
