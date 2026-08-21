import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { createRequestHandler } from '../src/app.js';

const EXPECTED_COUNT = 128;
const EXPECTED_SHA256 = '65a80a13c9945173f0b8169d3a4e02e5ef80524d4c67021ad67ddc8906a97eed';
const PHASE_2_TOOLS = [
  'slimweb_categories_list',
  'slimweb_categories_upsert',
  'slimweb_categories_delete',
  'slimweb_nav_items_list',
  'slimweb_nav_items_upsert',
  'slimweb_nav_items_delete',
  'slimweb_products_list',
  'slimweb_products_get',
  'slimweb_product_image_reference_prepare',
  'slimweb_products_upsert',
  'slimweb_products_delete',
  'slimweb_products_import_inspect',
  'slimweb_products_import_validate',
  'slimweb_products_import_commit'
];

async function currentToolContract() {
  const server = createServer(createRequestHandler());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(payload.result?.tools));

    return payload.result.tools;
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('SaaS tool contract fixture remains byte-for-byte stable', async () => {
  const expected = JSON.parse(await readFile(
    new URL('./fixtures/saas-tool-contract.json', import.meta.url),
    'utf8'
  ));
  const tools = await currentToolContract();
  const sha256 = createHash('sha256').update(JSON.stringify(tools)).digest('hex');

  assert.equal(tools.length, EXPECTED_COUNT);
  assert.equal(sha256, EXPECTED_SHA256);
  assert.equal(expected.count, EXPECTED_COUNT);
  assert.equal(expected.sha256, EXPECTED_SHA256);
  assert.deepEqual(tools, expected.tools);
});

test('Phase 2 inventory is present in the frozen SaaS contract', async () => {
  const expected = JSON.parse(await readFile(
    new URL('./fixtures/saas-tool-contract.json', import.meta.url),
    'utf8'
  ));
  const names = new Set(expected.tools.map((tool) => tool.name));

  assert.deepEqual(PHASE_2_TOOLS.filter((name) => !names.has(name)), []);
});
