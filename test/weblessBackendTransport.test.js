import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { BackendError, WeblessBackendTransport } from '../src/backends/weblessBackendTransport.js';

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
}

test('SaaS transport sends environment-specific headers and parses data', async () => {
  let received;
  await withServer(async (request, response) => {
    received = { method: request.method, url: request.url, headers: request.headers, body: await readJson(request) };
    response.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'response-request' });
    response.end(JSON.stringify({ ok: true, data: { saved: true } }));
  }, async (baseUrl) => {
    const transport = new WeblessBackendTransport({
      baseUrl,
      secret: 'service-secret',
      requestIdFactory: () => 'request-001'
    });
    assert.deepEqual(await transport.request({
      method: 'PUT',
      path: '/internal/mcp/v1/sites/swcb_demo/settings/seo',
      identity: { google_id: 'google-sub', email: 'owner@example.com' },
      tool: 'slimweb_seo_settings_update',
      permission: 'seo_settings',
      idempotencyKey: 'idempotency-001',
      body: { seo_title: 'Demo' }
    }), { saved: true });
  });

  assert.equal(received.method, 'PUT');
  assert.equal(received.url, '/internal/mcp/v1/sites/swcb_demo/settings/seo');
  assert.equal(received.headers['x-slimweb-mcp-secret'], 'service-secret');
  assert.equal(received.headers['x-slimweb-actor-sub'], 'google-sub');
  assert.equal(received.headers['x-slimweb-actor-email'], 'owner@example.com');
  assert.equal(received.headers['x-slimweb-tool'], 'slimweb_seo_settings_update');
  assert.equal(received.headers['x-slimweb-permission'], 'seo_settings');
  assert.equal(received.headers['x-request-id'], 'request-001');
  assert.equal(received.headers['idempotency-key'], 'idempotency-001');
  assert.deepEqual(received.body, { seo_title: 'Demo' });
});

test('SaaS transport maps safe backend errors without leaking response internals', async () => {
  await withServer((_request, response) => {
    response.writeHead(422, { 'content-type': 'application/json', 'x-request-id': 'response-request' });
    response.end(JSON.stringify({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'Invalid SEO', details: { seo_title: ['Required'] } } }));
  }, async (baseUrl) => {
    const transport = new WeblessBackendTransport({ baseUrl, secret: 'service-secret' });
    await assert.rejects(
      transport.request({ method: 'PUT', path: '/internal/mcp/v1/test', identity: {}, tool: 'test', body: {} }),
      (error) => error instanceof BackendError
        && error.code === 'VALIDATION_FAILED'
        && error.status === 422
        && error.details.seo_title[0] === 'Required'
        && error.requestId === 'response-request'
    );
  });
});

test('SaaS transport requires base URL and service secret', () => {
  assert.throws(() => new WeblessBackendTransport({ secret: 'secret' }), /baseUrl is required/);
  assert.throws(() => new WeblessBackendTransport({ baseUrl: 'https://example.com' }), /secret is required/);
});
