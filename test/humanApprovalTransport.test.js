import test from 'node:test';
import assert from 'node:assert/strict';
import {WeblessBackendTransport} from '../src/backends/weblessBackendTransport.js';
import {createSaasContext} from '../src/saasContext.js';
test('human approval transport uses dedicated service endpoints without ordinary actor grants',async()=>{
  const calls=[];const transport=new WeblessBackendTransport({baseUrl:'https://backend.example',secret:'service-transport',fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({ok:true,data:{human_ticket:'t'.repeat(43)}});}});
  const {humanApprovalTransport:human}=createSaasContext({backendTransport:transport});
  assert.ok(human);await human.bootstrap({credential:'fresh-proof',nonce:'nonce',site_code:'shop',approval_id:'approval',domain:null});await human.preview({human_ticket:'t'.repeat(43),site_code:'shop'});await human.decide({human_ticket:'t'.repeat(43),decision:'reject',site_code:'shop'});
  assert.deepEqual(calls.map(x=>new URL(x.url).pathname),['/internal/mcp/v1/human-approvals/bootstrap','/internal/mcp/v1/human-approvals/preview','/internal/mcp/v1/human-approvals/decide']);
  assert.equal(JSON.parse(calls[0].options.body).target,'saas');
  for(const call of calls){assert.equal(call.options.headers['X-SlimWeb-MCP-Secret'],'service-transport');assert.equal(call.options.headers['X-SlimWeb-Actor-Assertion'],undefined);assert.equal(call.options.redirect,'manual');}
  assert.deepEqual(JSON.parse(calls[1].options.body),{human_ticket:'t'.repeat(43)});
});
