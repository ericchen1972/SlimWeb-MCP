import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

function gcloud(args) {
  // Capture all output: service descriptions can contain sensitive env values.
  try { return JSON.parse(execFileSync('gcloud', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']})); }
  catch { throw new Error('Cloud Run operation failed; sensitive output suppressed.'); }
}

export async function deployPreservingRuntime({project, region, service, image, suffix, standalone = false,
  promote = false, runner = gcloud, health = fetch}) {
  if (![project, region, service, suffix].every(v => typeof v === 'string' && /^[a-zA-Z0-9-]+$/.test(v))
    || !/^.+@sha256:[a-f0-9]{64}$/.test(image ?? '')) throw new Error('Explicit project, region, service, revision suffix and immutable image digest required.');
  const scope = [`--project=${project}`, `--region=${region}`, '--quiet', '--format=json'];
  const current = runner(['run', 'services', 'describe', service, ...scope]);
  const environment = current.spec?.template?.spec?.containers?.[0]?.env ?? [];
  const required = ['NODE_ENV', 'PUBLIC_BASE_URL', 'GOOGLE_CLIENT_ID', 'HUMAN_APPROVAL_GOOGLE_CLIENT_ID',
    'MCP_SESSION_SECRET', 'WEBLESS_MCP_SECRET', ...(standalone
      ? ['WEBLESS_REGISTRY_BASE_URL', 'STANDALONE_SLIMAI_ASSERTION_ISSUER', 'STANDALONE_SLIMAI_ASSERTION_PUBLIC_KEYS_JSON']
      : ['WEBLESS_BACKEND_API_BASE_URL', 'SLIMAI_ASSERTION_ISSUER', 'SLIMAI_ASSERTION_PUBLIC_KEYS_JSON'])];
  const missing = required.filter(name => !environment.some(entry => entry.name === name &&
    ((typeof entry.value === 'string' && entry.value.trim()) ||
      (entry.valueFrom?.secretKeyRef?.name && entry.valueFrom?.secretKeyRef?.key))));
  if (missing.length) throw new Error(`Missing required runtime configuration: ${missing.join(', ')}`);
  const revision = `${service}-${suffix}`;
  const tag = `candidate-${suffix}`;
  // Image-only deployment preserves env, secret references, runtime settings and IAM.
  const deployed = runner(['run', 'deploy', service, ...scope, `--image=${image}`,
    `--revision-suffix=${suffix}`, '--no-traffic', `--tag=${tag}`]);
  const ready = runner(['run', 'revisions', 'describe', revision, ...scope]);
  if (ready.metadata?.name !== revision || !ready.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'True'))
    throw new Error('Intended candidate revision is not ready.');
  const candidateContainer = ready.spec?.containers?.[0];
  const byName = entries => [...(entries ?? [])].sort((a,b) => a.name.localeCompare(b.name));
  if (candidateContainer?.image !== image || !isDeepStrictEqual(byName(candidateContainer.env), byName(environment)))
    throw new Error('Candidate runtime differs from intended image or preserved environment.');
  const candidate = deployed.status?.traffic?.find(entry => entry.tag === tag && entry.revisionName === revision);
  if (!candidate?.url || !candidate.url.startsWith('https://')) throw new Error('Intended candidate URL unavailable.');
  // Cloud Run's external edge can reserve /healthz and return HTML 404.
  // /readyz is the externally reachable, read-only application readiness route.
  for (const path of ['/readyz']) {
    const response = await health(`${candidate.url}${path}`, {signal: AbortSignal.timeout(30000), redirect: 'error'});
    if (!response.ok) throw new Error(`Candidate health check failed: ${path}`);
    const body = await response.json();
    if (body.ok !== true || body.status !== 'ready' || body.service !== 'slimweb-mcp')
      throw new Error(`Candidate health response failed: ${path}`);
  }
  if (promote) {
    runner(['run', 'services', 'update-traffic', service, ...scope, `--to-revisions=${revision}=100`]);
    runner(['run', 'services', 'update-traffic', service, ...scope, `--remove-tags=${tag}`]);
  }
  return {revision, promoted: promote};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  deployPreservingRuntime({project: process.env.PROJECT_ID, region: process.env.REGION,
    service: process.env.SERVICE, image: process.env.IMAGE_DIGEST, suffix: process.env.REVISION_SUFFIX,
    standalone: process.env.STANDALONE === 'true', promote: process.env.PROMOTE === 'true'})
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
