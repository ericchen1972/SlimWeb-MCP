import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SlimWebBackendRepository } from '@slimweb/mcp-core/backend-repository';
import { createSaasContext } from '../src/saasContext.js';
import { WeblessBackendTransport } from '../src/backends/weblessBackendTransport.js';

test('SaaS shell injects the supplied repository unchanged', () => {
  const accountRepository = { marker: 'repository' };
  const context = createSaasContext({ accountRepository });

  assert.equal(context.accountRepository, accountRepository);
});

test('SaaS shell composes the shared repository with only the SaaS transport', () => {
  const context = createSaasContext({
    weblessBackendApiBaseUrl: 'https://backend.example.com',
    weblessMcpSecret: 'service-secret'
  });

  assert.equal(context.accountRepository instanceof SlimWebBackendRepository, true);
  assert.equal(context.accountRepository.transport instanceof WeblessBackendTransport, true);
});
