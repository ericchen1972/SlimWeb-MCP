import test from 'node:test';
import assert from 'node:assert/strict';
import { deployPreservingRuntime, candidateTag, resolveLinuxAmd64Image, runCloudJson } from '../scripts/deploy-preserving-runtime.mjs';

const names = ['NODE_ENV','PUBLIC_BASE_URL','GOOGLE_CLIENT_ID','HUMAN_APPROVAL_GOOGLE_CLIENT_ID','MCP_SESSION_SECRET','WEBLESS_MCP_SECRET','WEBLESS_BACKEND_API_BASE_URL','SLIMAI_ASSERTION_ISSUER','SLIMAI_ASSERTION_PUBLIC_KEYS_JSON'];
function fixture({missing, unhealthy = false} = {}) {
  const calls = [];
  const env = names.filter(name => name !== missing).map(name => ({name, value: 'configured'}));
  const runner = args => {
    calls.push(args);
    if (args[1] === 'services' && args[2] === 'describe') return {spec: {template: {spec: {containers: [{env}]}}}};
    if (args[1] === 'deploy') return {status: {traffic: [{tag: candidateTag('service','test'), revisionName: 'service-test', url: 'https://candidate.example'}]}};
    if (args[1] === 'revisions') return {metadata: {name: 'service-test'}, spec: {containers: [{image: options.image, env}]}, status: {conditions: [{type: 'Ready', status: 'True'}]}};
    return {};
  };
  return {calls, runner, health: async () => ({ok: !unhealthy, json: async () => ({ok:true,status:'ready',service:'slimweb-mcp'})})};
}
const options = {project: 'project', region: 'region', service: 'service', image: `registry/image@sha256:${'a'.repeat(64)}`, suffix: 'test', promote: true, standalone: false};
test('missing auth configuration aborts before deployment without disclosing values', async () => {
  const f = fixture({missing: 'SLIMAI_ASSERTION_PUBLIC_KEYS_JSON'});
  await assert.rejects(deployPreservingRuntime({...options, ...f}), /SLIMAI_ASSERTION_PUBLIC_KEYS_JSON/);
  assert.equal(f.calls.length, 1);
});
test('deploy preserves configuration and IAM, then promotes only healthy exact revision', async () => {
  const f = fixture(); await deployPreservingRuntime({...options, ...f});
  const deploy = f.calls.find(args => args[1] === 'deploy');
  assert.ok(deploy.includes('--no-traffic'));
  assert.ok(!deploy.some(arg => /env-vars|secrets|unauthenticated|service-account/.test(arg)));
  const promotion = f.calls.find(args => args.some(arg=>arg.startsWith('--to-revisions=')));
  assert.ok(f.calls.at(-1).includes(`--remove-tags=${candidateTag('service','test')}`));
  assert.ok(promotion.includes('--to-revisions=service-test=100'));
  assert.ok(!promotion.includes('--to-latest'));
});
test('failed health check prevents promotion', async () => {
  const f = fixture({unhealthy: true});
  await assert.rejects(deployPreservingRuntime({...options, ...f}), /health/);
  assert.ok(!f.calls.some(args => args.includes('update-traffic')));
});
test('standalone candidate is not automatically promoted', async () => {
  const f = fixture(); await deployPreservingRuntime({...options, ...f, promote: false});
  assert.ok(!f.calls.some(args => args.includes('update-traffic')));
});

