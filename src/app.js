import { createRequestHandler as createCoreRequestHandler } from '@slimweb/mcp-core';

import { createSaasContext } from './saasContext.js';
import {parsePublicKeys,verifyServiceAssertion} from './serviceAssertion.js';

export function createRequestHandler(options = {}) {
  const identities=new WeakMap();
  const base=options.publicBaseUrl??process.env.PUBLIC_BASE_URL;
  const assertionOptions={
    issuer:options.serviceAssertionIssuer??process.env.SLIMAI_ASSERTION_ISSUER,
    audience:base,
    publicKeys:parsePublicKeys(options.serviceAssertionPublicKeys??process.env.SLIMAI_ASSERTION_PUBLIC_KEYS_JSON),
    ...(options.now?{now:options.now}:{})
  };
  const runtimeMode=options.runtimeMode??process.env.NODE_ENV??'production';
  if(runtimeMode==='production'&&(!assertionOptions.issuer||!Object.keys(assertionOptions.publicKeys).length)) {
    throw new Error('Production SlimAI assertion issuer and public keys are required.');
  }
  const core=createCoreRequestHandler({
    ...createSaasContext(options),
    ...options,
    verifiedServiceIdentityResolver:request=>identities.get(request)??null
  });
  return async(request,response)=>{
    const auth=String(request.headers.authorization??'');
    const token=auth.toLowerCase().startsWith('bearer ')?auth.slice(7).trim():'';
    if(token.split('.').length!==3)return core(request,response);
    try{
      const claims=verifyServiceAssertion(token,assertionOptions);
      identities.set(request,{account_id:'saas-service:'+claims.site_id,google_id:claims.sub,email:claims.email,name:claims.name,
        backend_grant:claims.backend_grant,site_id:claims.site_id,resource_context:null,service_assertion_jti:claims.jti,iat:claims.iat,exp:claims.exp});
      return await core(request,response);
    }catch(error){
      if(!response.headersSent){response.writeHead(401,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({error:{code:error.code??'SERVICE_ASSERTION_INVALID',message:'Invalid SlimAI service proof.'}}));}
    }finally{identities.delete(request);}
  };
}
