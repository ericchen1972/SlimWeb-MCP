import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { createRequestHandler } from '../src/app.js';

const EXPECTED_COUNT = 125;
const EXPECTED_SHA256 = 'd6de40eb08a55927c199ae1b227fc29b7bf4010e0bc70a87b14d4d3ed1be6871';

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
