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
    '65a80a13c9945173f0b8169d3a4e02e5ef80524d4c67021ad67ddc8906a97eed',
  );
  assert.equal(rows.length, 128);
  assert.equal(new Set(rows.map(({ tool }) => tool)).size, 128);
  assert.ok(rows.every(({ tool, siteCode, status, domain }) => (
    siteCode === 'swcb_g3fg1bpnjulrr75o'
      && status === ACCEPTANCE.NOT_RUN
      && domain === classifyDomain(tool)
  )));
});
