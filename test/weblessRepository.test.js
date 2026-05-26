import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  GcsStorageAdapter,
  databaseConfigFromEnv,
  WeblessAccountRepository,
  createStorageAdapter
} from '../src/weblessRepository.js';

function fakePool() {
  return {
    async query(sql, params) {
      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        assert.equal(params[0], 11);
        assert.equal(params[1], 101);

        return {
          rows: [{
            id: 101,
            slug: 'site-1',
            name: '測試網站',
            domain: '',
            status: 'active',
            site_status: 'published'
          }]
        };
      }

      if (sql.includes('from site_pages') && sql.includes('where site_id = $1') && sql.includes('is_active = true')) {
        assert.equal(params[0], 101);

        return {
          rows: [{
            id: 7,
            site_id: 101,
            name: 'Default',
            is_default: true,
            is_active: true,
            theme_mode: 'light'
          }]
        };
      }

      if (sql.includes('from site_pages') && sql.includes('where site_id = $1') && sql.includes('order by is_default desc, sort_order asc')) {
        return {
          rows: [{
            id: 7,
            site_id: 101,
            name: 'Default',
            is_default: true,
            is_active: true,
            theme_mode: 'light'
          }]
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

test('database config enables SSL when DB_SSLMODE is require', () => {
  const config = databaseConfigFromEnv({
    DB_HOST: 'db.example.com',
    DB_PORT: '5433',
    DB_DATABASE: 'webless',
    DB_USERNAME: 'postgres',
    DB_PASSWORD: 'secret',
    DB_SSLMODE: 'require'
  });

  assert.equal(config.host, 'db.example.com');
  assert.equal(config.port, 5433);
  assert.deepEqual(config.ssl, {
    rejectUnauthorized: false
  });
});

test('database config leaves SSL disabled by default', () => {
  const config = databaseConfigFromEnv({
    DB_HOST: 'localhost',
    DB_PORT: '5432',
    DB_DATABASE: 'webless',
    DB_USERNAME: 'postgres',
    DB_PASSWORD: 'secret'
  });

  assert.equal(config.ssl, undefined);
});

test('storage adapter uses GCS when GCS_BUCKET is configured', () => {
  const adapter = createStorageAdapter({
    gcsBucket: 'webless_bucket',
    fetchImpl: async () => new Response(JSON.stringify({
      access_token: 'token',
      expires_in: 3600
    }), { status: 200 })
  });

  assert.equal(adapter instanceof GcsStorageAdapter, true);
});

test('repository updates and reads Webless homepage content files', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const repository = new WeblessAccountRepository(fakePool(), {
    storageRoot,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const update = await repository.updateHomeContent(11, {
    site_id: 101,
    content: {
      html: '<section class="hero">Hello</section>'
    }
  });

  assert.equal(update.ok, true);
  assert.equal(update.storage_path, 'sites/101/templates/default/pages/index/content.blade.php');
  assert.equal(
    await readFile(path.join(storageRoot, update.storage_path), 'utf8'),
    '<section class="hero">Hello</section>\n'
  );

  const read = await repository.getHomeContent(11, { site_id: 101 });

  assert.equal(read.exists, true);
  assert.equal(read.content.html, '<section class="hero">Hello</section>\n');
});

test('repository updates and reads Webless homepage content files in GCS', async () => {
  const objects = new Map();
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });

    if (url === 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token') {
      return new Response(JSON.stringify({
        access_token: 'metadata-token',
        expires_in: 3600
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (String(url).startsWith('https://storage.googleapis.com/upload/storage/v1/b/webless_bucket/o')) {
      const parsed = new URL(url);
      objects.set(parsed.searchParams.get('name'), {
        body: Buffer.from(options.body).toString('utf8'),
        contentType: options.headers['content-type']
      });

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (String(url).startsWith('https://storage.googleapis.com/storage/v1/b/webless_bucket/o/')) {
      const objectName = decodeURIComponent(String(url).split('/o/')[1].split('?')[0]);
      const object = objects.get(objectName);

      if (!object) {
        return new Response('not found', { status: 404 });
      }

      return new Response(object.body, {
        status: 200,
        headers: { 'content-type': object.contentType }
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };
  const repository = new WeblessAccountRepository(fakePool(), {
    storageDriver: 'gcs',
    gcsBucket: 'webless_bucket',
    fetchImpl,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const update = await repository.updateHomeContent(11, {
    site_id: 101,
    content: {
      html: '<section class="hero">Hello GCS</section>'
    }
  });
  const read = await repository.getHomeContent(11, { site_id: 101 });

  assert.equal(update.storage_path, 'sites/101/templates/default/pages/index/content.blade.php');
  assert.equal(read.content.html, '<section class="hero">Hello GCS</section>\n');
  assert.equal(objects.get(update.storage_path).contentType, 'text/x-php; charset=utf-8');
  assert.equal(requests.filter((request) => request.url === 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token').length, 1);
});

test('repository uploads page assets under the selected Webless template directory', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const repository = new WeblessAccountRepository(fakePool(), {
    storageRoot,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const upload = await repository.uploadAsset(11, {
    site_id: 101,
    source: {
      data_base64: Buffer.from('image-bytes').toString('base64'),
      mime_type: 'image/png'
    },
    target_usage: 'home_page',
    asset_scope: 'page',
    suggested_filename: 'hero.png',
    alt_text: 'Hero'
  });

  assert.equal(upload.ok, true);
  assert.match(upload.storage_path, /^sites\/101\/templates\/default\/assets\/mcp\/\d+-hero\.png$/);
  assert.match(upload.public_url, /^https:\/\/slimweb\.tw\/sites\/site-1\/template-assets\/7\/assets\/mcp\/\d+-hero\.png$/);
  assert.equal(await readFile(path.join(storageRoot, upload.storage_path), 'utf8'), 'image-bytes');
});

test('repository rejects unsafe inline script content', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const repository = new WeblessAccountRepository(fakePool(), {
    storageRoot
  });

  await assert.rejects(
    repository.updateHomeContent(11, {
      site_id: 101,
      content: {
        html: '<section onclick="alert(1)">Bad</section>'
      }
    }),
    /Homepage content cannot include/
  );
});
