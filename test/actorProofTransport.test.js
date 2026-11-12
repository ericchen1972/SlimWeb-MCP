import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {WeblessBackendTransport} from '../src/backends/weblessBackendTransport.js';

const response = data => new Response(JSON.stringify({ok:true,data}), {headers:{'content-type':'application/json'}});

test('merchant request exchanges a verified grant for exact request-bound proof', async () => {
  const calls=[];
  const transport=new WeblessBackendTransport({baseUrl:'https://backend.example',secret:'service',fetchImpl:async(url,options)=>{
    calls.push({url,options});
    return response(calls.length===1?{assertion:'central-signed-proof',expires_at:123}:{saved:true});
  }});
  const body={name:'測試'};
  assert.deepEqual(await transport.request({method:'PATCH',path:'/internal/mcp/v1/sites/swcb_owned/settings/basic',
    identity:{backend_grant:'verified-opaque-grant',google_id:'forged-sub',email:'other@example.test'},body}),{saved:true});
  assert.equal(calls.length,2);
  assert.equal(calls[0].url,'https://backend.example/internal/mcp/v1/actor-grants/exchange');
  assert.deepEqual(JSON.parse(calls[0].options.body),{
    backend_grant:'verified-opaque-grant',method:'PATCH',path:'/internal/mcp/v1/sites/swcb_owned/settings/basic',
    body_hash:createHash('sha256').update(JSON.stringify(body)).digest('hex')
  });
  assert.equal(calls[1].options.headers['X-SlimWeb-Actor-Assertion'],'central-signed-proof');
  assert.equal(calls[1].options.headers['X-SlimWeb-Actor-Sub'],undefined);
  assert.equal(calls[1].options.headers['X-SlimWeb-Actor-Email'],undefined);
  assert.equal(calls[1].options.headers['X-SlimWeb-Actor-Grant'],undefined);
  assert.equal(calls[1].options.redirect,'manual');
});

test('service secret and caller identity alone cannot initiate a merchant request', async () => {
  let calls=0;
  const transport=new WeblessBackendTransport({baseUrl:'https://backend.example',secret:'service',fetchImpl:async()=>{calls++;return response({});}});
  await assert.rejects(transport.request({path:'/internal/mcp/v1/sites',identity:{google_id:'victim',email:'victim@example.test'}}),error=>error.code==='UNAUTHENTICATED');
  assert.equal(calls,0);
});

test('bootstrap transmits fresh proof in body, ignores caller profile and accepts only server identity',async()=>{
  let captured;
  const transport=new WeblessBackendTransport({baseUrl:'https://backend.example',secret:'service',fetchImpl:async(url,options)=>{
    captured={url,options};return response({profile:{sub:'verified',email:'verified@example.test'},backend_grant:'opaque',expires_at:123});
  }});
  const result=await transport.bootstrapIdentity({credential:'fresh-google-token',profile:{sub:'forged'},resourceContext:null});
  assert.equal(result.profile.sub,'verified');
  assert.equal(captured.url,'https://backend.example/internal/mcp/v1/actor-grants/bootstrap');
  assert.deepEqual(JSON.parse(captured.options.body),{credential:'fresh-google-token',target:'saas'});
  assert.equal(captured.options.headers['X-SlimWeb-Actor-Sub'],undefined);
});

test('logout revokes backend grant through dedicated service endpoint',async()=>{
  let captured;
  const transport=new WeblessBackendTransport({baseUrl:'https://backend.example',secret:'service',fetchImpl:async(url,options)=>{
    captured={url,options};return response({revoked:true});
  }});
  await transport.revokeIdentityGrant({backend_grant:'opaque'});
  assert.equal(captured.url,'https://backend.example/internal/mcp/v1/actor-grants/revoke');
  assert.deepEqual(JSON.parse(captured.options.body),{backend_grant:'opaque'});
});
