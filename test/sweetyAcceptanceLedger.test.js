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

test('Sweety acceptance ledger covers the frozen 125-tool contract exactly once', () => {
  const rows = buildRows(contract.tools);

  assert.equal(contract.count, 125);
  assert.equal(
    contract.sha256,
    '9f63fb8ca81bc464b816f7d441efd08bb9f687947e954582108627a5f104808e',
  );
  assert.equal(rows.length, 125);
  assert.equal(new Set(rows.map(({ tool }) => tool)).size, 125);
  assert.ok(rows.every(({ tool, siteCode, status, domain }) => (
    siteCode === 'swcb_g3fg1bpnjulrr75o'
      && status === ACCEPTANCE.NOT_RUN
      && domain === classifyDomain(tool)
  )));
});
