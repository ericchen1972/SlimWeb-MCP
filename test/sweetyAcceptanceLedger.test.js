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

test('Sweety acceptance ledger covers the frozen 151-tool contract exactly once', () => {
  const rows = buildRows(contract.tools);

  assert.equal(contract.count, 151);
  assert.equal(
    contract.sha256,
    '9f0d29278280ad147ec10a639fd49929119d8a75a688a3c6eaa425b7d495ad44',
  );
  assert.equal(rows.length, 151);
  assert.equal(new Set(rows.map(({ tool }) => tool)).size, 151);
  assert.ok(rows.every(({ tool, siteCode, status, domain }) => (
    siteCode === 'swcb_g3fg1bpnjulrr75o'
      && status === ACCEPTANCE.NOT_RUN
      && domain === classifyDomain(tool)
  )));
});
