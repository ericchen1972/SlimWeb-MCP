import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequestHandler as createHandler } from '../src/app.js';

test('deployed wrapper exposes read-only health and readiness without backend operations',async()=>{
 let backendCalls=0;
 const forbidden=async()=>{backendCalls++;throw new Error('Health must not access business backend');};
 const handler=createHandler({runtimeMode:'test',sessionSecret:'health-test-secret',
   backend:{request:forbidden,bootstrapIdentity:forbidden},accountRepository:{listAdminSitesForGoogleProfile:forbidden}});
 const server=createServer(handler);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const path of ['/healthz','/readyz']){
   const response=await fetch(base+path);const body=await response.json();
   assert.equal(response.status,200);assert.equal(body.ok,true);assert.equal(body.status,'ready');assert.equal(body.service,'slimweb-mcp');
  }
  assert.equal(backendCalls,0);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
