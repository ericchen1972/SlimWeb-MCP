import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {createRequestHandler} from '../src/app.js';
import {createSessionToken} from '@slimweb/mcp-core/session';
test('SaaS installed Core exposes site.notification and sends subscription to the website backend', async()=>{
 const calls=[];const site={site_id:1,site_code:'swcb_demo',permissions:['system_admin']};
 const backendTransport={async request(op){calls.push(op);if(op.path.endsWith('/site-context/resolve'))return {actor:{site_id:1,permissions:site.permissions},site};if(op.path.endsWith('/sites'))return {sites:[site]};return {id:'sub_saas',refreshBefore:null,cursor:null,truncated:false};}};
 const secret='events-test-secret';const server=createServer(createRequestHandler({backendTransport,sessionSecret:secret}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const call=async(method,params={})=>(await fetch(`http://127.0.0.1:${server.address().port}/mcp`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${createSessionToken({email:'owner@example.com',google_id:'owner-sub'},secret)}`},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})})).json();
 try{
  assert.equal((await call('events/list')).result.events[0].name,'site.notification');
  const p={name:'site.notification',arguments:{site_code:'swcb_demo'},delivery:{mode:'webhook',url:'https://receiver.example.com/callback',secret:'whsec_'+Buffer.alloc(32).toString('base64')}};
  assert.equal((await call('events/subscribe',p)).result.id,'sub_saas');assert.equal(calls.at(-1).path,'/internal/mcp/v1/sites/swcb_demo/events/subscribe');assert.deepEqual(calls.at(-1).body,p);
 }finally{await new Promise(r=>server.close(r));}
});
