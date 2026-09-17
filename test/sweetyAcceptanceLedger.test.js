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
    'a017fc23f3b18fc3d416edab822d700c846d9034b0dfd5b8a91d4d5bb2d71495',
  );
  assert.equal(rows.length, 137);
  assert.equal(new Set(rows.map(({ tool }) => tool)).size, 137);
  assert.ok(rows.every(({ tool, siteCode, status, domain }) => (
    siteCode === 'swcb_g3fg1bpnjulrr75o'
      && status === ACCEPTANCE.NOT_RUN
      && domain === classifyDomain(tool)
  )));
});
