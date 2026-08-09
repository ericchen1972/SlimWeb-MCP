import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import {
  BackendRepositoryError,
  SlimWebBackendRepository,
  assertSlimWebBackend
} from '@slimweb/mcp-core/backend-repository';
import {
  BackendError,
  WeblessBackendTransport
} from '../src/backends/weblessBackendTransport.js';

function createRepository({
  idempotencyKeyFactory,
  posterPollIntervalMs,
  posterTimeoutMs,
  ...transportOptions
}) {
  return new SlimWebBackendRepository({
    transport: new WeblessBackendTransport(transportOptions),
    idempotencyKeyFactory,
    posterPollIntervalMs,
    posterTimeoutMs
  });
}

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
    const client = createRepository({
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

test('backend client maps Phase 5 operational settings to versioned Webless endpoints', async () => {
  const requests = [];
  await withJsonServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers, body: await readJson(request) });
    sendJson(response, 200, { ok: true, data: { ok: true, site }, warnings: [] });
  }, async (baseUrl) => {
    const client = createRepository({ baseUrl, secret: 'service-secret', requestIdFactory: () => 'phase5-request-001', idempotencyKeyFactory: () => 'phase5-idempotency-001' });
    await client.getSiteReadiness(actor, { site_id: 101, include_optional: true });
    await client.getSiteLaunchProgress(actor, { site_id: 101 });
    await client.getSeoSettings(actor, { site_id: 101 });
    await client.updateSeoSettings(actor, { site_id: 101, seo_title: 'SEO' });
    await client.getFacebookSettings(actor, { site_id: 101 });
    await client.updateFacebookSettings(actor, { site_id: 101, facebook_app_id: 'app' });
    await client.getNotionSettings(actor, { site_id: 101 });
    await client.updateNotionSettings(actor, { site_id: 101, notion_token: 'token' });
    await client.getContactSettings(actor, { site_id: 101 });
    await client.updateContactSettings(actor, { site_id: 101, contact_email: 'shop@example.com' });
    await client.getDashboardSummary(actor, { site_id: 101 });
  });

  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['GET', '/internal/mcp/v1/sites/swcb_demo/operations/readiness?include_optional=true'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/operations/launch-progress'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/settings/seo'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/settings/seo'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/integrations/facebook'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/integrations/facebook'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/integrations/notion'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/integrations/notion'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/settings/contact'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/settings/contact'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/operations/dashboard-summary']
  ]);
  assert.equal(requests.filter(({ method }) => method === 'PUT').every(({ headers }) => headers['idempotency-key'] === 'phase5-idempotency-001'), true);
});

test('backend client maps Phase 5 communications and admin tools to versioned Webless endpoints', async () => {
  const requests = [];
  await withJsonServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers, body: await readJson(request) });
    sendJson(response, 200, { ok: true, data: { ok: true, site }, warnings: [] });
  }, async (baseUrl) => {
    const client = createRepository({ baseUrl, secret: 'service-secret', requestIdFactory: () => 'phase5-request-002', idempotencyKeyFactory: () => 'phase5-idempotency-002' });
    await client.getMailDeliverySettings(actor, { site_id: 101 });
    await client.updateMailDeliverySettings(actor, { site_id: 101, notification_smtp_host: 'smtp.example.com' });
    await client.getMailTemplates(actor, { site_id: 101 });
    await client.updateMailTemplates(actor, { site_id: 101, templates: [] });
    await client.getMailLayout(actor, { site_id: 101 });
    await client.updateMailLayout(actor, { site_id: 101, html: '{content}' });
    await client.listAdmins(actor, { site_id: 101 });
    await client.upsertAdmin(actor, { site_id: 101, google_email: 'editor@example.com' });
    await client.deleteAdmin(actor, { site_id: 101, admin_id: 9 });
    await client.createNewsletter(actor, { site_id: 101, title: 'News' });
    await client.listNewsletters(actor, { site_id: 101, page: 2, per_page: 5 });
    await client.getNewsletter(actor, { site_id: 101, newsletter_id: 7 });
    await client.updateNewsletter(actor, { site_id: 101, newsletter_id: 7, title: 'Updated' });
    await client.deleteNewsletter(actor, { site_id: 101, newsletter_id: 7 });
  });
  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['GET', '/internal/mcp/v1/sites/swcb_demo/communications/mail-delivery'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/communications/mail-delivery'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/communications/mail-templates'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/communications/mail-templates'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/communications/mail-layout'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/communications/mail-layout'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/operations/admins'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/operations/admins'],
    ['DELETE', '/internal/mcp/v1/sites/swcb_demo/operations/admins/9'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/communications/newsletters'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/communications/newsletters?page=2&per_page=5'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/communications/newsletters/7'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/communications/newsletters/7'],
    ['DELETE', '/internal/mcp/v1/sites/swcb_demo/communications/newsletters/7']
  ]);
});

