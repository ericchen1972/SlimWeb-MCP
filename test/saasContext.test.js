import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSaasContext } from '../src/saasContext.js';

test('SaaS shell injects the supplied repository unchanged', () => {
  const accountRepository = { marker: 'repository' };
  const context = createSaasContext({ accountRepository });

  assert.equal(context.accountRepository, accountRepository);
});
