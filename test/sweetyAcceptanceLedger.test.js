import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ACCEPTANCE,
  buildRows,
  classifyDomain,
} from '../scripts/sweetyAcceptanceLedger.mjs';

const contract = JSON.parse(
  readFileSync(new URL('./fixtures/saas-tool-contract.json', import.meta.url), 'utf8'),
);

test('Sweety acceptance ledger covers the frozen 137-tool contract exactly once', () => {
  const rows = buildRows(contract.tools);

  assert.equal(contract.count, 137);
  assert.equal(
    contract.sha256,
    'cbb4589ff4ec9a5e92f66515a760dff5af2110112777b9c99b715727ee9f88e5',
  );
  assert.equal(rows.length, 137);
  assert.equal(new Set(rows.map(({ tool }) => tool)).size, 137);
  assert.ok(rows.every(({ tool, siteCode, status, domain }) => (
    siteCode === 'swcb_g3fg1bpnjulrr75o'
      && status === ACCEPTANCE.NOT_RUN
      && domain === classifyDomain(tool)
  )));
});