test('backend client maps Phase 5 integration and operational tools to versioned Webless endpoints', async () => {
  const requests = [];
  await withJsonServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, body: await readJson(request) });
    sendJson(response, 200, { ok: true, data: { ok: true, site }, warnings: [] });
  }, async (baseUrl) => {
    const client = createRepository({ baseUrl, secret: 'service-secret', requestIdFactory: () => 'phase5-request-003', idempotencyKeyFactory: () => 'phase5-idempotency-003' });
    await client.searchNotionPages(actor, { site_id: 101, title: 'KAI' });
    await client.getNotionPageContent(actor, { site_id: 101, notion_page_id: 'page-1' });
    await client.createPoster(actor, { site_id: 101, product_names: ['商品'], drawing_prompt: '促銷' });
    await client.listCustomerServiceLogs(actor, { site_id: 101, page: 2, per_page: 5, member_id: 3, keyword: 'hello' });
    await client.deleteCustomerServiceLog(actor, { site_id: 101, customer_service_log_id: 8 });
    await client.getCustomerServiceSettings(actor, { site_id: 101 });
    await client.updateCustomerServiceSettings(actor, { site_id: 101, use_ai_customer_service: true });
    await client.createExport(actor, { site_id: 101, export_type: 'orders' });
    await client.listAuditLogs(actor, { site_id: 101, limit: 10, tool_name: 'slimweb_orders_list' });
  });
  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['POST', '/internal/mcp/v1/sites/swcb_demo/integrations/notion/pages/search'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/integrations/notion/pages/content'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/operations/posters'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/operations/customer-service/logs?page=2&per_page=5&member_id=3&keyword=hello'],
    ['DELETE', '/internal/mcp/v1/sites/swcb_demo/operations/customer-service/logs/8'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/operations/customer-service/settings'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/operations/customer-service/settings'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/operations/exports'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/operations/audit?limit=10&tool_name=slimweb_orders_list']
  ]);
});

test('backend client keeps poster polling behind the versioned Webless API', async () => {
  const requests = [];
  await withJsonServer(async (request, response) => {
    requests.push([request.method, request.url]);
    await readJson(request);
    if (request.method === 'POST') {
      sendJson(response, 200, { ok: true, data: { queued: true, job_id: 'poster-job-1', status: 'queued' }, warnings: [] });
      return;
    }
    sendJson(response, 200, { ok: true, data: { queued: false, job_id: 'poster-job-1', status: 'completed', image_url: 'https://example.com/poster.webp' }, warnings: [] });
  }, async (baseUrl) => {
    const client = createRepository({ baseUrl, secret: 'service-secret', posterPollIntervalMs: 0, posterTimeoutMs: 1_000 });
    const result = await client.createPoster(actor, { product_names: ['商品'], drawing_prompt: '促銷' });
    assert.equal(result.status, 'completed');
    assert.equal(result.image_url, 'https://example.com/poster.webp');
  });
  assert.deepEqual(requests, [
    ['POST', '/internal/mcp/v1/sites/swcb_demo/operations/posters'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/operations/posters/poster-job-1']
  ]);
});

test('backend client surfaces a failed Webless poster job', async () => {
  await withJsonServer(async (request, response) => {
    await readJson(request);
    const data = request.method === 'POST'
      ? { queued: true, job_id: 'poster-job-failed', status: 'queued' }
      : { queued: false, job_id: 'poster-job-failed', status: 'failed', message: 'Poster failed.' };
    sendJson(response, 200, { ok: true, data, warnings: [] });
  }, async (baseUrl) => {
    const client = createRepository({ baseUrl, secret: 'service-secret', posterPollIntervalMs: 0, posterTimeoutMs: 1_000 });
    await assert.rejects(
      () => client.createPoster(actor, { product_names: ['商品'], drawing_prompt: '促銷' }),
      (error) => error instanceof BackendRepositoryError && error.code === 'UPSTREAM_ERROR' && error.message === 'Poster failed.'
    );
  });
});

test('backend client selects a site through resolved context and an internal theme list including Default', async () => {
  const requests = [];

  await withJsonServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers, body: await readJson(request) });
    if (request.url === '/internal/mcp/v1/site-context/resolve') {
      sendJson(response, 200, { ok: true, data: { actor: { site_id: 101, permissions: ['system_admin'] }, site }, warnings: [] });
      return;
    }
    sendJson(response, 200, { ok: true, data: { themes: [{ id: 1, name: 'Default', is_default: true }] }, warnings: [] });
  }, async (baseUrl) => {
    const client = createRepository({ baseUrl, secret: 'service-secret' });
    const selected = await client.selectSiteForAdminIdentity(identity, { site_code: 'swcb_demo' });
    assert.equal(selected.selected_site.site_code, 'swcb_demo');
    assert.equal(selected.themes[0].is_default, true);
  });

  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['POST', '/internal/mcp/v1/site-context/resolve'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/themes?include_default=1']
  ]);
  assert.equal(requests[1].headers['x-slimweb-tool'], 'slimweb_site_select');
});

