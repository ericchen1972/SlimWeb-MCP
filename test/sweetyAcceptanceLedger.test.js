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

test('Sweety acceptance ledger covers the frozen 146-tool contract exactly once', () => {
  const rows = buildRows(contract.tools);

  assert.equal(contract.count, 146);
  assert.equal(
    contract.sha256,
    '98d1cd3bd8844f9f44ebc4b510bec713bc9120950ea3f5a4d35fcde4ea162477',
  );
  assert.equal(rows.length, 146);
  assert.equal(new Set(rows.map(({ tool }) => tool)).size, 146);
  assert.ok(rows.every(({ tool, siteCode, status, domain }) => (
    siteCode === 'swcb_g3fg1bpnjulrr75o'
      && status === ACCEPTANCE.NOT_RUN
      && domain === classifyDomain(tool)
  )));
});
