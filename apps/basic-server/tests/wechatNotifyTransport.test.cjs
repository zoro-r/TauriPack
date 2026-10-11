const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Koa = require('koa');
const {load} = require('./helpers/paymentHarness.cjs');
const tool = load('utils/tool.ts', {});
const {wechatNotifyBody} = load('middleware/wechatNotifyBody.ts', {
  'koa-bodyparser': require('koa-bodyparser'), '@/utils/tool': tool
});
async function send(t, handler, chunks, requestPath='/api/pay/wechat/notify') {
  const app = new Koa();app.on('error',()=>{});app.use(wechatNotifyBody);app.use(handler);
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return new Promise((resolve,reject)=>{
    const request=http.request({hostname:'127.0.0.1',port:server.address().port,path:requestPath,method:'POST',headers:{'content-type':'application/json'}},response=>{
      let body='';response.on('data',chunk=>{body+=chunk;});response.on('end',()=>resolve({status:response.statusCode,body}));
    });request.on('error',reject);for(const chunk of chunks) request.write(chunk);request.end();
  });
}
test('successful persisted callback returns HTTP 200',async t=>{
  const response=await send(t,async ctx=>{ctx.body=tool.wechatSuccess();},[Buffer.from('{}')]);
  assert.equal(response.status,200);assert.equal(JSON.parse(response.body).code,'SUCCESS');
});
test('failed persistence returns HTTP 500 so delivery can be retried',async t=>{
  const response=await send(t,async ctx=>{ctx.body=tool.wechatFail('database unavailable');},[Buffer.from('{}')]);
  assert.equal(response.status,500);assert.equal(JSON.parse(response.body).code,'FAIL');
});
test('malformed callback returns failure without entering settlement',async t=>{
  let settled=false;
  const response=await send(t,async()=>{settled=true;},[Buffer.from('{invalid')]);
  assert.equal(response.status,500);assert.equal(settled,false);
});
test('raw UTF-8 body is preserved across split network chunks for signature validation',async t=>{
  const raw='{"summary":"支付成功"}';const bytes=Buffer.from(raw);
  const response=await send(t,async ctx=>{
    assert.equal(ctx.state.rawBody,raw);assert.equal(ctx.request.body.summary,'支付成功');ctx.body=tool.wechatSuccess();
  },[bytes.subarray(0,14),bytes.subarray(14,15),bytes.subarray(15)]);
  assert.equal(response.status,200);
});
test('other API paths keep ordinary JSON parsing and response status',async t=>{
  const response=await send(t,async ctx=>{
    assert.equal(ctx.request.body.amount,30);ctx.body=tool.fail('ordinary application error');
  },[Buffer.from('{"amount":30}')],'/api/newapi/recharge-orders');
  assert.equal(response.status,200);assert.equal(JSON.parse(response.body).code,-1);
});
