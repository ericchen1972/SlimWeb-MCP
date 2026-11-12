import assert from 'node:assert/strict';
import {test} from 'node:test';
import {WeblessOAuthStore} from '../src/backends/weblessOAuthStore.js';
test('OAuth store uses shared backend state and unwraps nullable values',async()=>{
 const calls=[];const s=new WeblessOAuthStore({async request(p){calls.push(p);return {value:p.body?.value??null};}});
 await s.put('code','a'.repeat(64),{hello:'world'},123);
 assert.deepEqual(await s.get('code','a'.repeat(64)),null);
 assert.deepEqual(await s.take('code','a'.repeat(64)),null);
 assert.deepEqual(calls.map(p=>p.method),['PUT','GET','DELETE']);
 assert.equal(calls[0].path,'/internal/mcp/v1/oauth-state/code/'+'a'.repeat(64));
 assert.deepEqual(calls[0].body,{value:{hello:'world'},expires_at:123});
});
