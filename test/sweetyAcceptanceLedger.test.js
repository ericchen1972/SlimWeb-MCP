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

test('Sweety acceptance ledger covers the frozen 152-tool contract exactly once', () => {
  const rows = buildRows(contract.tools);

  assert.equal(contract.count, 152);
  assert.equal(
    contract.sha256,
    'f708b037959aabb12e909ba5531f37a438869e8af31e9154025037bd804fbc2c',
  );
  assert.equal(rows.length, 152);
  assert.equal(new Set(rows.map(({ tool }) => tool)).size, 152);
  assert.ok(rows.every(({ tool, siteCode, status, domain }) => (
    siteCode === 'swcb_g3fg1bpnjulrr75o'
      && status === ACCEPTANCE.NOT_RUN
      && domain === classifyDomain(tool)
  )));
});