test('backend client maps all Phase 2 catalog methods without site selectors in bodies', async () => {
  const requests = [];

  await withJsonServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers, body: await readJson(request) });
    sendJson(response, 200, { ok: true, data: { accepted: true }, warnings: [] });
  }, async (baseUrl) => {
    const client = createRepository({
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
    const client = createRepository({
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
    const client = createRepository({ baseUrl, secret: 'service-secret', idempotencyKeyFactory: () => 'idempotency-page-001' });
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
    const client = createRepository({ baseUrl, secret: 'service-secret' });
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
    const client = createRepository({ baseUrl, secret: 'service-secret', idempotencyKeyFactory: () => 'idempotency-theme-001' });
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
    const client = createRepository({ baseUrl, secret: 'service-secret', idempotencyKeyFactory: () => 'idempotency-media-001' });
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

test('backend client maps external asset reads and deletes to site-scoped Webless endpoints', async () => {
  const requests = [];
  await withJsonServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers, body: await readJson(request) });
    sendJson(response, 200, { ok: true, data: { assets: [] }, warnings: [] });
  }, async (baseUrl) => {
    const client = createRepository({ baseUrl, secret: 'service-secret', idempotencyKeyFactory: () => 'idempotency-assets-001' });
    await client.listExternalAssets(actor, { site_id: 101 });
    await client.deleteExternalAsset(actor, { site_id: 101, asset_id: 8 });
  });

  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['GET', '/internal/mcp/v1/sites/swcb_demo/external-assets'],
    ['DELETE', '/internal/mcp/v1/sites/swcb_demo/external-assets/8']
  ]);
  assert.equal(requests[0].headers['idempotency-key'], undefined);
  assert.equal(requests[1].headers['idempotency-key'], 'idempotency-assets-001');
});

test('backend client maps content SEO updates to one idempotent Webless operation', async () => {
  const requests = [];
  await withJsonServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers, body: await readJson(request) });
    sendJson(response, 200, { ok: true, data: { ok: true }, warnings: [] });
  }, async (baseUrl) => {
    const client = createRepository({ baseUrl, secret: 'service-secret', idempotencyKeyFactory: () => 'idempotency-seo-001' });
    await client.updateContentSeo(actor, { site_id: 101, content_type: 'page', workflow_context: 'page_update', page_name: 'brand-story', seo_title: 'Brand' });
  });

  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [['PUT', '/internal/mcp/v1/sites/swcb_demo/content/seo']]);
  assert.equal(requests[0].headers['idempotency-key'], 'idempotency-seo-001');
  assert.equal(requests[0].body.site_id, undefined);
  assert.equal(requests[0].body.seo_title, 'Brand');
});

test('backend client maps ChatGPT attachment imports to Webless-owned image handling', async () => {
  const requests = [];
  await withJsonServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers, body: await readJson(request) });
    sendJson(response, 200, { ok: true, data: { ok: true }, warnings: [] });
  }, async (baseUrl) => {
    const client = createRepository({ baseUrl, secret: 'service-secret', idempotencyKeyFactory: () => 'idempotency-chatgpt-001' });
    await client.importChatGptAttachment(actor, { site_id: 101, image_url: 'https://files.openai.example/a.png', filename: 'a.png', file_id: 'file-1', target_usage: 'page_asset' });
  });

  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [['POST', '/internal/mcp/v1/sites/swcb_demo/media/imports/chatgpt-attachment']]);
  assert.equal(requests[0].headers['idempotency-key'], 'idempotency-chatgpt-001');
  assert.equal(requests[0].body.site_id, undefined);
  assert.equal(requests[0].body.image_url, 'https://files.openai.example/a.png');
});

