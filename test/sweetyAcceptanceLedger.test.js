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
    '71664e518d8b0a6e7862a7c51c4d60f3b14324fff26a8d6496b25ae65e6841a1',
  );
  assert.equal(rows.length, 146);
  assert.equal(new Set(rows.map(({ tool }) => tool)).size, 146);
  assert.ok(rows.every(({ tool, siteCode, status, domain }) => (
    siteCode === 'swcb_g3fg1bpnjulrr75o'
      && status === ACCEPTANCE.NOT_RUN
      && domain === classifyDomain(tool)
  )));
});
