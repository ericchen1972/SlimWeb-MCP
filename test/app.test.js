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

test('MCP tools list includes input schemas', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 21,
        method: 'tools/list'
      })
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.id, 21);
    assert.ok(Array.isArray(body.result.tools));

    for (const tool of body.result.tools) {
      assert.equal(typeof tool.inputSchema, 'object');
      assert.equal(tool.inputSchema.type, 'object');
      assert.equal(typeof tool.inputSchema.properties, 'object');
    }
  });
});

test('MCP tools list includes homepage editing contract tools', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 22,
        method: 'tools/list'
      })
    });

    const body = await response.json();
    const toolsByName = new Map(body.result.tools.map((tool) => [tool.name, tool]));

    for (const toolName of [
      'slimweb.site.select',
      'slimweb.themes.list',
      'slimweb.themes.create_from_default',
      'slimweb.themes.update_root_elements',
      'slimweb.assets.upload',
      'slimweb.pages.get_home_content',
      'slimweb.pages.update_home_content',
      'slimweb.preview.get_page_url'
    ]) {
      assert.ok(toolsByName.has(toolName), `${toolName} should be discoverable`);
    }

    assert.equal(toolsByName.get('slimweb.themes.create_from_default').inputSchema.required.includes('name'), true);
    assert.equal(toolsByName.get('slimweb.themes.update_root_elements').inputSchema.required.includes('theme_id'), true);
    assert.equal(toolsByName.get('slimweb.assets.upload').inputSchema.required.includes('source'), true);
    assert.equal(toolsByName.get('slimweb.pages.update_home_content').inputSchema.required.includes('content'), true);
    assert.equal(toolsByName.get('slimweb.preview.get_page_url').inputSchema.required.includes('page_key'), true);
  });
});

test('homepage editing tools call repository implementations', async () => {
  const calls = [];
  const repository = {
    upsertGoogleAccount: async () => ({
      id: 13,
      email: 'owner@example.com',
      name: 'Owner',
      google_id: 'google-sub-planned'
    }),
    listSitesForAccount: async () => [],
    selectSiteForAccount: async (accountId, args) => {
      calls.push(['select', accountId, args]);
      return { selected_site: { id: args.site_id, slug: 'site-1' } };
    },
    listThemesForAccountSite: async (accountId, args) => {
      calls.push(['themes_list', accountId, args]);
      return { themes: [{ id: 1, name: 'Default' }] };
    },
    createThemeFromDefault: async (accountId, args) => {
      calls.push(['themes_create', accountId, args]);
      return { theme: { id: 22, name: args.name }, copied_from_default: true };
    },
    updateThemeRootElements: async (accountId, args) => {
      calls.push(['themes_root', accountId, args]);
      return { ok: true, theme: { id: args.theme_id }, updated_fragments: Object.keys(args.fragments ?? {}) };
    },
    getPagePreviewUrl: async (accountId, args) => {
      calls.push(['preview', accountId, args]);
      return { url: `https://slimweb.tw/sites/site-1/default-preview?mcp_page_key=${args.page_key}` };
    },
    getHomeContent: async (accountId, args) => {
      calls.push(['get_home', accountId, args]);
      return { content: { html: '<section>Home</section>' } };
    },
    updateHomeContent: async (accountId, args) => {
      calls.push(['update_home', accountId, args]);
      return { ok: true, storage_path: 'sites/101/templates/default/pages/index/content.blade.php' };
    },
    uploadAsset: async (accountId, args) => {
      calls.push(['upload', accountId, args]);
      return { ok: true, public_url: 'https://slimweb.tw/sites/site-1/template-assets/1/assets/mcp/hero.png' };
    }
  };

  await withServerOptions({
    googleVerifier: {
      verify: async () => ({
        sub: 'google-sub-planned',
        email: 'owner@example.com',
        name: 'Owner'
      })
    },
    accountRepository: repository,
    sessionSecret: 'test-secret'
  }, async (baseUrl) => {
    const loginResponse = await fetch(`${baseUrl}/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential: 'google-id-token' })
    });
    const token = (await loginResponse.json()).session.access_token;

    const callTool = async (id, name, args) => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: {
            name,
            arguments: args
          }
        })
      });

      assert.equal(response.status, 200);
      return response.json();
    };

    assert.equal((await callTool(23, 'slimweb.site.select', { site_id: 101 })).result.content[0].json.selected_site.slug, 'site-1');
    assert.equal((await callTool(24, 'slimweb.themes.list', { site_id: 101 })).result.content[0].json.themes.length, 1);
    assert.equal((await callTool(25, 'slimweb.themes.create_from_default', { site_id: 101, name: '可愛版型' })).result.content[0].json.theme.id, 22);
    assert.equal((await callTool(26, 'slimweb.themes.update_root_elements', { site_id: 101, theme_id: 22, fragments: { navbar: '<nav>cute</nav>' } })).result.content[0].json.ok, true);
    assert.match((await callTool(27, 'slimweb.preview.get_page_url', { site_id: 101, page_key: 'index' })).result.content[0].json.url, /mcp_page_key=index/);
    assert.equal((await callTool(28, 'slimweb.pages.get_home_content', { site_id: 101 })).result.content[0].json.content.html, '<section>Home</section>');
    assert.equal((await callTool(29, 'slimweb.pages.update_home_content', { site_id: 101, content: { html: '<section>New</section>' } })).result.content[0].json.ok, true);
    assert.match((await callTool(30, 'slimweb.assets.upload', {
      site_id: 101,
      source: { data_base64: Buffer.from('image').toString('base64'), mime_type: 'image/png' },
      target_usage: 'home_page',
      asset_scope: 'page'
    })).result.content[0].json.public_url, /hero\.png/);

    assert.deepEqual(calls.map((call) => call[0]), ['select', 'themes_list', 'themes_create', 'themes_root', 'preview', 'get_home', 'update_home', 'upload']);
    assert.deepEqual(calls.map((call) => call[1]), [13, 13, 13, 13, 13, 13, 13, 13]);
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

test('Google login failure returns a visible error message', async () => {
  await withServerOptions({
    googleVerifier: {
      verify: async () => {
        const error = new Error('Invalid Google account.');
        error.code = 'INVALID_GOOGLE_ACCOUNT';
        throw error;
      }
    },
    accountRepository: {
      upsertGoogleAccount: async () => {
        throw new Error('should not be called');
      },
      listSitesForAccount: async () => []
    },
    sessionSecret: 'test-secret'
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential: 'bad-token' })
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error.code, 'INVALID_GOOGLE_ACCOUNT');
    assert.equal(body.error.message, 'Invalid Google account.');
  });
});

test('auth success page shows only the raw bearer token for AI client setup', async () => {
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
    assert.doesNotMatch(html, /Authorization:\s*Bearer/);
    assert.doesNotMatch(html, /<textarea[^>]*>Bearer\s+/);
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
