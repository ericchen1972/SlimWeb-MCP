import {createPublicKey,verify} from 'node:crypto';

const invalid = () => Object.assign(new Error('Invalid SlimAI service proof.'),{code:'SERVICE_ASSERTION_INVALID',status:401});

export function parsePublicKeys(value) {
  let keys=value;
  try { if(typeof keys==='string')keys=JSON.parse(keys); } catch { return {}; }
  if(!keys||typeof keys!=='object'||Array.isArray(keys))return {};
  return Object.fromEntries(Object.entries(keys).filter(([,v])=>typeof v==='string'&&v!=='').map(([kid,key])=>[kid,key.includes('BEGIN PUBLIC KEY')?key:Buffer.from(key,'base64').toString('utf8')]));
}

export function verifyServiceAssertion(token,options) {
  if(typeof token!=='string'||token.length>8192)throw invalid();
  const parts=token.split('.');
  if(parts.length!==3||parts.some(p=>!p||!/^[A-Za-z0-9_-]+$/.test(p)))throw invalid();
  let header,claims;
  try{header=JSON.parse(Buffer.from(parts[0],'base64url'));claims=JSON.parse(Buffer.from(parts[1],'base64url'));}catch{throw invalid();}
  if(header?.alg!=='RS256'||header.typ!=='JWT'||typeof header.kid!=='string'||!options.publicKeys?.[header.kid])throw invalid();
  let valid=false;
  try{valid=verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey(options.publicKeys[header.kid]),Buffer.from(parts[2],'base64url'));}catch{}
  if(!valid)throw invalid();
  const now=options.now?.()??Math.floor(Date.now()/1000);
  if(!claims||claims.iss!==options.issuer||claims.aud!==options.audience||claims.target!=='saas'
    ||!Number.isInteger(claims.site_id)||claims.site_id<1
    ||typeof claims.sub!=='string'||!claims.sub.trim()||typeof claims.email!=='string'||!claims.email.trim()
    ||typeof claims.backend_grant!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(claims.backend_grant)
    ||typeof claims.jti!=='string'||claims.jti.length<8
    ||!Number.isInteger(claims.iat)||!Number.isInteger(claims.exp)||claims.iat>now+5||claims.exp<=now
    ||claims.exp<=claims.iat||claims.exp-claims.iat>120)throw invalid();
  return Object.freeze({...claims});
}
