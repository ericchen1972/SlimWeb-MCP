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

test('Sweety acceptance ledger covers the frozen 127-tool contract exactly once', () => {
  const rows = buildRows(contract.tools);

  assert.equal(contract.count, 127);
  assert.equal(
    contract.sha256,
    'bb86586ea1668d4da1863a737272e6b581bbb0529e24c8717b182409253124a8',
  );
  assert.equal(rows.length, 127);
  assert.equal(new Set(rows.map(({ tool }) => tool)).size, 127);
  assert.ok(rows.every(({ tool, siteCode, status, domain }) => (
    siteCode === 'swcb_g3fg1bpnjulrr75o'
      && status === ACCEPTANCE.NOT_RUN
      && domain === classifyDomain(tool)
  )));
});
