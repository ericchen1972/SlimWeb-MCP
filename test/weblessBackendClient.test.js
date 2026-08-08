import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import {
  BackendError,
  WeblessBackendClient
} from '../src/backends/weblessBackendClient.js';
import { assertSlimWebBackend } from '../src/backends/slimWebBackend.js';

async function withJsonServer(handler, run) {
  const server = createServer(async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: { code: 'TEST_SERVER_FAILED', message: error.message } }));
    }
  });
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

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
}

const identity = {
  email: 'owner@example.com',
  google_id: 'google-sub'
};
const site = {
  site_id: 101,
  site_code: 'swcb_demo',
  name: 'Demo'
};
const actor = {
  ...identity,
  site_id: 101,
  permissions: ['system_admin'],
  site
};

test('backend client maps site context and settings methods to Webless HTTP', async () => {
  const requests = [];

  await withJsonServer(async (request, response) => {
    const body = await readJson(request);
    requests.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body
    });

    if (request.url === '/internal/mcp/v1/sites') {
      sendJson(response, 200, { ok: true, data: { sites: [site] }, warnings: [] });
      return;
    }
    if (request.url === '/internal/mcp/v1/site-context/resolve') {
      sendJson(response, 200, {
        ok: true,
        data: {
          actor: { site_id: 101, permissions: ['system_admin'] },
          site
        },
        warnings: []
      });
      return;
    }
    if (request.method === 'GET') {
      sendJson(response, 200, {
        ok: true,
        data: { site, settings: { name: 'Demo' } },
        warnings: []
      });
      return;
    }
    sendJson(response, 200, {
      ok: true,
      data: { ok: true, site: { ...site, name: '新名稱' }, settings: { name: '新名稱' } },
      warnings: []
    });
  }, async (baseUrl) => {
    const client = new WeblessBackendClient({
      baseUrl,
      secret: 'service-secret',
      requestIdFactory: () => 'request-client-001',
      idempotencyKeyFactory: () => 'idempotency-client-001'
    });

    assert.equal(assertSlimWebBackend(client), client);
    assert.deepEqual(await client.listSitesForAdminIdentity(identity), [site]);
    assert.deepEqual(
      await client.resolveAdminSiteForIdentity(identity, { site_code: 'swcb_demo' }),
      actor
    );
    assert.equal((await client.getBasicSettings(actor, { site_id: 101 })).settings.name, 'Demo');
    assert.equal((await client.updateBasicSettings(actor, { site_id: 101, name: '新名稱' })).settings.name, '新名稱');
  });

  assert.equal(requests.length, 4);
  for (const request of requests) {
    assert.equal(request.headers['x-slimweb-mcp-secret'], 'service-secret');
    assert.equal(request.headers['x-slimweb-actor-sub'], 'google-sub');
    assert.equal(request.headers['x-slimweb-actor-email'], 'owner@example.com');
    assert.equal(request.headers['x-request-id'], 'request-client-001');
  }
  assert.equal(requests[0].headers['x-slimweb-tool'], 'slimweb_sites_list');
  assert.equal(requests[1].method, 'POST');
  assert.deepEqual(requests[1].body, { site_code: 'swcb_demo' });
  assert.equal(requests[2].headers['x-slimweb-permission'], 'basic_settings');
  assert.equal(requests[3].method, 'PATCH');
  assert.equal(requests[3].headers['idempotency-key'], 'idempotency-client-001');
  assert.deepEqual(requests[3].body, { name: '新名稱' });
});

