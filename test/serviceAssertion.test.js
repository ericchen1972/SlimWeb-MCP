import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {createRequestHandler} from '../src/app.js';
import {verifyServiceAssertion} from '../src/serviceAssertion.js';

const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const publicKey=keys.publicKey.export({type:'spki',format:'pem'});
const now=Math.floor(Date.now()/1000);
const claims={iss:'https://slimweb.tw',aud:'https://mcp.example',target:'saas',site_id:7,sub:'owner',email:'owner@example.test',name:'Owner',backend_grant:'a'.repeat(43),jti:'service-fixture-123',iat:now,exp:now+60};
function token(overrides={},header={alg:'RS256',typ:'JWT',kid:'fixture'}){
  const payload=[header,{...claims,...overrides}].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return payload+'.'+sign('RSA-SHA256',Buffer.from(payload),keys.privateKey).toString('base64url');
}
const options={issuer:claims.iss,audience:claims.aud,publicKeys:{fixture:publicKey},now:()=>now};

test('explicit production runtime refuses missing service-verification trust configuration',()=>{
  assert.throws(()=>createRequestHandler({runtimeMode:'production',publicBaseUrl:claims.aud,googleClientId:'configured-client',sessionSecret:'fixture',
    accountRepository:{},googleVerifier:{},oauthStore:{}}),/assertion issuer and public keys are required/);
});

test('SaaS service proof requires exact purpose, identity, site and bounded lifetime',()=>{
  assert.equal(verifyServiceAssertion(token(),options).site_id,7);
  for(const overrides of [{iss:'https://evil.test'},{aud:'https://other.test'},{target:'standalone'},{site_id:0},{sub:''},{email:''},{backend_grant:''},{exp:now},{exp:now+1000},{iat:now+10}]){
    assert.throws(()=>verifyServiceAssertion(token(overrides),options));
  }
  assert.throws(()=>verifyServiceAssertion(token({}, {alg:'HS256',typ:'JWT',kid:'fixture'}),options));
});

test('independent service proof works only request-locally and never creates a browser credential',async()=>{
  let identity;
  const handler=createRequestHandler({
    publicBaseUrl:claims.aud,sessionSecret:'fixture',googleVerifier:{async verify(){throw new Error('unused');}},
    serviceAssertionIssuer:claims.iss,serviceAssertionPublicKeys:{fixture:publicKey},
    accountRepository:{async listSitesForAdminIdentity(value){identity=value;return [{site_id:7,site_code:'swcb_owned',permissions:['system_admin']}];}},
    oauthStore:{async put(){},async get(){return null;},async take(){return null;}}
  });
  const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const r=await fetch(base+'/mcp',{method:'POST',headers:{authorization:'Bearer '+token(),'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'slimweb_sites_list',arguments:{}}})});
    assert.equal(r.status,200);assert.equal(r.headers.get('set-cookie'),null);
    const result=await r.text();assert.ok(!result.includes(claims.backend_grant));
    assert.equal(identity.backend_grant,claims.backend_grant);
    assert.equal(identity.site_id,7);
    const unauth=await fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'slimweb_sites_list',arguments:{}}})});
    assert.equal(unauth.status,401);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
