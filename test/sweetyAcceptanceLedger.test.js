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

test('Sweety acceptance ledger covers the frozen 128-tool contract exactly once', () => {
  const rows = buildRows(contract.tools);

  assert.equal(contract.count, 128);
  assert.equal(
    contract.sha256,
    '944c5d2653132540b1406ab34d67c3d12eb0a8ff5c02e243115e640054112afb',
  );
  assert.equal(rows.length, 128);
  assert.equal(new Set(rows.map(({ tool }) => tool)).size, 128);
  assert.ok(rows.every(({ tool, siteCode, status, domain }) => (
    siteCode === 'swcb_g3fg1bpnjulrr75o'
      && status === ACCEPTANCE.NOT_RUN
      && domain === classifyDomain(tool)
  )));
});