test('backend client maps all Phase 2 catalog methods without site selectors in bodies', async () => {
  const requests = [];

  await withJsonServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers, body: await readJson(request) });
    sendJson(response, 200, { ok: true, data: { accepted: true }, warnings: [] });
  }, async (baseUrl) => {
    const client = new WeblessBackendClient({
      baseUrl,
      secret: 'service-secret',
      requestIdFactory: () => 'request-catalog-001',
      idempotencyKeyFactory: () => 'idempotency-catalog-001'
    });
    const scoped = { site_id: 101, site_code: 'ignored', name: '洋裝' };

    await client.listCategories(actor, scoped);
    await client.upsertCategory(actor, scoped);
    await client.deleteCategory(actor, { site_id: 101, category_id: 7 });
    await client.listNavItems(actor, scoped);
    await client.upsertNavItem(actor, scoped);
    await client.deleteNavItem(actor, { site_id: 101, nav_item_id: 8 });
    await client.listProducts(actor, { site_id: 101, keyword: 'dress', page: 2 });
    await client.getProduct(actor, { site_id: 101, product_id: 9 });
    await client.prepareProductImageReference(actor, { site_id: 101, media_path: 'sites/101/ref.webp' });
    await client.upsertProduct(actor, scoped);
    await client.deleteProduct(actor, { site_id: 101, product_id: 9 });
    await client.inspectProductImport(actor, { site_id: 101, source: { filename: 'a.csv' } });
    await client.validateProductImport(actor, { site_id: 101, source: {}, mapping: {} });
    await client.commitProductImport(actor, { site_id: 101, source: {}, mapping: {} });
  });

  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['GET', '/internal/mcp/v1/sites/swcb_demo/catalog/categories'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/catalog/categories'],
    ['DELETE', '/internal/mcp/v1/sites/swcb_demo/catalog/categories/7'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/navigation/items'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/navigation/items'],
    ['DELETE', '/internal/mcp/v1/sites/swcb_demo/navigation/items/8'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/catalog/products?keyword=dress&page=2'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/catalog/products/9'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/catalog/product-image-reference'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/catalog/products'],
    ['DELETE', '/internal/mcp/v1/sites/swcb_demo/catalog/products/9'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/catalog/imports/inspect'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/catalog/imports/validate'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/catalog/imports/commit']
  ]);
  for (const request of requests) {
    assert.equal(request.headers['x-request-id'], 'request-catalog-001');
    assert.equal(Object.hasOwn(request.body ?? {}, 'site_id'), false);
    assert.equal(Object.hasOwn(request.body ?? {}, 'site_code'), false);
  }
  for (const index of [1, 2, 4, 5, 9, 10, 13]) {
    assert.equal(requests[index].headers['idempotency-key'], 'idempotency-catalog-001');
  }
  for (const index of [0, 3, 6, 7, 8, 11, 12]) {
    assert.equal(requests[index].headers['idempotency-key'], undefined);
  }
});

test('backend client maps Phase 3 article methods to the versioned content API', async () => {
  const requests = [];
  await withJsonServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers, body: await readJson(request) });
    sendJson(response, 200, { ok: true, data: { accepted: true }, warnings: [] });
  }, async (baseUrl) => {
    const client = new WeblessBackendClient({
      baseUrl,
      secret: 'service-secret',
      requestIdFactory: () => 'request-article-001',
      idempotencyKeyFactory: () => 'idempotency-article-001'
    });
    await client.listArticles(actor, { site_id: 101, page: 2, per_page: 5 });
    await client.checkArticleTitle(actor, { site_id: 101, title: '新文章' });
    await client.getArticleContent(actor, { site_id: 101, article_id: 7 });
    await client.createArticle(actor, { site_id: 101, title: '新文章', content_html: '<p>A</p>' });
    await client.updateArticle(actor, { site_id: 101, article_id: 7, title: '更新文章' });
    await client.deleteArticle(actor, { site_id: 101, article_id: 7 });
  });

  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['GET', '/internal/mcp/v1/sites/swcb_demo/content/articles?page=2&per_page=5'],
    ['GET', `/internal/mcp/v1/sites/swcb_demo/content/articles/title-check?title=${encodeURIComponent('新文章')}`],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/content/articles/7'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/content/articles'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/content/articles'],
    ['DELETE', '/internal/mcp/v1/sites/swcb_demo/content/articles/7']
  ]);
  assert.ok(requests.slice(3).every((request) => request.headers['idempotency-key'] === 'idempotency-article-001'));
  assert.ok(requests.every((request) => !Object.hasOwn(request.body ?? {}, 'site_id')));
});