test('backend client maps Phase 4 payment and logistics settings to the versioned commerce API', async () => {
  const requests = [];
  await withJsonServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers, body: await readJson(request) });
    sendJson(response, 200, { ok: true, data: { accepted: true }, warnings: [] });
  }, async (baseUrl) => {
    const client = createRepository({ baseUrl, secret: 'service-secret', idempotencyKeyFactory: () => 'idempotency-commerce-001' });
    await client.getPaymentLogisticsSettings(actor, { site_id: 101 });
    await client.updatePaymentLogisticsSettings(actor, { site_id: 101, payments: [{ provider: 'ecpay', is_enabled: false }] });
  });

  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['GET', '/internal/mcp/v1/sites/swcb_demo/commerce/settings/providers'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/commerce/settings/providers']
  ]);
  assert.equal(requests[0].headers['x-slimweb-permission'], 'payments_shipping');
  assert.equal(requests[0].headers['idempotency-key'], undefined);
  assert.equal(requests[1].headers['idempotency-key'], 'idempotency-commerce-001');
  assert.equal(requests[1].body.site_id, undefined);
});

test('backend client maps all Phase 4 member and promotion methods to site-scoped commerce endpoints', async () => {
  const requests = [];
  await withJsonServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers, body: await readJson(request) });
    sendJson(response, 200, { ok: true, data: { accepted: true }, warnings: [] });
  }, async (baseUrl) => {
    const client = createRepository({ baseUrl, secret: 'service-secret', idempotencyKeyFactory: () => 'idempotency-member-001' });
    await client.listCouponTemplates(actor, { site_id: 101, status: 'active', page: 2 });
    await client.upsertCouponTemplate(actor, { site_id: 101, name: 'Coupon' });
    await client.issueMemberCoupon(actor, { site_id: 101, member_id: 7, coupon_template_id: 8 });
    await client.listMembers(actor, { site_id: 101, keyword: 'eric', page: 2 });
    await client.getMember(actor, { site_id: 101, member_id: 7 });
    await client.deleteMember(actor, { site_id: 101, member_id: 7 });
    await client.revokeMemberCoupon(actor, { site_id: 101, member_id: 7, member_coupon_id: 9 });
    await client.listDiscountCodes(actor, { site_id: 101, platform: 'web' });
    await client.upsertDiscountCode(actor, { site_id: 101, code: 'SAVE10' });
    await client.deleteDiscountCode(actor, { site_id: 101, discount_code_id: 10 });
    await client.listMemberTiers(actor, { site_id: 101 });
    await client.upsertMemberTier(actor, { site_id: 101, name: 'VIP' });
    await client.deleteMemberTier(actor, { site_id: 101, member_tier_id: 11 });
  });

  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['GET', '/internal/mcp/v1/sites/swcb_demo/commerce/coupon-templates?status=active&page=2'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/commerce/coupon-templates'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/commerce/members/7/coupons'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/commerce/members?keyword=eric&page=2'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/commerce/members/7'],
    ['DELETE', '/internal/mcp/v1/sites/swcb_demo/commerce/members/7'],
    ['DELETE', '/internal/mcp/v1/sites/swcb_demo/commerce/members/7/coupons/9'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/commerce/discount-codes?platform=web'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/commerce/discount-codes'],
    ['DELETE', '/internal/mcp/v1/sites/swcb_demo/commerce/discount-codes/10'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/commerce/member-tiers'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/commerce/member-tiers'],
    ['DELETE', '/internal/mcp/v1/sites/swcb_demo/commerce/member-tiers/11']
  ]);
  for (const index of [1, 2, 5, 6, 8, 9, 11, 12]) assert.equal(requests[index].headers['idempotency-key'], 'idempotency-member-001');
  for (const index of [0, 3, 4, 7, 10]) assert.equal(requests[index].headers['idempotency-key'], undefined);
  assert.ok(requests.every((request) => !Object.hasOwn(request.body ?? {}, 'site_id') && !Object.hasOwn(request.body ?? {}, 'site_code')));
});

