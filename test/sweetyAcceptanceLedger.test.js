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
    'e5e4c662fd241829f532d1a567987698ad6a16e22759dfdea6eeea6c44c7e95b',
  );
  assert.equal(rows.length, 125);
  assert.equal(new Set(rows.map(({ tool }) => tool)).size, 125);
  assert.ok(rows.every(({ tool, siteCode, status, domain }) => (
    siteCode === 'swcb_g3fg1bpnjulrr75o'
      && status === ACCEPTANCE.NOT_RUN
      && domain === classifyDomain(tool)
  )));
});