test('backend client maps Phase 3 page methods to storage-backed content endpoints', async () => {
  const requests = [];
  await withJsonServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers, body: await readJson(request) });
    sendJson(response, 200, { ok: true, data: { accepted: true }, warnings: [] });
  }, async (baseUrl) => {
    const client = new WeblessBackendClient({ baseUrl, secret: 'service-secret', idempotencyKeyFactory: () => 'idempotency-page-001' });
    await client.listPages(actor, { site_id: 101 });
    await client.checkPageTitle(actor, { site_id: 101, title: '品牌故事' });
    await client.getPageContent(actor, { site_id: 101, page_name: 'brand-story' });
    await client.createPage(actor, { site_id: 101, title: '品牌故事', content: { html: '<p>A</p>' } });
    await client.updatePage(actor, { site_id: 101, page_name: 'brand-story', content: { html: '<p>B</p>' } });
    await client.getPagePreviewUrl(actor, { site_id: 101, page_key: 'brand-story', theme_id: 'default' });
    await client.deletePage(actor, { site_id: 101, page_key: 'brand-story' });
  });
  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['GET', '/internal/mcp/v1/sites/swcb_demo/content/pages'],
    ['GET', `/internal/mcp/v1/sites/swcb_demo/content/pages/title-check?title=${encodeURIComponent('品牌故事')}`],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/content/pages/resolve?name=brand-story'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/content/pages'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/content/pages'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/content/pages/preview'],
    ['DELETE', '/internal/mcp/v1/sites/swcb_demo/content/pages/brand-story']
  ]);
  assert.ok([3, 4, 6].every((index) => requests[index].headers['idempotency-key'] === 'idempotency-page-001'));
  assert.equal(requests[5].headers['idempotency-key'], undefined);
});

test('backend client maps signed upload create and commit without database site lookup', async () => {
  const requests = [];
  await withJsonServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, body: await readJson(request) });
    sendJson(response, 200, { ok: true, data: { accepted: true }, warnings: [] });
  }, async (baseUrl) => {
    const client = new WeblessBackendClient({ baseUrl, secret: 'service-secret' });
    await client.createUpload(actor, { site_id: 101, filename: 'a.png', mime_type: 'image/png', size_bytes: 10, target_usage: 'page_asset' });
    await client.commitUpload(actor, { site_id: 101, upload_id: 'upload-123', upload_token: 'token-123' });
  });
  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['POST', '/internal/mcp/v1/sites/swcb_demo/media/uploads'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/media/uploads/upload-123/commit']
  ]);
  assert.ok(requests.every((request) => !Object.hasOwn(request.body, 'site_id')));
});

test('backend client maps remaining Phase 3 theme methods to versioned content endpoints', async () => {
  const requests = [];
  await withJsonServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers, body: await readJson(request) });
    sendJson(response, 200, { ok: true, data: { accepted: true }, warnings: [] });
  }, async (baseUrl) => {
    const client = new WeblessBackendClient({ baseUrl, secret: 'service-secret', idempotencyKeyFactory: () => 'idempotency-theme-001' });
    await client.listThemes(actor, { site_id: 101 });
    await client.getSiteThemeMode(actor, { site_id: 101 });
    await client.getDesignContext(actor, { site_id: 101 });
    await client.updateSiteThemeMode(actor, { site_id: 101, theme_mode: 'dark' });
    await client.createThemeFromDefault(actor, { site_id: 101, name: 'Cute' });
    await client.activateTheme(actor, { site_id: 101, theme_id: 22 });
    await client.deleteTheme(actor, { site_id: 101, theme_id: 22 });
    await client.getThemeShellContext(actor, { site_id: 101, theme_id: 22 });
    await client.updateThemeRootElements(actor, { site_id: 101, theme_id: 22, fragments: { footer: '<footer />' } });
    await client.getThemeStyleProfile(actor, { site_id: 101, theme_id: 22 });
    await client.upsertThemeStyleProfile(actor, { site_id: 101, theme_id: 22, summary: 'Cute' });
    await client.appendThemeStyleProfileRequest(actor, { site_id: 101, theme_id: 22, request: 'More pink' });
  });
  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['GET', '/internal/mcp/v1/sites/swcb_demo/themes'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/theme-mode'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/design-context'],
    ['PATCH', '/internal/mcp/v1/sites/swcb_demo/theme-mode'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/themes'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/themes/22/activate'],
    ['DELETE', '/internal/mcp/v1/sites/swcb_demo/themes/22'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/themes/22/shell-context'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/themes/22/root-elements'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/themes/22/style-profile'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/themes/22/style-profile'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/themes/22/style-profile/requests']
  ]);
  for (const index of [3, 4, 5, 6, 8, 10, 11]) assert.equal(requests[index].headers['idempotency-key'], 'idempotency-theme-001');
  assert.ok(requests.every((request) => !Object.hasOwn(request.body ?? {}, 'site_id') && !Object.hasOwn(request.body ?? {}, 'site_code')));
});

