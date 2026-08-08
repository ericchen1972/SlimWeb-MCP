import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';

import { createRequestHandler } from '../src/app.js';

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
  const tools = payload.result.tools;
  const fixture = {
    count: tools.length,
    sha256: createHash('sha256').update(JSON.stringify(tools)).digest('hex'),
    tools
  };

  await writeFile(
    new URL('../test/fixtures/saas-tool-contract.json', import.meta.url),
    `${JSON.stringify(fixture, null, 2)}\n`
  );
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