test('backend client maps all Phase 4 merchandising methods to site-scoped commerce endpoints', async () => {
  const requests = [];
  await withJsonServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers, body: await readJson(request) });
    sendJson(response, 200, { ok: true, data: { accepted: true }, warnings: [] });
  }, async (baseUrl) => {
    const client = createRepository({ baseUrl, secret: 'service-secret', idempotencyKeyFactory: () => 'merchandising-key-001' });
    await client.listThresholdGifts(actor, { site_id: 101, is_active: true });
    await client.upsertThresholdGift(actor, { site_id: 101, threshold_amount: 2000, product_id: 7 });
    await client.deleteThresholdGift(actor, { site_id: 101, threshold_gift_id: 8 });
    await client.listProductAddOns(actor, { site_id: 101, product_id: 9, is_active: false });
    await client.upsertProductAddOn(actor, { site_id: 101, product_id: 9, add_on_product_id: 10, add_on_price: 100 });
    await client.deleteProductAddOn(actor, { site_id: 101, product_add_on_id: 11 });
  });

  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['GET', '/internal/mcp/v1/sites/swcb_demo/commerce/threshold-gifts?is_active=true'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/commerce/threshold-gifts'],
    ['DELETE', '/internal/mcp/v1/sites/swcb_demo/commerce/threshold-gifts/8'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/commerce/product-add-ons?product_id=9&is_active=false'],
    ['PUT', '/internal/mcp/v1/sites/swcb_demo/commerce/product-add-ons'],
    ['DELETE', '/internal/mcp/v1/sites/swcb_demo/commerce/product-add-ons/11']
  ]);
  assert.deepEqual(requests.filter(({ method }) => method !== 'GET').map(({ headers }) => headers['idempotency-key']), Array(4).fill('merchandising-key-001'));
});

test('backend client maps all Phase 4 order transaction methods to site-scoped commerce endpoints', async () => {
  const requests = [];
  await withJsonServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers, body: await readJson(request) });
    sendJson(response, 200, { ok: true, data: { accepted: true }, warnings: [] });
  }, async (baseUrl) => {
    const client = createRepository({ baseUrl, secret: 'service-secret', idempotencyKeyFactory: () => 'order-key-001' });
    await client.listOrders(actor, { site_id: 101, search_order_no: 'SW', limit: 10 });
    await client.calculateOrderProfitStatistics(actor, { site_id: 101, date_from: '2026-08-01' });
    await client.getOrder(actor, { site_id: 101, order_no: 'SW1' });
    await client.createOrderLogistics(actor, { site_id: 101, order_no: 'SW1', provider: 'hct' });
    await client.markOrderShipped(actor, { site_id: 101, order_id: 1 });
    await client.listPendingReturns(actor, { site_id: 101, limit: 5 });
    await client.createReturnLogistics(actor, { site_id: 101, order_no: 'SW1', provider: 'hct' });
    await client.cancelReturn(actor, { site_id: 101, order_no: 'SW1' });
    await client.completeReturn(actor, { site_id: 101, order_no: 'SW1' });
    await client.completeRefund(actor, { site_id: 101, order_no: 'SW1' });
    await client.createRefund(actor, { site_id: 101, order_no: 'SW1', provider: 'ecpay' });
    await client.updateOrdersStatus(actor, { site_id: 101, order_numbers: ['SW1'], status: 'confirmed' });
    await client.updateOrdersRecipient(actor, { site_id: 101, orders: [{ order_no: 'SW1', recipient_name: 'Eric' }] });
    await client.deleteOrders(actor, { site_id: 101, order_numbers: ['SW1'] });
    await client.getWaybillUrl(actor, { site_id: 101, order_numbers: ['SW1'] });
    await client.getReturnWaybillUrl(actor, { site_id: 101, order_numbers: ['SW1'] });
  });

  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['GET', '/internal/mcp/v1/sites/swcb_demo/commerce/orders?search_order_no=SW&limit=10'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/commerce/orders/profit-statistics?date_from=2026-08-01'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/commerce/orders/detail?order_no=SW1'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/commerce/orders/logistics'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/commerce/orders/mark-shipped'],
    ['GET', '/internal/mcp/v1/sites/swcb_demo/commerce/returns/pending?limit=5'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/commerce/returns/logistics'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/commerce/returns/cancel'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/commerce/returns/complete'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/commerce/refunds/complete'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/commerce/refunds'],
    ['PATCH', '/internal/mcp/v1/sites/swcb_demo/commerce/orders/status'],
    ['PATCH', '/internal/mcp/v1/sites/swcb_demo/commerce/orders/recipient'],
    ['DELETE', '/internal/mcp/v1/sites/swcb_demo/commerce/orders'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/commerce/orders/waybill-url'],
    ['POST', '/internal/mcp/v1/sites/swcb_demo/commerce/returns/waybill-url']
  ]);
  assert.ok(requests.filter(({ method, headers }) => method !== 'GET' && headers['idempotency-key'] !== undefined).every(({ headers }) => headers['idempotency-key'] === 'order-key-001'));
  assert.equal(requests[14].headers['idempotency-key'], undefined);
  assert.equal(requests[15].headers['idempotency-key'], undefined);
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
      const client = createRepository({ baseUrl, secret: 'service-secret' });

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
    const client = createRepository({ baseUrl, secret: 'service-secret' });

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
    const client = createRepository({
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
