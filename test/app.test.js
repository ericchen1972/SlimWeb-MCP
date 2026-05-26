import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { createRequestHandler } from '../src/app.js';

async function withServer(run) {
  const server = createServer(createRequestHandler());

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function withServerOptions(options, run) {
  const server = createServer(createRequestHandler(options));

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('health endpoint reports service metadata', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.service, 'slimweb-mcp');
  });
});

test('MCP initialize returns server info', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {}
      })
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.id, 1);
    assert.equal(body.result.serverInfo.name, 'slimweb-mcp');
  });
});

test('unknown MCP method returns JSON-RPC method error', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'missing/method'
      })
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.id, 2);
    assert.equal(body.error.code, -32601);
  });
});

test('auth status requires an MCP session', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'slimweb.auth.status',
          arguments: {}
        }
      })
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.id, 3);
    assert.equal(body.error.code, -32001);
    assert.equal(body.error.data.reason, 'AUTH_REQUIRED');
  });
});

test('Google login creates a signed MCP session cookie', async () => {
  await withServerOptions({
    googleVerifier: {
      verify: async () => ({
        sub: 'google-sub-1',
        email: 'owner@example.com',
        name: 'Owner',
        picture: 'https://example.com/avatar.png'
      })
    },
    accountRepository: {
      upsertGoogleAccount: async (profile) => ({
        id: 10,
        email: profile.email,
        name: profile.name,
        google_id: profile.sub
      }),
      listSitesForAccount: async () => []
    },
    sessionSecret: 'test-secret'
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential: 'google-id-token' })
    });

    const body = await response.json();
    const cookie = response.headers.get('set-cookie');

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.account.email, 'owner@example.com');
    assert.match(cookie, /swmcp_session=/);
    assert.equal(body.session.token_type, 'Bearer');
  });
});

test('auth success page shows the bearer token for AI client setup', async () => {
  await withServerOptions({
    googleVerifier: {
      verify: async () => ({
        sub: 'google-sub-token',
        email: 'owner@example.com',
        name: 'Owner'
      })
    },
    accountRepository: {
      upsertGoogleAccount: async (profile) => ({
        id: 12,
        email: profile.email,
        name: profile.name,
        google_id: profile.sub
      }),
      listSitesForAccount: async () => []
    },
    sessionSecret: 'test-secret'
  }, async (baseUrl) => {
    const loginResponse = await fetch(`${baseUrl}/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential: 'google-id-token' })
    });
    const loginBody = await loginResponse.json();
    const cookie = loginResponse.headers.get('set-cookie');

    const successResponse = await fetch(`${baseUrl}/auth/success`, {
      headers: {
        cookie
      }
    });
    const html = await successResponse.text();

    assert.equal(successResponse.status, 200);
    assert.match(html, /Authorization: Bearer/);
    assert.match(html, new RegExp(loginBody.session.access_token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

test('authenticated tools can read account status and sites', async () => {
  await withServerOptions({
    googleVerifier: {
      verify: async () => ({
        sub: 'google-sub-2',
        email: 'owner@example.com',
        name: 'Owner'
      })
    },
    accountRepository: {
      upsertGoogleAccount: async () => ({
        id: 11,
        email: 'owner@example.com',
        name: 'Owner',
        google_id: 'google-sub-2'
      }),
      listSitesForAccount: async (accountId) => {
        assert.equal(accountId, 11);
        return [
          {
            id: 101,
            slug: 'site-1',
            name: '測試網站',
            domain: '',
            status: 'active',
            site_status: 'published'
          }
        ];
      }
    },
    sessionSecret: 'test-secret'
  }, async (baseUrl) => {
    const loginResponse = await fetch(`${baseUrl}/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential: 'google-id-token' })
    });
    const token = (await loginResponse.json()).session.access_token;

    const statusResponse = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'slimweb.auth.status',
          arguments: {}
        }
      })
    });
    const statusBody = await statusResponse.json();

    assert.equal(statusBody.result.content[0].type, 'json');
    assert.equal(statusBody.result.content[0].json.authenticated, true);
    assert.equal(statusBody.result.content[0].json.account.email, 'owner@example.com');

    const sitesResponse = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'slimweb.sites.list',
          arguments: {}
        }
      })
    });
    const sitesBody = await sitesResponse.json();

    assert.equal(sitesBody.result.content[0].json.sites.length, 1);
    assert.equal(sitesBody.result.content[0].json.sites[0].slug, 'site-1');
  });
});
