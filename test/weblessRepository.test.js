import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { SLIMWEB_BACKEND_METHODS } from '../src/backends/slimWebBackend.js';
import { WeblessAccountRepository } from '../src/weblessRepository.js';

test('repository exposes every backend method and delegates without database or storage access', async () => {
  const actor = { email: 'owner@example.com', site: { site_code: 'swcb_demo' } };
  const args = { site_id: 101 };
  const calls = [];
  const backendClient = Object.fromEntries(SLIMWEB_BACKEND_METHODS.map((method) => [method, async (receivedActor, receivedArgs) => {
    calls.push([method, receivedActor, receivedArgs]);
    return { method };
  }]));
  const repository = new WeblessAccountRepository(undefined, { backendClient });

  for (const method of SLIMWEB_BACKEND_METHODS) {
    assert.equal(typeof repository[method], 'function', `missing ${method}()`);
    assert.deepEqual(await repository[method](actor, args), { method });
  }

  assert.deepEqual(calls.map(([method]) => method), SLIMWEB_BACKEND_METHODS);
  assert.ok(calls.every(([, receivedActor, receivedArgs]) => receivedActor === actor && receivedArgs === args));
});

test('repository keeps only stateless identity and public tool aliases outside the backend interface', async () => {
  const calls = [];
  const backendClient = {
    listSitesForAdminIdentity: async (identity) => { calls.push(['sites', identity]); return [{ site_code: 'swcb_demo' }]; },
    listThemes: async (actor, args) => { calls.push(['themes', actor, args]); return { themes: [] }; },
    registerAsset: async (actor, args) => { calls.push(['asset', actor, args]); return { asset: {} }; }
  };
  const repository = new WeblessAccountRepository(undefined, { backendClient });
  const profile = { sub: 'google-sub', email: 'owner@example.com', name: 'Owner', resource_context: { domain: 'example.com' } };

  assert.deepEqual(await repository.upsertGoogleAccount(profile), { id: null, google_id: 'google-sub', email: 'owner@example.com', name: 'Owner' });
  assert.deepEqual(await repository.listAdminSitesForGoogleProfile(profile), [{ site_code: 'swcb_demo' }]);
  assert.deepEqual(await repository.listThemesForAccountSite(profile, { site_id: 101 }), { themes: [] });
  assert.deepEqual(await repository.uploadAsset(profile, { site_id: 101 }), { asset: {} });
  assert.deepEqual(calls.map(([kind]) => kind), ['sites', 'themes', 'asset']);
  assert.deepEqual(calls[0][1].resource_context, { domain: 'example.com' });
});

test('repository fails closed when the Webless backend is not configured', async () => {
  const repository = new WeblessAccountRepository();
  await assert.rejects(() => repository.getBasicSettings({}, {}), (error) => error.code === 'UPSTREAM_NOT_CONFIGURED');
});

test('repository source contains no direct persistence or provider implementation', async () => {
  const source = await readFile(new URL('../src/weblessRepository.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bpg\b|\.query\(|\bSQL\b|select\s|insert\s|update\s+sites|delete\s+from|Gcs|StorageAdapter|DB_|WEBLESS_APP_KEY|GOOGLE_APPLICATION_CREDENTIALS/i);
});