test('backend client maps remaining Phase 3 media methods to Webless-owned storage endpoints', async () => {
  const requests = [];
  await withJsonServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers, body: await readJson(request) });
    sendJson(response, 200, { ok: true, data: { accepted: true }, warnings: [] });
  }, async (baseUrl) => {
    const client = new WeblessBackendClient({ baseUrl, secret: 'service-secret', idempotencyKeyFactory: () => 'idempotency-media-001' });
    await client.getMediaLibraryStats(actor, { site_id: 101, include_unused_assets: true });
    await client.deleteUnusedMedia(actor, { site_id: 101 });
    await client.registerAsset(actor, { site_id: 101, source: { media_path: 'sites/101/mcp-uploads/committed/a.png' }, target_usage: 'home_page' });
  });
  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['GET', '/internal/mcp/v1/sites/swcb_demo/media/library/stats?include_unused_assets=true'],
    ['DELETE', '/internal/mcp/v1/sites/swcb_demo/media/library/unused'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/media/assets/register']
  ]);
  assert.equal(requests[0].headers['idempotency-key'], undefined);
  assert.equal(requests[1].headers['idempotency-key'], 'idempotency-media-001');
  assert.equal(requests[2].headers['idempotency-key'], 'idempotency-media-001');
});

test('backend client maps Webless error envelopes to stable errors', async () => {
  const cases = [
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [422, 'VALIDATION_FAILED'],
    [409, 'IDEMPOTENCY_CONFLICT'],
    [500, 'INTERNAL_ERROR']
  ];

  for (const [status, code] of cases) {
    await withJsonServer(async (_request, response) => {
      sendJson(response, status, {
        ok: false,
        error: { code, message: `failure-${status}`, details: { status } },
        request_id: `request-${status}`
      });
    }, async (baseUrl) => {
      const client = new WeblessBackendClient({ baseUrl, secret: 'service-secret' });

      await assert.rejects(
        () => client.listSitesForAdminIdentity(identity),
        (error) => error instanceof BackendError
          && error.code === code
          && error.status === status
          && error.requestId === `request-${status}`
          && error.details.status === status
      );
    });
  }
});

test('backend client rejects malformed successful envelopes', async () => {
  await withJsonServer(async (_request, response) => {
    sendJson(response, 200, { data: { sites: [] } });
  }, async (baseUrl) => {
    const client = new WeblessBackendClient({ baseUrl, secret: 'service-secret' });

    await assert.rejects(
      () => client.listSitesForAdminIdentity(identity),
      (error) => error instanceof BackendError
        && error.code === 'UPSTREAM_INVALID_RESPONSE'
    );
  });
});

test('backend client reports request timeout without falling back', async () => {
  await withJsonServer(async (_request, response) => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    sendJson(response, 200, { ok: true, data: { sites: [] }, warnings: [] });
  }, async (baseUrl) => {
    const client = new WeblessBackendClient({
      baseUrl,
      secret: 'service-secret',
      timeoutMs: 10
    });

    await assert.rejects(
      () => client.listSitesForAdminIdentity(identity),
      (error) => error instanceof BackendError
        && error.code === 'UPSTREAM_TIMEOUT'
    );
  });
});

test('backend interface assertion identifies missing methods', () => {
  assert.throws(
    () => assertSlimWebBackend({}),
    /SlimWebBackend is missing listSitesForAdminIdentity\(\)/
  );
});