test('missing human approval client ID blocks deployment', async () => {
  const f = fixture({missing: 'HUMAN_APPROVAL_GOOGLE_CLIENT_ID'});
  await assert.rejects(deployPreservingRuntime({...options, ...f}), /HUMAN_APPROVAL_GOOGLE_CLIENT_ID/);
  assert.equal(f.calls.length, 1);
});
test('mutable image tags are rejected before cloud access', async () => {
  const f = fixture();
  await assert.rejects(deployPreservingRuntime({...options, ...f, image: 'registry/image:latest'}), /immutable/);
  assert.equal(f.calls.length, 0);
});
test('wrong candidate revision cannot be promoted', async () => {
  const f = fixture(); const original = f.runner;
  f.runner = args => {
    const result = original(args);
    if (args[1] === 'deploy') result.status.traffic[0].revisionName = 'other-revision';
    return result;
  };
  await assert.rejects(deployPreservingRuntime({...options, ...f}), /candidate URL/);
  assert.ok(!f.calls.some(args => args.includes('update-traffic')));
});
test('secret references satisfy preflight without exposing values', async () => {
  const f = fixture(); const original = f.runner;
  f.runner = args => {
    const result = original(args);
    const env = names.map(name => ({name, valueFrom: {secretKeyRef: {name: 'secret-name', key: '1'}}}));
    if (args[1] === 'services' && args[2] === 'describe') result.spec.template.spec.containers[0].env = env;
    if (args[1] === 'revisions') result.spec.containers[0].env = env;
    return result;
  };
  await deployPreservingRuntime({...options, ...f});
  assert.ok(!JSON.stringify(f.calls).includes('secret-name'));
});

test('HTTP200 with unready JSON does not promote',async()=>{
 const f=fixture(); f.health=async()=>({ok:true,json:async()=>({ok:false,status:'unready'})});
 await assert.rejects(deployPreservingRuntime({...options,...f}),/health/);
 assert.ok(!f.calls.some(args=>args.includes('update-traffic')));
});
test('candidate environment drift blocks promotion',async()=>{
 const f=fixture(),original=f.runner;f.runner=args=>{const value=original(args);if(args[1]==='revisions')value.spec.containers[0].env=[];return value;};
 await assert.rejects(deployPreservingRuntime({...options,...f}),/runtime/);
 assert.ok(!f.calls.some(args=>args.includes('update-traffic')));
});

test('deployment succeeds through externally reachable readyz when edge reserves healthz',async()=>{
 const f=fixture(); const paths=[];
 f.health=async(url)=>{const path=new URL(url).pathname;paths.push(path);return path==='/healthz'
  ? {ok:false,status:404,json:async()=>{throw new Error('Edge HTML is not JSON');}}
  : {ok:true,status:200,json:async()=>({ok:true,status:'ready',service:'slimweb-mcp'})};};
 await deployPreservingRuntime({...options,...f});
 assert.deepEqual(paths,['/readyz']);
 assert.ok(f.calls.some(args=>args.includes('--to-revisions=service-test=100')));
});

test('candidate tag fits Cloud Run combined46-character limit with standalone service',()=>{
 const service='slimweb-standalone-mcp',suffix='gh-43276123829-1';
 const tag=candidateTag(service,suffix);
 assert.ok(tag.length+service.length<=46);assert.match(tag,/^[a-z][a-z0-9-]+$/);
 assert.equal(tag,candidateTag(service,suffix));assert.notEqual(tag,candidateTag(service,suffix+'2'));
});
test('OCI index resolves to its immutable linux amd64 child rather than the attestation',()=>{
 const child='sha256:'+'b'.repeat(64);
 const image=resolveLinuxAmd64Image(options.image,()=>({manifests:[{digest:child,platform:{os:'linux',architecture:'amd64'}},{digest:'sha256:'+'c'.repeat(64),platform:{os:'unknown',architecture:'unknown'}}]}));
 assert.equal(image,'registry/image@'+child);
 assert.equal(resolveLinuxAmd64Image(options.image,()=>({schemaVersion:2,config:{}})),options.image);
 assert.throws(()=>resolveLinuxAmd64Image(options.image,()=>({manifests:[]})),/linux\/amd64/);
});
test('cloud command failure exposes only allowlisted operation and code',()=>{
 const run=()=>{const error=new Error('SECRET command values');error.status=1;error.stderr=Buffer.from('ERROR: (gcloud.run.deploy) INVALID_ARGUMENT: SECRET env content');throw error;};
 assert.throws(()=>runCloudJson(['run','deploy','secret-service','--secret=SECRET'],run),error=>{
  assert.match(error.message,/run deploy.*INVALID_ARGUMENT/);assert.ok(!error.message.includes('SECRET'));assert.ok(!error.message.includes('secret-service'));return true;
 });
});
