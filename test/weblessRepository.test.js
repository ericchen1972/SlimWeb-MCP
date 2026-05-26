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

function themeMutationPool() {
  const queries = [];
  let insertedThemeId = 22;

  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });

      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }

      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        return {
          rows: [{
            id: params[1],
            slug: 'site-1',
            name: '測試網站',
            domain: '',
            status: 'active',
            site_status: 'published'
          }]
        };
      }

      if (sql.includes('coalesce(max(sort_order), 0)')) {
        return { rows: [{ next_sort_order: 3 }] };
      }

      if (sql.includes('insert into site_pages')) {
        return {
          rows: [{
            id: insertedThemeId++,
            site_id: params[0],
            name: params[1],
            is_default: false,
            is_active: false,
            theme_mode: params[2]
          }]
        };
      }

      if (sql.includes('where site_id = $1 and id = $2')) {
        return {
          rows: [{
            id: params[1],
            site_id: params[0],
            name: '可愛版型',
            is_default: false,
            is_active: false,
            theme_mode: 'light'
          }]
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

function designContextPool() {
  return {
    async query(sql, params) {
      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        return {
          rows: [{
            id: params[1],
            slug: 'site-1',
            name: '測試網站',
            domain: '',
            status: 'active',
            site_status: 'published'
          }]
        };
      }

      if (sql.includes('from site_pages') && sql.includes('where site_id = $1 and id = $2')) {
        return {
          rows: [{
            id: params[1],
            site_id: params[0],
            name: '可愛版型',
            is_default: false,
            is_active: false,
            theme_mode: 'light'
          }]
        };
      }

      if (sql.includes('from site_nav_items')) {
        return {
          rows: [
            { id: 1, parent_id: null, name: '商品分類', item_type: 'dropdown', url: null, icon_svg: '<svg></svg>', icon_path: null, sort_order: 0 },
            { id: 2, parent_id: 1, name: '女生包包', item_type: 'link', url: '/products?category=10', icon_svg: null, icon_path: null, sort_order: 1 }
          ]
        };
      }

      if (sql.includes('from site_categories')) {
        return {
          rows: [
            { id: 10, parent_id: null, name: '女生包包', icon_svg: null, icon_path: null, image_path: null, sort_order: 0 }
          ]
        };
      }

      if (sql.includes('contact_email') && sql.includes('from sites')) {
        return {
          rows: [{
            contact_email: 'owner@example.com',
            contact_line: 'https://line.me/example',
            contact_wechat: null,
            contact_telegram: null,
            contact_twitter: null,
            contact_instagram: 'https://instagram.com/example',
            contact_facebook_page: 'https://facebook.com/example',
            contact_store_address: '台北市內湖區',
            contact_phone: '0226346000',
            contact_mobile: '0975892729',
            contact_tax_id: null,
            contact_copyright: '© SlimWeb',
            use_ai_customer_service: true,
            ai_api_key: 'secret',
            ai_model_name: 'gpt-test'
          }]
        };
      }

      if (sql.includes('from site_faqs')) {
        return { rows: [{ count: '3' }] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

function styleProfilePool() {
  const state = {
    profile: null
  };

  return {
    state,
    async query(sql, params) {
      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        return {
          rows: [{
            id: params[1],
            slug: 'site-1',
            name: '測試網站',
            domain: '',
            status: 'active',
            site_status: 'published'
          }]
        };
      }

      if (sql.includes('from site_pages') && sql.includes('where site_id = $1 and id = $2')) {
        return {
          rows: [{
            id: params[1],
            site_id: params[0],
            name: '可愛版型',
            is_default: false,
            is_active: false,
            theme_mode: 'light'
          }]
        };
      }

      if (sql.includes('insert into site_theme_style_profiles')) {
        state.profile = {
          id: 5,
          site_id: params[0],
          site_page_id: params[1],
          summary: params[2],
          target_audience: params[3],
          visual_keywords: JSON.parse(params[4]),
          color_notes: params[5],
          typography_notes: params[6],
          layout_notes: params[7],
          illustration_notes: params[8],
          avoid_notes: params[9],
          user_requests: JSON.parse(params[10]),
          ai_design_notes: params[11],
          version: 1,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        return { rows: [state.profile] };
      }

      if (sql.includes('from site_theme_style_profiles')) {
        return { rows: state.profile ? [state.profile] : [] };
      }

      if (sql.includes('update site_theme_style_profiles')) {
        const nextRequests = JSON.parse(params[0]);
        state.profile = {
          ...state.profile,
          user_requests: nextRequests,
          version: state.profile.version + 1
        };

        return { rows: [state.profile] };
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
    /HTML content cannot include/
  );
});

test('repository creates a theme by copying only default shell files', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const pool = themeMutationPool();
  const repository = new WeblessAccountRepository(pool, {
    storageRoot,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  await repository.storage.write('sites/101/templates/default/pages/index/content.blade.php', Buffer.from('<section>Default home</section>'));
  await repository.storage.write('sites/101/templates/default/root-elements/navbar.blade.php', Buffer.from('<nav>Default nav</nav>'));
  await repository.storage.write('sites/101/templates/default/assets/root-elements/css/00-base.css', Buffer.from('.nav{display:flex}'));

  const result = await repository.createThemeFromDefault(11, {
    site_id: 101,
    name: '可愛版型',
    theme_mode: 'light'
  });

  assert.equal(result.theme.id, 22);
  assert.equal(result.theme.name, '可愛版型');
  assert.equal(result.copied_from_default, true);
  assert.equal(result.content_fallback, 'default');
  await assert.rejects(
    readFile(path.join(storageRoot, 'sites/101/templates/schemes/22/pages/index/body.blade.php'), 'utf8'),
    /ENOENT/
  );
  assert.equal(
    await readFile(path.join(storageRoot, 'sites/101/templates/schemes/22/root-elements/navbar.blade.php'), 'utf8'),
    '<nav>Default nav</nav>'
  );
  assert.equal(
    await readFile(path.join(storageRoot, 'sites/101/templates/schemes/22/assets/root-elements/css/00-base.css'), 'utf8'),
    '.nav{display:flex}'
  );
  assert.equal(pool.queries.some((query) => query.sql === 'BEGIN'), true);
  assert.equal(pool.queries.some((query) => query.sql === 'COMMIT'), true);
});

test('repository returns theme shell context for design reference', async () => {
  const repository = new WeblessAccountRepository(designContextPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const context = await repository.getThemeShellContext(11, {
    site_id: 101,
    theme_id: 22
  });

  assert.equal(context.reference_only, true);
  assert.equal(context.theme.id, 22);
  assert.equal(context.navbar.counts.total_items, 2);
  assert.deepEqual(context.navbar.item_names, ['商品分類', '女生包包']);
  assert.equal(context.product_categories.counts.total_items, 1);
  assert.equal(context.footer.counts.contact_items, 8);
  assert.equal(context.online_support.enabled, true);
});

test('repository stores and appends theme style profile', async () => {
  const pool = styleProfilePool();
  const repository = new WeblessAccountRepository(pool, {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'))
  });

  const upserted = await repository.upsertThemeStyleProfile(11, {
    site_id: 101,
    theme_id: 22,
    summary: '童趣、柔和、手繪插圖',
    visual_keywords: ['童趣', '手繪'],
    color_notes: '暖色但不要整頁橘色',
    user_request: '建立可愛版型'
  });
  const appended = await repository.appendThemeStyleProfileRequest(11, {
    site_id: 101,
    theme_id: 22,
    request: '背景補上像手繪的插圖',
    ai_notes: '維持 navbar/footer 資料結構'
  });
  const read = await repository.getThemeStyleProfile(11, {
    site_id: 101,
    theme_id: 22
  });

  assert.equal(upserted.profile.summary, '童趣、柔和、手繪插圖');
  assert.equal(appended.profile.user_requests.length, 2);
  assert.equal(read.profile.visual_keywords[0], '童趣');
});

test('repository updates root element fragments and css for a custom theme', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const result = await repository.updateThemeRootElements(11, {
    site_id: 101,
    theme_id: 22,
    fragments: {
      navbar: '<nav class="cute-nav">Cute</nav>',
      footer: '<footer>Cute footer</footer>'
    },
    css: '.cute-nav{background:#fff7d6}'
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.updated_fragments, ['navbar', 'footer']);
  assert.equal(
    await readFile(path.join(storageRoot, 'sites/101/templates/schemes/22/root-elements/navbar.blade.php'), 'utf8'),
    '<nav class="cute-nav">Cute</nav>\n'
  );
  assert.equal(
    await readFile(path.join(storageRoot, 'sites/101/templates/schemes/22/root-elements/footer.blade.php'), 'utf8'),
    '<footer>Cute footer</footer>\n'
  );
  assert.equal(
    await readFile(path.join(storageRoot, 'sites/101/templates/schemes/22/assets/root-elements/css/00-mcp-theme.css'), 'utf8'),
    '.cute-nav{background:#fff7d6}\n'
  );
});
