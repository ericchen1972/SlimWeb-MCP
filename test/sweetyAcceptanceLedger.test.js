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

test('Sweety acceptance ledger covers the frozen 153-tool contract exactly once', () => {
  const rows = buildRows(contract.tools);

  assert.equal(contract.count, 153);
  assert.equal(
    contract.sha256,
    '6de1528edc14f51db9dfc25cb6e6df30c0b6382ca9ec5974ed83b0c4b8a3dd14',
  );
  assert.equal(rows.length, 153);
  assert.equal(new Set(rows.map(({ tool }) => tool)).size, 153);
  assert.ok(rows.every(({ tool, siteCode, status, domain }) => (
    siteCode === 'swcb_g3fg1bpnjulrr75o'
      && status === ACCEPTANCE.NOT_RUN
      && domain === classifyDomain(tool)
  )));
});
