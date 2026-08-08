import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  GcsStorageAdapter,
  LocalStorageAdapter,
  databaseConfigFromEnv,
  WeblessAccountRepository,
  createStorageAdapter
} from '../src/weblessRepository.js';

const REMOVED_SITE_INTEGRATION_COLUMNS = [
  'line_login_channel_id',
  'line_login_channel_secret',
  'google_login_client_id',
  'ai_api_url',
  'ai_api_key',
  'ai_model_name',
  'ai_provider'
];

function assertNoRemovedSiteIntegrationColumns(sql) {
  for (const column of REMOVED_SITE_INTEGRATION_COLUMNS) {
    assert.equal(sql.includes(column), false, `query references removed sites column: ${column}`);
  }
}

test('repository delegates migrated SaaS methods without querying PostgreSQL', async () => {
  const calls = [];
  const site = { site_id: 101, site_code: 'swcb_demo', name: 'Demo' };
  const actor = {
    email: 'owner@example.com',
    google_id: 'google-sub',
    site_id: 101,
    permissions: ['system_admin'],
    site
  };
  const backendClient = {
    listSitesForAdminIdentity: async (identity) => {
      calls.push(['list', identity]);
      return [site];
    },
    resolveAdminSiteForIdentity: async (identity, args) => {
      calls.push(['resolve', identity, args]);
      return actor;
    },
    getBasicSettings: async (resolvedActor, args) => {
      calls.push(['get', resolvedActor, args]);
      return { site, settings: { name: 'Demo' } };
    },
    updateBasicSettings: async (resolvedActor, args) => {
      calls.push(['update', resolvedActor, args]);
      return { ok: true, site: { ...site, name: args.name }, settings: { name: args.name } };
    }
  };
  const pool = {
    async query() {
      throw new Error('unexpected SQL');
    }
  };
  const repository = new WeblessAccountRepository(pool, { backendClient });

  assert.deepEqual(await repository.listSitesForAdminIdentity(actor), [site]);
  assert.deepEqual(
    await repository.resolveAdminSiteForIdentity(actor, { site_code: 'swcb_demo' }),
    actor
  );
  assert.equal((await repository.getBasicSettings(actor, { site_id: 101 })).settings.name, 'Demo');
  assert.equal(
    (await repository.updateBasicSettings(actor, { site_id: 101, name: '新名稱' })).settings.name,
    '新名稱'
  );
  assert.deepEqual(calls.map(([method]) => method), ['list', 'resolve', 'get', 'update']);
});

test('Phase 2 methods do not use PostgreSQL or storage when backend client is configured', async () => {
  const calls = [];
  const actor = {
    email: 'owner@example.com',
    google_id: 'google-sub',
    site: { site_id: 101, site_code: 'swcb_demo', name: 'Demo' }
  };
  const methodNames = [
    'listCategories', 'upsertCategory', 'deleteCategory',
    'listNavItems', 'upsertNavItem', 'deleteNavItem',
    'listProducts', 'getProduct', 'prepareProductImageReference',
    'upsertProduct', 'deleteProduct',
    'inspectProductImport', 'validateProductImport', 'commitProductImport'
  ];
  const backendClient = Object.fromEntries(methodNames.map((method) => [
    method,
    async (resolvedActor, args) => {
      calls.push([method, resolvedActor, args]);
      return { method };
    }
  ]));
  backendClient.resolveAdminSiteForIdentity = async () => actor;
  const repository = new WeblessAccountRepository({
    async query() {
      throw new Error('unexpected SQL');
    }
  }, {
    backendClient,
    storage: new Proxy({}, {
      get() {
        return async () => {
          throw new Error('unexpected storage');
        };
      }
    })
  });
  const args = { site_id: 101, category_id: 7, nav_item_id: 8, product_id: 9 };

  for (const method of methodNames) {
    assert.deepEqual(await repository[method](actor, args), { method });
  }
  assert.deepEqual(calls.map(([method]) => method), methodNames);
  assert.ok(calls.every(([, resolvedActor, receivedArgs]) => resolvedActor === actor && receivedArgs === args));
});

test('Phase 3 article methods require the backend client and avoid PostgreSQL and storage', async () => {
  const actor = { site: { site_code: 'swcb_demo' } };
  const methods = ['listArticles', 'checkArticleTitle', 'getArticleContent', 'createArticle', 'updateArticle', 'deleteArticle'];
  const calls = [];
  const backendClient = Object.fromEntries(methods.map((method) => [method, async (resolvedActor, args) => {
    calls.push([method, resolvedActor, args]);
    return { method };
  }]));
  const repository = new WeblessAccountRepository({ async query() { throw new Error('unexpected SQL'); } }, {
    backendClient,
    storage: new Proxy({}, { get() { return async () => { throw new Error('unexpected storage'); }; } })
  });
  const args = { site_id: 101, article_id: 7 };

  for (const method of methods) {
    assert.deepEqual(await repository[method](actor, args), { method });
  }
  assert.deepEqual(calls.map(([method]) => method), methods);
});

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
            site_status: 'active',
            theme_mode: 'dark'
          }]
        };
      }

      if (sql.includes('update sites') && sql.includes('set theme_mode = $2')) {
        return {
          rows: [{
            id: params[0],
            slug: 'site-1',
            name: '測試網站',
            domain: '',
            callback_code: 'swcb_test',
            site_status: 'active',
            theme_mode: params[1]
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

      if (sql.includes('from site_pages') && sql.includes('where site_id = $1 and id = $2')) {
        assert.equal(params[0], 101);
        assert.equal(params[1], 22);

        return {
          rows: [{
            id: 22,
            site_id: 101,
            name: '粉色風格',
            is_default: false,
            is_active: false,
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

      if (sql.includes('from site_pages') && sql.includes('where site_id = $1 and is_default = true')) {
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

test('repository exposes only current Webless site status fields', async () => {
  const repository = new WeblessAccountRepository({
    async query(sql, params) {
      assert.equal(params[0], 11);
      assert.doesNotMatch(sql, /\bstatus\b,\s*site_status/);

      return {
        rows: [{
          id: 101,
          slug: 'site-1',
          name: '測試網站',
          domain: '',
          callback_code: 'swcb_test101',
          site_status: 'maintenance'
        }]
      };
    }
  }, {
    clientMcpBaseUrl: 'https://client-mcp.example.test'
  });

  const sites = await repository.listSitesForAccount(11);

  assert.equal(sites[0].status, undefined);
  assert.equal(sites[0].site_status, 'maintenance');
  assert.equal(sites[0].site_status_label, '維護中');
  assert.equal(sites[0].client_mcp_url, 'https://client-mcp.example.test/sites/swcb_test101/mcp');
});

test('repository resolves admin site identity by site code', async () => {
  const repository = new WeblessAccountRepository({
    async query(sql, params) {
      assert.match(sql, /s\.callback_code = \$1/);
      assert.equal(params[0], 'swcb_test101');
      assert.equal(params[1], 'google-sub');
      assert.equal(params[2], 'owner@example.com');

      return {
        rows: [{
          id: 101,
          slug: 'site-1',
          name: '測試網站',
          domain: '',
          callback_code: 'swcb_test101',
          site_status: 'active',
          theme_mode: 'light',
          account_id: 11,
          site_admin_id: 13,
          google_email: 'owner@example.com',
          google_sub: 'google-sub',
          permissions: JSON.stringify(['backend_ai_assistant']),
          first_admin_id: 13
        }]
      };
    }
  });

  const actor = await repository.resolveAdminSiteForIdentity({
    email: 'owner@example.com',
    google_id: 'google-sub'
  }, {
    site_code: 'swcb_test101'
  });

  assert.equal(actor.site_id, 101);
  assert.equal(actor.site.site_code, 'swcb_test101');
  assert.equal(actor.site.name, '測試網站');
});

function themeMutationPool() {
  const queries = [];
  let insertedThemeId = 22;
  const themes = [
    {
      id: 7,
      site_id: 101,
      name: 'Default',
      is_default: true,
      is_active: true,
      theme_mode: 'light',
      sort_order: 0
    },
    {
      id: 22,
      site_id: 101,
      name: '可愛版型',
      is_default: false,
      is_active: false,
      theme_mode: 'light',
      sort_order: 3
    }
  ];

  return {
    queries,
    themes,
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
            site_status: 'active',
            theme_mode: 'dark'
          }]
        };
      }

      if (sql.includes('update sites') && sql.includes('set theme_mode = $2')) {
        return {
          rows: [{
            id: params[0],
            slug: 'site-1',
            name: '測試網站',
            domain: '',
            callback_code: 'swcb_test',
            site_status: 'active',
            theme_mode: params[1]
          }]
        };
      }

      if (sql.includes('coalesce(max(sort_order), 0)')) {
        return { rows: [{ next_sort_order: 3 }] };
      }

      if (sql.includes('insert into site_pages')) {
        const theme = {
          id: insertedThemeId++,
          site_id: params[0],
          name: params[1],
          is_default: false,
          is_active: false,
          theme_mode: params[2],
          sort_order: params[3]
        };
        themes.push(theme);

        return {
          rows: [theme]
        };
      }

      if (sql.includes('set is_active = false') && sql.includes('where site_id = $1 and is_active = true')) {
        for (const theme of themes) {
          if (theme.site_id === params[0] && theme.is_active) {
            theme.is_active = false;
          }
        }

        return { rows: [] };
      }

      if (sql.includes('set is_active = true') && sql.includes('where site_id = $1 and id = $2')) {
        const theme = themes.find((item) => item.site_id === params[0] && item.id === params[1]);
        theme.is_active = true;

        return { rows: [theme] };
      }

      if (sql.includes('where site_id = $1 and id = $2')) {
        const theme = themes.find((item) => item.site_id === params[0] && item.id === params[1]);

        return {
          rows: theme ? [theme] : []
        };
      }

      if (sql.includes('from site_pages') && sql.includes('order by is_default desc, sort_order asc')) {
        return {
          rows: themes
            .filter((theme) => theme.site_id === params[0])
            .sort((left, right) => Number(right.is_default) - Number(left.is_default) || left.sort_order - right.sort_order || left.id - right.id)
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

function designContextPool(options = {}) {
  return {
    async query(sql, params) {
      if (sql.includes('from information_schema.columns')) {
        return {
          rows: [
            'site_status',
            'member_verification',
            'website_type',
            'default_country_code',
            'product_load_mode',
            'return_days_allowed',
            'category_navigation_mode',
            'icon_path'
          ].map((column_name) => ({ column_name }))
        };
      }

      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        return {
          rows: [{
            id: params[1],
            slug: 'site-1',
            name: '測試網站',
            domain: '',
            site_status: 'active'
          }]
        };
      }

      if (sql.includes('from site_admins a') && sql.includes('inner join sites s on s.id = a.site_id')) {
        return {
          rows: [{
            id: params[0],
            slug: 'site-1',
            name: '測試網站',
            domain: '',
            callback_code: 'swcb_test',
            site_status: 'active',
            icon_path: null,
            account_id: 2,
            site_admin_id: 7,
            google_email: 'admin@example.test',
            google_sub: '',
            permissions: ['backend_ai_assistant', 'page_management_templates'],
            first_admin_id: 7
          }]
        };
      }

      if (sql.includes('from site_admins a') && sql.includes('inner join sites s on s.id = a.site_id')) {
        return {
          rows: [{
            id: params[0],
            slug: 'site-1',
            name: '測試網站',
            domain: '',
            callback_code: 'swcb_test',
            site_status: 'active',
            icon_path: null,
            account_id: 2,
            site_admin_id: 7,
            google_email: 'admin@example.test',
            google_sub: '',
            permissions: ['backend_ai_assistant', 'page_management_templates'],
            first_admin_id: 7
          }]
        };
      }

      if (sql.includes('from site_admins a') && sql.includes('inner join sites s on s.id = a.site_id')) {
        return {
          rows: [{
            id: params[0],
            slug: 'site-1',
            name: '測試網站',
            domain: '',
            callback_code: 'swcb_test',
            site_status: 'active',
            icon_path: null,
            site_admin_id: 7,
            google_email: 'admin@example.test',
            google_sub: '',
            permissions: ['backend_ai_assistant', 'page_management_templates'],
            first_admin_id: 7
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

      if (sql.includes('from site_pages') && sql.includes('where site_id = $1 and is_active = true')) {
        return {
          rows: [{
            id: 22,
            site_id: params[0],
            name: '可愛版型',
            is_default: false,
            is_active: true,
            theme_mode: 'light'
          }]
        };
      }

      if (sql.includes('from site_theme_style_profiles')) {
        return {
          rows: [{
            id: 5,
            site_id: 101,
            site_page_id: 22,
            summary: '童趣、柔和、手繪插圖',
            target_audience: '喜歡溫柔感商品的女生',
            visual_keywords: JSON.stringify(['童趣', '手繪']),
            color_notes: '奶油白搭配珊瑚粉',
            typography_notes: '圓潤標題',
            layout_notes: '大量留白與卡片堆疊',
            illustration_notes: '局部手繪星星',
            avoid_notes: '不要科技感',
            user_requests: JSON.stringify([{ request: '做可愛一點' }]),
            ai_design_notes: '保留既有品牌親和感',
            version: 2,
            is_active: true,
            created_at: '2026-06-10T09:00:00.000Z',
            updated_at: '2026-06-10T10:00:00.000Z'
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

      if (sql.includes('from sites') && sql.includes('where id = $1') && sql.includes('website_type')) {
        return {
          rows: [{
            site_status: 'active',
            member_verification: 'none',
            website_type: options.websiteType ?? 'ecommerce',
            default_country_code: 'TW',
            product_load_mode: 'pagination',
            return_days_allowed: 0,
            category_navigation_mode: options.categoryNavigationMode,
            icon_path: null
          }]
        };
      }

      if (sql.includes('contact_email') && sql.includes('from sites')) {
        assert.doesNotMatch(sql, /\bai_api_key\b/);
        assert.doesNotMatch(sql, /\bai_model_name\b/);

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
            use_ai_customer_service: true
          }]
        };
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
            site_status: 'active'
          }]
        };
      }

      if (sql.includes('from site_admins a') && sql.includes('inner join sites s on s.id = a.site_id')) {
        return {
          rows: [{
            id: params[0],
            slug: 'site-1',
            name: '測試網站',
            domain: '',
            callback_code: 'swcb_test',
            site_status: 'active',
            icon_path: null,
            account_id: 2,
            site_admin_id: 7,
            google_email: 'admin@example.test',
            google_sub: '',
            permissions: ['backend_ai_assistant', 'page_management_templates'],
            first_admin_id: 7
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
          updated_at: new Date().toISOString(),
          created_by_account_id: params[12],
          updated_by_account_id: params[12]
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
          version: state.profile.version + 1,
          updated_by_account_id: params[1]
        };

        return { rows: [state.profile] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

function seoSettingsPool() {
  const state = {
    site: {
      id: 101,
      slug: 'site-1',
      name: '測試網站',
      domain: '',
      callback_code: 'swcb_test101',
      site_status: 'active',
      seo_title: '',
      seo_description: '',
      seo_keywords: '',
      google_analytics_measurement_id: '',
      canonical_url: '',
      robots_policy: 'index,follow',
      og_title: '',
      og_description: '',
      og_image_url: '',
      llms_txt: '',
      aeo_business_summary: '',
      aeo_target_audience: '',
      aeo_products_services: '',
      aeo_customer_questions: '',
      aeo_answer_style: '',
      aeo_entity_facts: '',
      geo_citation_targets: '',
      geo_verifiable_claims: '',
      geo_trust_signals: '',
      geo_same_as_profiles: '',
      geo_comparison_positioning: ''
    }
  };

  return {
    state,
    async query(sql, params) {
      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        assert.equal(params[0], 11);
        assert.equal(params[1], 101);

        return { rows: [state.site] };
      }

      if (sql.includes('from sites') && sql.includes('where id = $1')) {
        assert.equal(params[0], 101);

        return { rows: [state.site] };
      }

      if (sql.includes('update sites') && sql.includes('aeo_business_summary')) {
        state.site = {
          ...state.site,
          seo_title: params[0],
          seo_description: params[1],
          seo_keywords: params[2],
          google_analytics_measurement_id: params[3],
          canonical_url: params[4],
          robots_policy: params[5],
          og_title: params[6],
          og_description: params[7],
          og_image_url: params[8],
          llms_txt: params[9],
          aeo_business_summary: params[10],
          aeo_target_audience: params[11],
          aeo_products_services: params[12],
          aeo_customer_questions: params[13],
          aeo_answer_style: params[14],
          aeo_entity_facts: params[15],
          geo_citation_targets: params[16],
          geo_verifiable_claims: params[17],
          geo_trust_signals: params[18],
          geo_same_as_profiles: params[19],
          geo_comparison_positioning: params[20]
        };

        return { rows: [state.site] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

function readinessPool() {
  const site = {
    id: 101,
    slug: 'site-1',
    name: '測試網站',
    domain: '',
    site_status: 'active',
    member_verification: 'none',
    website_type: 'ecommerce',
    default_country_code: 'TW',
    product_load_mode: 'pagination',
    return_days_allowed: 0,
    category_navigation_mode: 'navbar_categories',
    icon_path: 'sites/101/settings/logo-current.webp',
    callback_code: 'swcb_test101',
    seo_title: '',
    seo_description: '',
    seo_keywords: '',
    canonical_url: '',
    robots_policy: 'index,follow',
    og_title: '',
    og_description: '',
    og_image_url: '',
    llms_txt: '',
    aeo_business_summary: '',
    aeo_target_audience: '',
    aeo_products_services: '',
    aeo_customer_questions: '',
    aeo_answer_style: '',
    aeo_entity_facts: '',
    geo_citation_targets: '',
    geo_verifiable_claims: '',
    geo_trust_signals: '',
    geo_same_as_profiles: '',
    geo_comparison_positioning: '',
    sms_account: null,
    sms_password: null,
    facebook_app_id: null,
    facebook_page_id: null,
    facebook_comment_on_products: false,
    facebook_comment_on_posts: false,
    broadcast_id: null,
    use_ai_customer_service: false,
    ai_customer_service_question_limit: 500,
    ai_customer_service_retention_days: 30,
    google_search_api_key: null,
    google_search_engine_id: null,
    notion_token: null,
    notion_page_id: null
  };

  return {
    async query(sql, params) {
      assertNoRemovedSiteIntegrationColumns(sql);

      if (sql.includes('from information_schema.columns')) {
        return {
          rows: [
            'site_status',
            'member_verification',
            'website_type',
            'default_country_code',
            'product_load_mode',
            'return_days_allowed',
            'category_navigation_mode',
            'icon_path'
          ].map((column_name) => ({ column_name }))
        };
      }

      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        assert.equal(params[0], 11);
        assert.equal(params[1], 101);

        return { rows: [site] };
      }

      if (sql.includes('from sites') && sql.includes('where id = $1') && sql.includes('website_type')) {
        return { rows: [site] };
      }

      if (sql.includes('from sites') && sql.includes('where id = $1') && sql.includes('seo_title')) {
        return { rows: [site] };
      }

      if (sql.includes('from sites') && sql.includes('where id = $1') && sql.includes('facebook_app_id')) {
        return { rows: [site] };
      }

      if (sql.includes('from sites') && sql.includes('where id = $1') && sql.includes('notification_smtp_host')) {
        return { rows: [site] };
      }

      if (sql.includes('from site_mail_layouts')) {
        return { rows: [] };
      }

      if (sql.includes('from site_payment_providers')) {
        return { rows: [] };
      }

      if (sql.includes('from site_logistics_providers')) {
        return { rows: [] };
      }

      if (sql.includes('category_count')) {
        return {
          rows: [{
            category_count: '0',
            product_count: '0',
            active_product_count: '0',
            uncategorized_product_count: '0',
            nav_item_count: '0',
            article_count: '0',
            faq_count: '0',
            admin_count: '1',
            backend_ai_admin_count: '0',
            coupon_template_count: '0',
            discount_code_count: '0'
          }]
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

function integrationSettingsPool() {
  const state = {
    site: {
      id: 101,
      slug: 'site-1',
      name: '測試網站',
      domain: '',
      site_status: 'active',
      sms_account: null,
      sms_password: null,
      facebook_app_id: null,
      facebook_page_id: null,
      facebook_comment_on_products: false,
      facebook_comment_on_posts: false,
      broadcast_id: null,
      use_ai_customer_service: false,
      google_search_api_key: null,
      google_search_engine_id: null,
      line_bot_access_token: null,
      line_bot_channel_secret: null,
      line_bot_user_id: null,
      notion_token: null
    }
  };

  return {
    state,
    async query(sql, params) {
      assertNoRemovedSiteIntegrationColumns(sql);

      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        return { rows: [state.site] };
      }

      if (sql.includes('from sites') && sql.includes('where id = $1')) {
        assert.equal(params[0], 101);

        return { rows: [state.site] };
      }

      if (sql.includes('update sites') && sql.includes('facebook_app_id') && sql.includes('notion_token')) {
        state.site = {
          ...state.site,
          sms_account: params[0],
          sms_password: params[1],
          facebook_app_id: params[2],
          facebook_page_id: params[3],
          facebook_comment_on_products: params[4],
          facebook_comment_on_posts: params[5],
          broadcast_id: params[6],
          use_ai_customer_service: params[7],
          google_search_api_key: params[8],
          google_search_engine_id: params[9],
          line_bot_access_token: params[10],
          line_bot_channel_secret: params[11],
          line_bot_user_id: params[12],
          notion_token: params[13]
        };

        return { rows: [state.site] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

function mailDeliverySettingsPool() {
  const state = {
    site: {
      id: 101,
      slug: 'site-1',
      name: '測試網站',
      domain: '',
      site_status: 'active',
      notification_new_order_sms_numbers: null,
      notification_sms_on_shipped: false,
      notification_auto_send_reminder_sms: false,
      notification_reminder_sms_content: null,
      notification_smtp_host: null,
      notification_smtp_username: null,
      notification_smtp_password: null,
      notification_smtp_port: null,
      notification_smtp_from_email: null,
      notification_smtp_ssl: false
    }
  };

  return {
    state,
    async query(sql, params) {
      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        return { rows: [state.site] };
      }

      if (sql.includes('from sites') && sql.includes('where id = $1') && sql.includes('notification_smtp_host')) {
        assert.equal(params[0], 101);
        return { rows: [state.site] };
      }

      if (sql.includes('update sites') && sql.includes('notification_smtp_host = $5') && sql.includes('notification_smtp_ssl = $10')) {
        state.site = {
          ...state.site,
          notification_new_order_sms_numbers: params[0],
          notification_sms_on_shipped: params[1],
          notification_auto_send_reminder_sms: params[2],
          notification_reminder_sms_content: params[3],
          notification_smtp_host: params[4],
          notification_smtp_username: params[5],
          notification_smtp_password: params[6],
          notification_smtp_port: params[7],
          notification_smtp_from_email: params[8],
          notification_smtp_ssl: params[9]
        };

        return { rows: [state.site] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

function paymentLogisticsPool() {
  const state = {
    site: {
      id: 101,
      slug: 'site-1',
      name: '測試網站',
      domain: '',
      callback_code: 'swcb_test101',
      site_status: 'active',
      shipping_fee: 120
    },
    paymentProviders: [
      { id: 1, site_id: 101, provider: 'newebpay', mode: 'production', is_enabled: true, settings: null, sort_order: 20 }
    ],
    logisticsProviders: [],
    nextPaymentId: 2,
    nextLogisticsId: 1
  };

  return {
    state,
    async query(sql, params) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }

      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        return { rows: [state.site] };
      }

      if (sql.includes('from site_payment_providers') && sql.includes('where site_id = $1 and provider = $2')) {
        return {
          rows: state.paymentProviders.filter((provider) => provider.site_id === params[0] && provider.provider === params[1])
        };
      }

      if (sql.includes('from site_logistics_providers') && sql.includes('where site_id = $1 and provider = $2')) {
        return {
          rows: state.logisticsProviders.filter((provider) => provider.site_id === params[0] && provider.provider === params[1])
        };
      }

      if (sql.includes('from site_payment_providers') && sql.includes('where site_id = $1')) {
        return { rows: state.paymentProviders.filter((provider) => provider.site_id === params[0]) };
      }

      if (sql.includes('from site_logistics_providers') && sql.includes('where site_id = $1')) {
        return { rows: state.logisticsProviders.filter((provider) => provider.site_id === params[0]) };
      }

      if (sql.includes('insert into site_payment_providers')) {
        const existing = state.paymentProviders.find((provider) => provider.site_id === params[0] && provider.provider === params[1]);
        const row = existing ?? { id: state.nextPaymentId++, site_id: params[0], provider: params[1] };
        Object.assign(row, {
          mode: params[2],
          is_enabled: params[3],
          settings: params[4],
          sort_order: params[5]
        });

        if (!existing) {
          state.paymentProviders.push(row);
        }

        return { rows: [row] };
      }

      if (sql.includes('insert into site_logistics_providers')) {
        const existing = state.logisticsProviders.find((provider) => provider.site_id === params[0] && provider.provider === params[1]);
        const row = existing ?? { id: state.nextLogisticsId++, site_id: params[0], provider: params[1] };
        Object.assign(row, {
          mode: params[2],
          is_enabled: params[3],
          settings: params[4],
          sort_order: params[5]
        });

        if (!existing) {
          state.logisticsProviders.push(row);
        }

        return { rows: [row] };
      }

      if (sql.includes('update site_payment_providers') && sql.includes('where site_id = $1')) {
        for (const provider of state.paymentProviders) {
          if (provider.site_id === params[0] && params[1].includes(provider.provider) && provider.provider !== params[2]) {
            provider.is_enabled = false;
          }
        }

        return { rows: [] };
      }

      if (sql.includes('update site_logistics_providers') && sql.includes('provider = any')) {
        for (const provider of state.logisticsProviders) {
          if (provider.site_id === params[0] && params[1].includes(provider.provider) && provider.provider !== params[2]) {
            provider.is_enabled = false;
          }
        }

        return { rows: [] };
      }

      if (sql.includes('update site_logistics_providers') && sql.includes('set mode = $3')) {
        for (const provider of state.logisticsProviders) {
          if (provider.site_id === params[0] && provider.provider === params[1]) {
            provider.mode = params[2];
            provider.is_enabled = params[3];
          }
        }

        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

function articlesPool() {
  const state = {
    nextArticleId: 10,
    articles: [{
      id: 9,
      site_id: 101,
      notion_page_id: null,
      title: '春季穿搭',
      content: '<article>Old</article>',
      cover_path: null,
      created_at: '2026-05-27T00:00:00.000Z',
      updated_at: '2026-05-27T00:00:00.000Z'
    }]
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
            site_status: 'active'
          }]
        };
      }

      if (sql.includes('count(*)::int as total') && sql.includes('from articles')) {
        return { rows: [{ total: String(state.articles.length) }] };
      }

      if (sql.includes('from articles') && sql.includes('where site_id = $1 and lower(trim(title)) = $2')) {
        return {
          rows: state.articles.filter((article) => article.site_id === params[0] && article.title.trim().toLowerCase() === params[1])
        };
      }

      if (sql.includes('from articles') && sql.includes('order by created_at desc')) {
        return { rows: state.articles };
      }

      if (sql.includes('from articles') && sql.includes('where site_id = $1 and id = $2')) {
        return { rows: state.articles.filter((article) => article.site_id === params[0] && article.id === params[1]) };
      }

      if (sql.includes('insert into articles')) {
        const article = {
          id: state.nextArticleId++,
          site_id: params[0],
          notion_page_id: params[1],
          title: params[2],
          content: params[3],
          cover_path: params[4],
          created_at: '2026-05-27T00:00:00.000Z',
          updated_at: '2026-05-27T00:00:00.000Z'
        };
        state.articles.unshift(article);

        return { rows: [article] };
      }

      if (sql.includes('update articles') && sql.includes('set cover_path = $1')) {
        const article = state.articles.find((item) => item.site_id === params[1] && item.id === params[2]);
        article.cover_path = params[0];

        return { rows: [{ id: article.id }] };
      }

      if (sql.includes('update articles')) {
        const article = state.articles.find((item) => item.site_id === params[4] && item.id === params[5]);
        Object.assign(article, {
          notion_page_id: params[0],
          title: params[1],
          content: params[2],
          cover_path: params[3],
          updated_at: '2026-05-27T00:00:00.000Z'
        });

        return { rows: [article] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

function couponPool() {
  const state = {
    nextCouponId: 3,
    nextMemberCouponId: 8,
    coupons: [{
      id: 2,
      site_id: 101,
      name: '手動客服券',
      discount_amount: 100,
      minimum_spend: 0,
      issue_trigger: 'manual',
      trigger_amount: 0,
      starts_at: '2026-01-01',
      ends_at: '2099-12-31',
      created_at: '2026-05-27T00:00:00.000Z',
      updated_at: '2026-05-27T00:00:00.000Z'
    }],
    members: [{
      id: 88,
      site_id: 101,
      email: 'member@example.com',
      name: '會員',
      status: 'active'
    }],
    memberCoupons: []
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
            site_status: 'active'
          }]
        };
      }

      if (sql.includes('count(*)::int as total') && sql.includes('from coupon_templates')) {
        return { rows: [{ total: String(state.coupons.length) }] };
      }

      if (sql.includes('from coupon_templates') && sql.includes('order by updated_at desc')) {
        return { rows: state.coupons };
      }

      if (sql.includes('from coupon_templates') && sql.includes('where site_id = $1 and id = $2')) {
        return { rows: state.coupons.filter((coupon) => coupon.site_id === params[0] && coupon.id === params[1]) };
      }

      if (sql.includes('insert into coupon_templates')) {
        const coupon = {
          id: state.nextCouponId++,
          site_id: params[0],
          name: params[1],
          discount_amount: params[2],
          minimum_spend: params[3],
          issue_trigger: params[4],
          trigger_amount: params[5],
          starts_at: params[6],
          ends_at: params[7],
          created_at: '2026-05-27T00:00:00.000Z',
          updated_at: '2026-05-27T00:00:00.000Z'
        };
        state.coupons.unshift(coupon);

        return { rows: [coupon] };
      }

      if (sql.includes('update coupon_templates')) {
        const coupon = state.coupons.find((item) => item.site_id === params[7] && item.id === params[8]);
        Object.assign(coupon, {
          name: params[0],
          discount_amount: params[1],
          minimum_spend: params[2],
          issue_trigger: params[3],
          trigger_amount: params[4],
          starts_at: params[5],
          ends_at: params[6],
          updated_at: '2026-05-27T00:00:00.000Z'
        });

        return { rows: [coupon] };
      }

      if (sql.trimStart().startsWith('select') && sql.includes('from members') && sql.includes('where site_id = $1 and id = $2')) {
        return { rows: state.members.filter((member) => member.site_id === params[0] && member.id === params[1]) };
      }

      if (sql.includes('from member_coupons') && sql.includes('limit 1')) {
        return {
          rows: state.memberCoupons.filter((coupon) => (
            coupon.site_id === params[0]
            && coupon.member_id === params[1]
            && coupon.coupon_template_id === params[2]
            && coupon.status === 'issued'
            && !coupon.revoked_at
          )).slice(0, 1)
        };
      }

      if (sql.includes('insert into member_coupons')) {
        const memberCoupon = {
          id: state.nextMemberCouponId++,
          site_id: params[0],
          member_id: params[1],
          coupon_template_id: params[2],
          status: 'issued',
          issued_reason: 'manual',
          issued_at: '2026-05-27T00:00:00.000Z',
          starts_at: params[3],
          expires_at: params[4],
          revoked_at: null
        };
        state.memberCoupons.push(memberCoupon);

        return { rows: [memberCoupon] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

function productImportPool() {
  const state = {
    categories: [{
      id: 5,
      site_id: 101,
      parent_id: null,
      name: '洋裝',
      sort_order: 0
    }],
    products: [],
    images: [],
    nextCategoryId: 20,
    nextProductId: 30
  };

  return {
    state,
    async query(sql, params) {
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
            site_status: 'active'
          }]
        };
      }

      if (sql.includes('from site_categories') && sql.includes('order by parent_id nulls first')) {
        return { rows: state.categories };
      }

      if (sql.includes("where site_id = $1 and parent_id is null and name = '轉入商品'")) {
        return { rows: state.categories.filter((category) => category.site_id === params[0] && category.parent_id === null && category.name === '轉入商品') };
      }

      if (sql.includes('coalesce(max(sort_order), -1) + 1')) {
        return { rows: [{ next_sort_order: 1 }] };
      }

      if (sql.includes('insert into site_categories')) {
        const category = {
          id: state.nextCategoryId++,
          site_id: params[0],
          parent_id: null,
          name: '轉入商品',
          sort_order: params[1]
        };
        state.categories.push(category);

        return { rows: [{ id: category.id, name: category.name }] };
      }

      if (sql.includes('select c.id, c.name') && sql.includes('not exists')) {
        return { rows: state.categories.map((category) => ({ id: category.id, name: category.name })) };
      }

      if (sql.includes('select sku') && sql.includes('from products')) {
        return { rows: state.products.map((product) => ({ sku: product.sku })) };
      }

      if (sql.includes('select slug') && sql.includes('from products')) {
        return { rows: state.products.map((product) => ({ slug: product.slug })) };
      }

      if (sql.includes('insert into products')) {
        const columnCount = 15;
        const inserted = [];
        for (let index = 0; index < params.length; index += columnCount) {
          const product = {
            id: state.nextProductId++,
            site_id: params[index],
            site_category_id: params[index + 1],
            sku: params[index + 2],
            name: params[index + 3],
            slug: params[index + 4],
            summary: params[index + 5],
            description: params[index + 6],
            base_price: params[index + 7],
            sale_price: params[index + 8],
            cost_price: params[index + 9],
            stock: params[index + 10],
            status: params[index + 11],
            youtube_url: params[index + 12]
          };
          state.products.push(product);
          inserted.push({ id: product.id, name: product.name });
        }

        return { rows: inserted };
      }

      if (sql.includes('insert into product_images')) {
        const columnCount = 7;
        for (let index = 0; index < params.length; index += columnCount) {
          state.images.push({
            product_id: params[index],
            image_type: params[index + 1],
            path: params[index + 2],
            sort_order: params[index + 3],
            alt_text: params[index + 4]
          });
        }

        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

function productCatalogPool() {
  const state = {
    categories: [
      { id: 5, site_id: 101, parent_id: null, name: '童裝', icon_svg: null, icon_path: null, image_path: null, sort_order: 0 },
      { id: 6, site_id: 101, parent_id: 5, name: '男童', icon_svg: null, icon_path: null, image_path: null, sort_order: 0 }
    ],
    navItems: [
      { id: 40, site_id: 101, parent_id: null, name: '服飾', item_type: 'dropdown', url: null, icon_svg: null, icon_path: null, sort_order: 0 }
    ],
    products: [],
    images: [],
    videos: [],
    variants: [],
    quantityDiscounts: [],
    nextCategoryId: 10,
    nextNavItemId: 41,
    nextProductId: 20,
    nextImageId: 30
  };

  function productMatchesListFilters(product, sql, params) {
    if (product.site_id !== params[0]) {
      return false;
    }

    if (sql.includes('p.stock <=')) {
      const stockParamIndex = Number.parseInt(sql.match(/p\.stock <= \$(\d+)/)?.[1] ?? '0', 10) - 1;
      const maxStock = params[stockParamIndex];
      const hasMatchingVariant = state.variants.some((variant) => variant.product_id === product.id && variant.stock <= maxStock);
      return product.stock <= maxStock || hasMatchingVariant;
    }

    return true;
  }

  return {
    state,
    async query(sql, params) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }

      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        return { rows: [{ id: params[1], slug: 'site-1', name: '測試網站', domain: '', site_status: 'active' }] };
      }

      if (sql.includes('select id, parent_id, name') && sql.includes('from site_categories') && sql.includes('order by parent_id nulls first')) {
        return { rows: state.categories };
      }

      if (sql.includes('from site_nav_items') && sql.includes('order by parent_id nulls first')) {
        return { rows: state.navItems };
      }

      if (sql.includes('select site_category_id, count(*)::int as total')) {
        return { rows: [] };
      }

      if (sql.includes('from site_categories') && sql.includes('where site_id = $1 and id = $2')) {
        return { rows: state.categories.filter((category) => category.site_id === params[0] && category.id === params[1]) };
      }

      if (sql.includes('from site_categories') && sql.includes('lower(name) = lower($2)') && sql.includes('order by id asc')) {
        return { rows: state.categories.filter((category) => category.site_id === params[0] && category.name.toLowerCase() === String(params[1]).toLowerCase()).sort((a, b) => a.id - b.id).slice(0, 1) };
      }

      if (sql.includes('where site_id = $1 and parent_id = $2')) {
        return { rows: state.categories.filter((category) => category.site_id === params[0] && category.parent_id === params[1]).slice(0, 1) };
      }

      if (sql.includes('from site_categories') && sql.includes('lower(name) = lower($2)') && sql.includes('limit 1')) {
        return { rows: state.categories.filter((category) => category.site_id === params[0] && category.name.toLowerCase() === String(params[1]).toLowerCase() && (params[2] === null || category.id !== params[2])).slice(0, 1) };
      }

      if (sql.includes('from site_categories') && sql.includes('name = $2') && sql.includes('limit 1')) {
        return { rows: [] };
      }

      if (sql.includes('coalesce(max(sort_order), -1) + 1')) {
        return { rows: [{ next_sort_order: 1 }] };
      }

      if (sql.includes('insert into site_categories')) {
        const category = { id: state.nextCategoryId++, site_id: params[0], parent_id: params[1], name: params[2], icon_svg: params[3], image_path: params[4], sort_order: params[5], icon_path: null };
        state.categories.push(category);
        return { rows: [category] };
      }

      if (sql.includes('update site_categories')) {
        const category = state.categories.find((item) => item.site_id === params[5] && item.id === params[6]);
        Object.assign(category, { parent_id: params[0], name: params[1], icon_svg: params[2], image_path: params[3], sort_order: params[4] });
        return { rows: [category] };
      }

      if (sql.includes('from site_nav_items') && sql.includes('where site_id = $1 and id = $2')) {
        return { rows: state.navItems.filter((item) => item.site_id === params[0] && item.id === params[1]) };
      }

      if (sql.includes('from site_nav_items') && sql.includes('name = $2') && sql.includes('limit 1')) {
        return { rows: [] };
      }

      if (sql.includes('from site_pages') && sql.includes('is_active = true')) {
        return { rows: [{ id: 1, site_id: params[0], name: 'Default', is_default: true, is_active: true, theme_mode: 'light' }] };
      }

      if (sql.includes('insert into site_nav_items')) {
        const navItem = {
          id: state.nextNavItemId++,
          site_id: params[0],
          parent_id: params[1],
          name: params[2],
          item_type: params[3],
          url: params[4],
          icon_svg: params[5],
          icon_path: null,
          sort_order: params[6]
        };
        state.navItems.push(navItem);
        return { rows: [navItem] };
      }

      if (sql.includes('update site_nav_items')) {
        const navItem = state.navItems.find((item) => item.site_id === params[6] && item.id === params[7]);
        Object.assign(navItem, {
          parent_id: params[0],
          name: params[1],
          item_type: params[2],
          url: params[3],
          icon_svg: params[4],
          sort_order: params[5]
        });
        return { rows: [navItem] };
      }

      if (sql.includes('delete from site_nav_items')) {
        state.navItems = state.navItems.filter((item) => item.site_id !== params[0] || item.id !== params[1]);
        return { rows: [] };
      }

      if (sql.includes('with recursive nav_tree')) {
        return { rows: state.navItems.filter((item) => item.site_id === params[0] && item.id === params[1]) };
      }

      if (sql.includes('select id') && sql.includes('from products') && sql.includes('sku = $2')) {
        return { rows: [] };
      }

      if (sql.includes('select id') && sql.includes('from products') && sql.includes('slug = $2')) {
        return { rows: [] };
      }

      if (sql.includes('select count(*)::int as total from products p')) {
        return { rows: [{ total: String(state.products.filter((product) => productMatchesListFilters(product, sql, params)).length) }] };
      }

      if (sql.includes('from products p') && sql.includes('left join site_categories')) {
        return { rows: state.products.filter((product) => productMatchesListFilters(product, sql, params)).map((product) => ({ ...product, category_name: '男童' })) };
      }

      if (sql.includes('select *') && sql.includes('from products')) {
        return { rows: state.products.filter((product) => product.site_id === params[0] && product.id === params[1]) };
      }

      if (sql.includes('insert into products')) {
        const product = {
          id: state.nextProductId++,
          site_id: params[0],
          site_category_id: params[1],
          variant_mode: params[2],
          replace_image_by_variant: params[3],
          sku: params[4],
          name: params[5],
          slug: params[6],
          summary: params[7],
          description: params[8],
          base_price: params[9],
          sale_price: params[10],
          sale_ends_at: params[11],
          cost_price: params[12],
          stock: params[13],
          buy_limit: params[14],
          gift_coupon_template_id: params[15],
          status: params[16],
          is_service: params[17],
          sales_volume: 0
        };
        state.products.push(product);
        return { rows: [product] };
      }

      if (sql.includes('update products')) {
        const product = state.products.find((item) => item.site_id === params[16] && item.id === params[17]);
        Object.assign(product, {
          site_category_id: params[0],
          variant_mode: params[1],
          replace_image_by_variant: params[2],
          sku: params[3],
          name: params[4],
          summary: params[5],
          description: params[6],
          base_price: params[7],
          sale_price: params[8],
          sale_ends_at: params[9],
          cost_price: params[10],
          stock: params[11],
          buy_limit: params[12],
          gift_coupon_template_id: params[13],
          status: params[14],
          is_service: params[15]
        });
        return { rows: [product] };
      }

      if (sql.includes('delete from product_images')) {
        state.images = state.images.filter((image) => !(image.product_id === params[0] && image.image_type === params[1]));
        return { rows: [] };
      }

      if (sql.includes('select count(*)::int as total') && sql.includes('from product_images')) {
        return { rows: [{
          total: String(state.images.filter((image) => image.product_id === params[0] && image.image_type === params[1]).length)
        }] };
      }

      if (sql.includes('coalesce(max(sort_order), -1) + 1') && sql.includes('from product_images')) {
        const sortOrders = state.images
          .filter((image) => image.product_id === params[0] && image.image_type === params[1])
          .map((image) => image.sort_order);
        return { rows: [{ next_sort_order: sortOrders.length === 0 ? 0 : Math.max(...sortOrders) + 1 }] };
      }

      if (sql.includes('select path') && sql.includes('from product_images')) {
        return { rows: state.images
          .filter((image) => image.product_id === params[0] && image.image_type === params[1])
          .map((image) => ({ path: image.path })) };
      }

      if (sql.includes('insert into product_images')) {
        state.images.push({ id: state.nextImageId++, product_id: params[0], image_type: params[1], path: params[2], sort_order: params[3], alt_text: params[4] });
        return { rows: [] };
      }

      if (sql.includes('insert into product_variants')) {
        state.variants.push({
          id: state.nextVariantId++,
          product_id: params[0],
          sku: null,
          name: params[1],
          price: params[2],
          sale_price: params[3],
          stock: params[4],
          sort_order: params[5],
          is_default: params[6]
        });
        return { rows: [] };
      }

      if (sql.includes('select id, product_id, image_type')) {
        return { rows: state.images.filter((image) => image.product_id === params[0]) };
      }

      if (sql.includes('select id, product_id, url')) {
        return { rows: state.videos.filter((video) => video.product_id === params[0]) };
      }

      if (sql.includes('select id, product_id, name, price')) {
        return { rows: state.variants.filter((variant) => variant.product_id === params[0]) };
      }

      if (sql.includes('select id, product_id, quantity')) {
        return { rows: state.quantityDiscounts.filter((discount) => discount.product_id === params[0]) };
      }

      if (sql.includes('delete from product_videos') || sql.includes('delete from product_variants') || sql.includes('delete from product_quantity_discounts')) {
        return { rows: [] };
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

test('storage adapter respects Laravel local filesystem disk over GCS env', () => {
  const previousDisk = process.env.FILESYSTEM_DISK;
  const previousBucket = process.env.GCS_BUCKET;
  const previousRoot = process.env.WEBLESS_STORAGE_ROOT;

  process.env.FILESYSTEM_DISK = 'local';
  process.env.GCS_BUCKET = 'webless_bucket';
  process.env.WEBLESS_STORAGE_ROOT = '/tmp/webless-storage';

  try {
    const adapter = createStorageAdapter();
    assert.equal(adapter instanceof LocalStorageAdapter, true);
  } finally {
    if (previousDisk === undefined) {
      delete process.env.FILESYSTEM_DISK;
    } else {
      process.env.FILESYSTEM_DISK = previousDisk;
    }

    if (previousBucket === undefined) {
      delete process.env.GCS_BUCKET;
    } else {
      process.env.GCS_BUCKET = previousBucket;
    }

    if (previousRoot === undefined) {
      delete process.env.WEBLESS_STORAGE_ROOT;
    } else {
      process.env.WEBLESS_STORAGE_ROOT = previousRoot;
    }
  }
});

test('GCS storage adapter uses service account credentials before metadata token', async () => {
  const credentialsRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-gcs-creds-'));
  const credentialsPath = path.join(credentialsRoot, 'service-account.json');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  await writeFile(credentialsPath, JSON.stringify({
    type: 'service_account',
    client_email: 'local-test@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' })
  }));
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });

    if (url === 'https://oauth2.googleapis.com/token') {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['content-type'], 'application/x-www-form-urlencoded');
      const body = new URLSearchParams(String(options.body));
      assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      assert.ok(body.get('assertion')?.split('.').length === 3);

      return new Response(JSON.stringify({
        access_token: 'service-account-token',
        expires_in: 3600
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (String(url).startsWith('https://storage.googleapis.com/storage/v1/b/webless_bucket/o/')) {
      assert.equal(options.headers.authorization, 'Bearer service-account-token');
      return new Response('template html', { status: 200 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };
  const adapter = new GcsStorageAdapter({
    bucket: 'webless_bucket',
    fetchImpl,
    credentialsPath
  });

  const content = await adapter.readText('sites/101/templates/default/root-elements/navbar.blade.php');

  assert.equal(content, 'template html');
  assert.equal(requests.some((request) => request.url === 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'), false);
});

test('repository creates and commits Webless signed image uploads', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });

    if (String(url).endsWith('/sites/site-1/mcp-uploads')) {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['x-slimweb-mcp-secret'], 'shared-secret');
      const body = JSON.parse(options.body);
      assert.equal(body.filename, 'spman.png');
      assert.equal(body.mime_type, 'image/png');
      assert.equal(body.size_bytes, 116936);

      return new Response(JSON.stringify({
        upload_id: 'upload-1',
        upload_token: 'token-1',
        upload_url: 'https://slimweb.tw/sites/site-1/mcp-uploads/upload-1?token=token-1',
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        expires_at: '2026-05-27T12:00:00+00:00'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (String(url).endsWith('/sites/site-1/mcp-uploads/upload-1/commit')) {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['x-slimweb-mcp-secret'], 'shared-secret');
      assert.deepEqual(JSON.parse(options.body), { upload_token: 'token-1' });

      return new Response(JSON.stringify({
        asset: {
          upload_id: 'upload-1',
          media_path: 'sites/101/mcp-uploads/committed/upload-1.webp',
          public_url: 'https://slimweb.tw/media/sites/101/mcp-uploads/committed/upload-1.webp',
          mime_type: 'image/webp',
          filename: 'spman.png',
          target_usage: 'product_image'
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };
  const repository = new WeblessAccountRepository(fakePool(), {
    fetchImpl,
    weblessAppBaseUrl: 'https://slimweb.tw',
    weblessMcpSecret: 'shared-secret'
  });

  const upload = await repository.createUpload(11, {
    site_id: 101,
    filename: 'spman.png',
    mime_type: 'image/png',
    size_bytes: 116936,
    target_usage: 'product_image'
  });
  const committed = await repository.commitUpload(11, {
    site_id: 101,
    upload_id: upload.upload_id,
    upload_token: upload.upload_token
  });

  assert.equal(upload.upload_url, 'https://slimweb.tw/sites/site-1/mcp-uploads/upload-1?token=token-1');
  assert.match(upload.upload_instructions.runtime_check, /AI client runtime/);
  assert.match(upload.upload_instructions.fallback_message, /Codex\/Hermes/);
  assert.equal(committed.asset.media_path, 'sites/101/mcp-uploads/committed/upload-1.webp');
  assert.equal(requests.length, 2);
});

test('repository imports ChatGPT attachment file params through Webless upload flow', async () => {
  const requests = [];
  const imageBytes = Buffer.from('fake-png-bytes');
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });

    if (String(url) === 'https://files.oaiusercontent.com/file-abc') {
      assert.equal(options.method, undefined);
      return new Response(imageBytes, { status: 200, headers: { 'content-type': 'image/png' } });
    }

    if (String(url).endsWith('/sites/site-1/mcp-uploads')) {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['x-slimweb-mcp-secret'], 'shared-secret');
      const body = JSON.parse(options.body);
      assert.equal(body.filename, 'chatgpt-product.png');
      assert.equal(body.mime_type, 'image/png');
      assert.equal(body.size_bytes, imageBytes.length);
      assert.equal(body.target_usage, 'product_image');

      return new Response(JSON.stringify({
        upload_id: 'upload-chatgpt',
        upload_token: 'token-chatgpt',
        upload_url: 'https://slimweb.tw/sites/site-1/mcp-uploads/upload-chatgpt?token=token-chatgpt',
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        expires_at: '2026-05-31T12:00:00+00:00'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (String(url) === 'https://slimweb.tw/sites/site-1/mcp-uploads/upload-chatgpt?token=token-chatgpt') {
      assert.equal(options.method, 'PUT');
      assert.equal(options.headers['Content-Type'], 'image/png');
      assert.deepEqual(Buffer.from(options.body), imageBytes);

      return new Response('', { status: 200 });
    }

    if (String(url).endsWith('/sites/site-1/mcp-uploads/upload-chatgpt/commit')) {
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { upload_token: 'token-chatgpt' });

      return new Response(JSON.stringify({
        asset: {
          upload_id: 'upload-chatgpt',
          media_path: 'sites/101/mcp-uploads/committed/upload-chatgpt.webp',
          public_url: 'https://slimweb.tw/media/sites/101/mcp-uploads/committed/upload-chatgpt.webp',
          mime_type: 'image/webp',
          filename: 'chatgpt-product.png',
          target_usage: 'product_image'
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };
  const repository = new WeblessAccountRepository(fakePool(), {
    fetchImpl,
    weblessAppBaseUrl: 'https://slimweb.tw',
    weblessMcpSecret: 'shared-secret'
  });

  const imported = await repository.importChatGptAttachment(11, {
    site_id: 101,
    target_usage: 'product_image',
    filename: 'chatgpt-product.png',
    image: {
      download_url: 'https://files.oaiusercontent.com/file-abc',
      name: 'ignored.png',
      mime_type: 'image/png'
    }
  });

  assert.equal(imported.asset.media_path, 'sites/101/mcp-uploads/committed/upload-chatgpt.webp');
  assert.equal(imported.upload.source, 'openai_file_params');
  assert.equal(requests.length, 4);
});

test('repository imports ChatGPT attachment from GPT Actions-style file refs', async () => {
  const requests = [];
  const imageBytes = Buffer.from('fake-webp-bytes');
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });

    if (String(url) === 'https://files.oaiusercontent.com/file-action') {
      assert.equal(options.method, undefined);
      return new Response(imageBytes, { status: 200, headers: { 'content-type': 'image/webp' } });
    }

    if (String(url).endsWith('/sites/site-1/mcp-uploads')) {
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body);
      assert.equal(body.filename, 'action-image.webp');
      assert.equal(body.mime_type, 'image/webp');
      assert.equal(body.size_bytes, imageBytes.length);

      return new Response(JSON.stringify({
        upload_id: 'upload-action',
        upload_token: 'token-action',
        upload_url: 'https://slimweb.tw/sites/site-1/mcp-uploads/upload-action?token=token-action',
        method: 'PUT',
        headers: { 'Content-Type': 'image/webp' },
        expires_at: '2026-05-27T12:00:00+00:00'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (String(url) === 'https://slimweb.tw/sites/site-1/mcp-uploads/upload-action?token=token-action') {
      assert.equal(options.method, 'PUT');
      assert.equal(options.headers['Content-Type'], 'image/webp');
      assert.deepEqual(Buffer.from(options.body), imageBytes);

      return new Response('', { status: 200 });
    }

    if (String(url).endsWith('/sites/site-1/mcp-uploads/upload-action/commit')) {
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { upload_token: 'token-action' });

      return new Response(JSON.stringify({
        asset: {
          upload_id: 'upload-action',
          media_path: 'sites/101/mcp-uploads/committed/upload-action.webp',
          public_url: 'https://slimweb.tw/media/sites/101/mcp-uploads/committed/upload-action.webp',
          mime_type: 'image/webp',
          filename: 'action-image.webp',
          target_usage: 'reference'
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };
  const repository = new WeblessAccountRepository(fakePool(), {
    fetchImpl,
    weblessAppBaseUrl: 'https://slimweb.tw',
    weblessMcpSecret: 'shared-secret'
  });

  const imported = await repository.importChatGptAttachment(11, {
    site_id: 101,
    target_usage: 'reference',
    image: {
      openaiFileIdRefs: [{
        id: 'file-action',
        name: 'action-image.webp',
        mime_type: 'image/webp',
        download_link: 'https://files.oaiusercontent.com/file-action'
      }]
    }
  });

  assert.equal(imported.asset.media_path, 'sites/101/mcp-uploads/committed/upload-action.webp');
  assert.equal(imported.upload.file_id, 'file-action');
  assert.equal(requests.length, 4);
});

test('repository updates and reads site SEO and AEO settings for admin display', async () => {
  const pool = seoSettingsPool();
  const repository = new WeblessAccountRepository(pool, {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'))
  });

  const updated = await repository.updateSeoSettings(11, {
    site_id: 101,
    seo_title: '質感女裝、上班穿搭推薦',
    seo_description: '精選上班、約會與日常穿搭服飾。',
    seo_keywords: '女裝, 上班穿搭, 韓系服飾',
    google_analytics_measurement_id: 'G-ABC1234567',
    robots_policy: 'index,follow',
    llms_txt: '本網站販售女裝、洋裝、襯衫與外套。',
    aeo_business_summary: '服飾電商，提供上班與日常穿搭。',
    aeo_target_audience: '25-40 歲女性上班族',
    aeo_products_services: '女裝、洋裝、襯衫、外套、配件',
    aeo_customer_questions: '如何挑選尺寸？\n夏天適合哪些材質？',
    aeo_answer_style: '直接、具體、可引用',
    aeo_entity_facts: '品牌服務台灣，提供快速出貨。',
    geo_citation_targets: '品牌官網、商品頁、FAQ、退換貨政策',
    geo_verifiable_claims: '提供台灣本島快速出貨；支援七天鑑賞期。',
    geo_trust_signals: '清楚揭露客服、退換貨政策與付款方式。',
    geo_same_as_profiles: 'https://www.instagram.com/demo_shop',
    geo_comparison_positioning: '適合尋找上班與日常都能穿搭的女性客群。'
  });
  const read = await repository.getSeoSettings(11, { site_id: 101 });

  assert.equal(updated.ok, true);
  assert.equal(updated.settings.seo_title, '質感女裝、上班穿搭推薦');
  assert.equal(updated.settings.google_analytics_measurement_id, 'G-ABC1234567');
  assert.equal(read.settings.aeo_target_audience, '25-40 歲女性上班族');
  assert.equal(read.settings.aeo_customer_questions, '如何挑選尺寸？\n夏天適合哪些材質？');
  assert.equal(read.settings.geo_verifiable_claims, '提供台灣本島快速出貨；支援七天鑑賞期。');
  assert.equal(read.settings.geo_comparison_positioning, '適合尋找上班與日常都能穿搭的女性客群。');
});

test('repository normalizes canonical URLs to the authoritative merchant host', async () => {
  const platformPool = seoSettingsPool();
  const platformRepository = new WeblessAccountRepository(platformPool, {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const platform = await platformRepository.updateSeoSettings(11, {
    site_id: 101,
    canonical_url: 'https://slimweb.tw/sites/swcb_test101/sale?utm_source=test#top'
  });
  assert.equal(platform.settings.canonical_url, 'https://slimweb.tw/sites/swcb_test101');

  const customPool = seoSettingsPool();
  customPool.state.site.domain = 'shop.example.com';
  const customRepository = new WeblessAccountRepository(customPool, {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const custom = await customRepository.updateSeoSettings(11, {
    site_id: 101,
    canonical_url: 'https://shop.example.com/sale?utm_source=test#top'
  });
  assert.equal(custom.settings.canonical_url, 'https://shop.example.com');
});

test('repository rejects unrelated and non-http canonical URLs', async () => {
  const pool = seoSettingsPool();
  pool.state.site.domain = 'shop.example.com';
  const repository = new WeblessAccountRepository(pool, {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  for (const canonical_url of ['https://other.example.com/page', 'javascript:alert(1)']) {
    await assert.rejects(
      () => repository.updateSeoSettings(11, { site_id: 101, canonical_url }),
      (error) => error?.code === 'VALIDATION_FAILED' && /canonical_url/.test(error.message)
    );
  }
});

test('repository reports missing site readiness areas for AI answers', async () => {
  const repository = new WeblessAccountRepository(readinessPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'))
  });

  const report = await repository.getSiteReadiness(11, { site_id: 101, include_optional: true });

  assert.equal(report.summary.status, 'needs_setup');
  assert.ok(report.summary.required_issue_count > 0);
  assert.ok(report.missing_categories.some((category) => category.key === 'payment_logistics'));
  assert.ok(report.missing_categories.some((category) => category.key === 'catalog'));
  assert.ok(report.missing_categories.some((category) => category.key === 'email'));
  assert.ok(report.missing_categories.some((category) => category.key === 'public_information'));
  assert.ok(report.missing_categories.some((category) => category.key === 'promotions'));
  assert.equal(report.categories.some((category) => category.key === 'third_party_login'), false);
  assert.ok(report.next_actions.some((action) => action.suggested_tools.includes('slimweb_payment_logistics_update')));
});

test('repository summarizes launch progress for guided ecommerce onboarding', async () => {
  const repository = new WeblessAccountRepository(readinessPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'))
  });

  const progress = await repository.getSiteLaunchProgress(11, { site_id: 101 });

  assert.equal(progress.launch_status.stage, 'setup_incomplete');
  assert.equal(progress.launch_status.can_launch, false);
  assert.ok(progress.launch_status.required_blocking_count > 0);
  assert.ok(progress.required.some((item) => item.key === 'catalog' && item.blocking_launch));
  assert.ok(progress.required.some((item) => item.key === 'payment_logistics' && item.blocking_launch));
  assert.ok(progress.required.some((item) => item.key === 'homepage' && item.blocking_launch));
  assert.ok(progress.recommended.some((item) => item.key === 'seo_aeo_geo' && !item.blocking_launch));
  assert.match(progress.next_step.message_to_user, /商品|類別|金物流|首頁/);
  assert.match(progress.ai_guidance.seo_rule, /Do not ask.*GEO/i);
});

test('repository includes consumer MCP URL in basic settings', async () => {
  const repository = new WeblessAccountRepository(readinessPool(), {
    clientMcpBaseUrl: 'https://client-mcp.example.test'
  });

  const result = await repository.getBasicSettings(11, { site_id: 101 });

  assert.equal(result.settings.client_mcp_url, 'https://client-mcp.example.test/sites/swcb_test101/mcp');
  assert.equal(result.settings.name, '測試網站');
  assert.equal(result.settings.category_navigation_mode, 'navbar_categories');
  assert.equal(Object.hasOwn(result.settings, 'product_category_depth'), false);
  assert.deepEqual(result.settings.logo, {
    media_path: 'sites/101/settings/logo-current.webp',
    public_url: 'https://slimweb.tw/media/sites/101/settings/logo-current.webp',
    mime_type: 'image/webp'
  });
});

test('repository updates only the site name through basic settings', async () => {
  const state = {
    id: 101,
    slug: 'site-1',
    name: '原網站名稱',
    domain: 'shop.example.com',
    callback_code: 'swcb_test101',
    site_status: 'active',
    member_verification: 'none',
    website_type: 'ecommerce',
    default_country_code: 'TW',
    product_load_mode: 'pagination',
    return_days_allowed: 7,
    category_navigation_mode: 'category_menu',
    icon_path: null
  };
  const settingsColumns = [
    'name',
    'site_status',
    'member_verification',
    'website_type',
    'default_country_code',
    'product_load_mode',
    'return_days_allowed',
    'category_navigation_mode',
    'icon_path'
  ];
  const pool = {
    async query(sql, params) {
      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        return { rows: [state] };
      }
      if (sql.includes('from information_schema.columns')) {
        return { rows: settingsColumns.map((column_name) => ({ column_name })) };
      }
      if (sql.includes('select ') && sql.includes('from sites') && sql.includes('where id = $1')) {
        return { rows: [state] };
      }
      if (sql.includes('update sites')) {
        assert.match(sql, /name = \$1/);
        assert.doesNotMatch(sql, /slug\s*=/);
        assert.doesNotMatch(sql, /domain\s*=/);
        assert.doesNotMatch(sql, /callback_code\s*=/);
        assert.deepEqual(params, ['新的網站名稱', 101]);
        state.name = params[0];
        return { rows: [state] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const repository = new WeblessAccountRepository(pool);

  const result = await repository.updateBasicSettings(11, {
    site_id: 101,
    name: '  新的網站名稱  '
  });

  assert.equal(result.site.name, '新的網站名稱');
  assert.equal(result.settings.name, '新的網站名稱');
  assert.equal(result.site.slug, 'site-1');
  assert.equal(result.site.domain, 'shop.example.com');
  assert.equal(result.site.callback_code, 'swcb_test101');
});

test('repository rejects a blank site name', async () => {
  const repository = new WeblessAccountRepository(readinessPool());

  await assert.rejects(
    () => repository.updateBasicSettings(11, { site_id: 101, name: '   ' }),
    (error) => error?.code === 'VALIDATION_FAILED'
      && error.message === 'name is required.'
  );
});

test('repository rejects a site name longer than 255 characters', async () => {
  const repository = new WeblessAccountRepository(readinessPool());

  await assert.rejects(
    () => repository.updateBasicSettings(11, { site_id: 101, name: 'a'.repeat(256) }),
    (error) => error?.code === 'VALIDATION_FAILED'
      && error.message === 'name must not exceed 255 characters.'
  );
});

test('repository partially updates category navigation mode without overwriting unrelated settings', async () => {
  const state = {
    id: 101,
    slug: 'site-1',
    name: '測試網站',
    domain: '',
    callback_code: 'swcb_test101',
    site_status: 'maintenance',
    member_verification: 'none',
    website_type: 'legacy_brand',
    default_country_code: 'JP',
    product_load_mode: 'legacy_scroll',
    return_days_allowed: 14,
    category_navigation_mode: 'category_menu',
    icon_path: null
  };
  const settingsColumns = [
    'site_status',
    'member_verification',
    'website_type',
    'default_country_code',
    'product_load_mode',
    'return_days_allowed',
    'category_navigation_mode',
    'icon_path'
  ];
  const pool = {
    async query(sql, params) {
      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        return { rows: [state] };
      }
      if (sql.includes('from information_schema.columns')) {
        return { rows: settingsColumns.map((column_name) => ({ column_name })) };
      }
      if (sql.includes('select ') && sql.includes('from sites') && sql.includes('where id = $1')) {
        return { rows: [state] };
      }
      if (sql.includes('update sites')) {
        assert.match(sql, /category_navigation_mode = \$1/);
        assert.doesNotMatch(sql, /site_status\s*=/);
        assert.doesNotMatch(sql, /member_verification\s*=/);
        assert.doesNotMatch(sql, /website_type\s*=/);
        assert.doesNotMatch(sql, /default_country_code\s*=/);
        assert.doesNotMatch(sql, /product_load_mode\s*=/);
        assert.doesNotMatch(sql, /return_days_allowed\s*=/);
        assert.deepEqual(params, ['navbar_categories', 101]);
        state.category_navigation_mode = params[0];
        return { rows: [state] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const repository = new WeblessAccountRepository(pool);

  const result = await repository.updateBasicSettings(11, {
    site_id: 101,
    category_navigation_mode: 'navbar_categories'
  });

  assert.equal(result.settings.category_navigation_mode, 'navbar_categories');
  assert.equal(result.settings.site_status, 'maintenance');
  assert.equal(result.settings.website_type, 'legacy_brand');
  assert.equal(result.settings.product_load_mode, 'legacy_scroll');
  assert.equal(result.settings.default_country_code, 'JP');
  assert.equal(result.settings.return_days_allowed, 14);
});

test('repository does not revalidate SMTP for an unrelated basic-settings patch when email verification is already enabled', async () => {
  const state = {
    id: 101,
    slug: 'site-1',
    name: '測試網站',
    domain: '',
    callback_code: 'swcb_test101',
    site_status: 'active',
    member_verification: 'email',
    website_type: 'ecommerce',
    default_country_code: 'TW',
    product_load_mode: 'pagination',
    return_days_allowed: 0,
    category_navigation_mode: 'category_menu',
    icon_path: null
  };
  const settingsColumns = [
    'site_status',
    'member_verification',
    'website_type',
    'default_country_code',
    'product_load_mode',
    'return_days_allowed',
    'category_navigation_mode',
    'icon_path'
  ];
  const pool = {
    async query(sql, params) {
      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        return { rows: [state] };
      }
      if (sql.includes('from information_schema.columns')) {
        return { rows: settingsColumns.map((column_name) => ({ column_name })) };
      }
      if (sql.includes('notification_smtp_host')) {
        throw new Error('SMTP settings must not be queried for an unrelated patch');
      }
      if (sql.includes('select ') && sql.includes('from sites') && sql.includes('where id = $1')) {
        return { rows: [state] };
      }
      if (sql.includes('update sites')) {
        assert.match(sql, /category_navigation_mode = \$1/);
        assert.doesNotMatch(sql, /member_verification\s*=/);
        assert.deepEqual(params, ['navbar_categories', 101]);
        state.category_navigation_mode = params[0];
        return { rows: [state] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const repository = new WeblessAccountRepository(pool);

  const result = await repository.updateBasicSettings(11, {
    site_id: 101,
    category_navigation_mode: 'navbar_categories'
  });

  assert.equal(result.settings.category_navigation_mode, 'navbar_categories');
  assert.equal(result.settings.member_verification, 'email');
});

test('repository rejects an invalid explicit category navigation mode', async () => {
  const repository = new WeblessAccountRepository(readinessPool());

  await assert.rejects(
    () => repository.updateBasicSettings(11, {
      site_id: 101,
      category_navigation_mode: 'automatic'
    }),
    (error) => error?.code === 'VALIDATION_FAILED'
      && error.message === 'category_navigation_mode must be category_menu or navbar_categories.'
  );
});

test('repository replaces the site logo through the Webless basic-settings bridge', async () => {
  const state = {
    id: 101,
    slug: 'site-1',
    name: '測試網站',
    domain: '',
    callback_code: 'swcb_test101',
    site_status: 'active',
    member_verification: 'none',
    website_type: 'ecommerce',
    default_country_code: 'TW',
    product_load_mode: 'pagination',
    return_days_allowed: 0,
    icon_path: 'sites/101/settings/logo-current.webp'
  };
  const pool = {
    async query(sql, params) {
      if (sql.includes('account_id = $1 and id = $2')) {
        return { rows: [state] };
      }
      if (sql.includes('from information_schema.columns')) {
        return {
          rows: [
            'site_status',
            'member_verification',
            'website_type',
            'default_country_code',
            'product_load_mode',
            'return_days_allowed',
            'icon_path'
          ].map((column_name) => ({ column_name }))
        };
      }
      if (sql.includes('select ') && sql.includes('from sites') && sql.includes('where id = $1')) {
        return { rows: [state] };
      }
      if (sql.includes('update sites') && sql.includes('site_status = $1')) {
        assert.doesNotMatch(sql, /product_category_depth/);
        state.site_status = params[0];
        return { rows: [state] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({
      ok: true,
      logo: {
        media_path: 'sites/101/settings/logo-new.webp',
        public_url: 'https://slimweb.tw/media/sites/101/settings/logo-new.webp',
        mime_type: 'image/webp',
        width: 192,
        height: 96
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const repository = new WeblessAccountRepository(pool, {
    fetchImpl,
    weblessAppBaseUrl: 'https://slimweb.tw',
    weblessMcpSecret: 'shared-secret'
  });

  const result = await repository.updateBasicSettings(11, {
    site_id: 101,
    site_status: 'maintenance',
    logo: { media_path: 'sites/101/mcp-uploads/committed/sweety-logo.png' }
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://slimweb.tw/sites/site-1/mcp-basic-settings/logo');
  assert.equal(requests[0].options.headers['x-slimweb-mcp-secret'], 'shared-secret');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    logo: { media_path: 'sites/101/mcp-uploads/committed/sweety-logo.png' }
  });
  assert.equal(result.settings.site_status, 'maintenance');
  assert.equal(result.settings.logo.media_path, 'sites/101/settings/logo-new.webp');
  assert.equal(result.settings.logo.height, 96);

  await assert.rejects(
    () => repository.updateBasicSettings(11, {
      site_id: 101,
      logo: {
        media_path: 'sites/101/mcp-uploads/committed/sweety-logo.png',
        svg_base64: Buffer.from('<svg viewBox="0 0 2 1"/>').toString('base64')
      }
    }),
    /exactly one/
  );
  assert.equal(requests.length, 1);
});

test('repository reads basic settings when older sites table lacks newer columns', async () => {
  const site = {
    id: 101,
    slug: 'site-1',
    name: '測試網站',
    domain: '',
    callback_code: 'swcb_test101',
    site_status: 'active',
    website_type: 'brand'
  };
  const pool = {
    async query(sql, params) {
      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        assert.equal(params[0], 11);
        assert.equal(params[1], 101);
        return { rows: [site] };
      }

      if (sql.includes('from information_schema.columns')) {
        return {
          rows: [
            { column_name: 'site_status' },
            { column_name: 'website_type' }
          ]
        };
      }

      if (sql.includes('from sites') && sql.includes('where id = $1')) {
        assert.doesNotMatch(sql, /member_verification/);
        assert.match(sql, /site_status/);
        assert.match(sql, /website_type/);
        return { rows: [site] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const repository = new WeblessAccountRepository(pool, {
    clientMcpBaseUrl: 'https://client-mcp.example.test'
  });

  const result = await repository.getBasicSettings(11, { site_id: 101 });

  assert.equal(result.settings.website_type, 'brand');
  assert.equal(result.settings.member_verification, 'none');
  assert.equal(result.settings.category_navigation_mode, 'category_menu');
  assert.equal(result.settings.client_mcp_url, 'https://client-mcp.example.test/sites/swcb_test101/mcp');
});

test('repository updates basic settings when older sites table lacks newer columns', async () => {
  const site = {
    id: 101,
    slug: 'site-1',
    name: '測試網站',
    domain: '',
    callback_code: 'swcb_test101',
    site_status: 'active',
    website_type: 'brand'
  };
  const pool = {
    async query(sql, params) {
      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        return { rows: [site] };
      }

      if (sql.includes('from information_schema.columns')) {
        return {
          rows: [
            { column_name: 'site_status' },
            { column_name: 'website_type' }
          ]
        };
      }

      if (sql.includes('select ') && sql.includes('from sites') && sql.includes('where id = $1')) {
        assert.doesNotMatch(sql, /member_verification/);
        assert.doesNotMatch(sql, /category_navigation_mode/);
        return { rows: [site] };
      }

      if (sql.includes('update sites')) {
        assert.doesNotMatch(sql, /member_verification/);
        assert.match(sql, /site_status = \$1/);
        assert.doesNotMatch(sql, /website_type\s*=/);
        assert.deepEqual(params, ['maintenance', 101]);
        site.site_status = params[0];
        return { rows: [site] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const repository = new WeblessAccountRepository(pool);

  const result = await repository.updateBasicSettings(11, {
    site_id: 101,
    site_status: 'maintenance'
  });

  assert.equal(result.settings.site_status, 'maintenance');
  assert.equal(result.settings.member_verification, 'none');
  assert.equal(result.settings.category_navigation_mode, 'category_menu');
});

test('repository rejects an explicitly requested basic setting missing from the sites table', async () => {
  const site = {
    id: 101,
    slug: 'site-1',
    name: '測試網站',
    domain: '',
    callback_code: 'swcb_test101',
    site_status: 'active',
    website_type: 'brand'
  };
  const pool = {
    async query(sql) {
      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        return { rows: [site] };
      }
      if (sql.includes('from information_schema.columns')) {
        return {
          rows: [
            { column_name: 'site_status' },
            { column_name: 'website_type' }
          ]
        };
      }
      if (sql.includes('select ') && sql.includes('from sites') && sql.includes('where id = $1')) {
        return { rows: [site] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const repository = new WeblessAccountRepository(pool);

  await assert.rejects(
    () => repository.updateBasicSettings(11, {
      site_id: 101,
      return_days_allowed: 7
    }),
    /return_days_allowed is not available/
  );

  await assert.rejects(
    () => repository.updateBasicSettings(11, {
      site_id: 101,
      category_navigation_mode: 'navbar_categories'
    }),
    (error) => error?.code === 'VALIDATION_FAILED'
      && error.message === 'category_navigation_mode is not available in the current sites table schema.'
  );
});

test('repository updates and reads site integration settings for admin display', async () => {
  const pool = integrationSettingsPool();
  const repository = new WeblessAccountRepository(pool, {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'))
  });

  const updated = await repository.updateIntegrationSettings(11, {
    site_id: 101,
    facebook_app_id: 'fb-app',
    facebook_comment_on_products: true,
    notion_token: 'notion-secret'
  });
  const read = await repository.getIntegrationSettings(11, { site_id: 101 });

  assert.equal(updated.ok, true);
  assert.equal(read.settings.facebook_app_id, 'fb-app');
  assert.equal(read.settings.facebook_comment_on_products, true);
  assert.equal(read.settings.notion_token, 'notion-secret');
});

test('repository updates and reads only facebook settings', async () => {
  const pool = integrationSettingsPool();
  const repository = new WeblessAccountRepository(pool, {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'))
  });

  const updated = await repository.updateFacebookSettings(11, {
    site_id: 101,
    facebook_app_id: 'fb-app',
    facebook_page_id: 'fb-page',
    facebook_comment_on_products: true,
    facebook_comment_on_posts: true
  });
  const read = await repository.getFacebookSettings(11, { site_id: 101 });

  assert.equal(updated.ok, true);
  assert.equal(read.settings.facebook_app_id, 'fb-app');
  assert.equal(read.settings.facebook_page_id, 'fb-page');
  assert.equal(read.settings.facebook_comment_on_products, true);
  assert.equal(read.settings.facebook_comment_on_posts, true);
});

test('repository updates and reads only notion settings', async () => {
  const pool = integrationSettingsPool();
  const repository = new WeblessAccountRepository(pool, {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'))
  });

  const updated = await repository.updateNotionSettings(11, {
    site_id: 101,
    notion_token: 'notion-secret'
  });
  const read = await repository.getNotionSettings(11, { site_id: 101 });

  assert.equal(updated.ok, true);
  assert.equal(read.settings.notion_token, 'notion-secret');
});

test('repository searches and reads Notion pages through independent Webless endpoints', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push([url, JSON.parse(options.body)]);
    if (String(url).endsWith('/mcp-notion/search')) {
      return new Response(JSON.stringify({
        query: 'KAI',
        exact_matches: [{ notion_page_id: 'page-kai', title: 'KAI', imported: true, article_id: 9 }],
        partial_matches: [{ notion_page_id: 'page-guide', title: 'KAI說明', imported: false, article_id: null }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      page: { notion_page_id: 'page-kai', title: 'KAI', content_html: '<p>內容</p>', imported: true, article_id: 9 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const repository = new WeblessAccountRepository(fakePool(), {
    fetchImpl,
    weblessAppBaseUrl: 'https://slimweb.tw',
    weblessMcpSecret: 'shared-secret'
  });

  const matches = await repository.searchNotionPages(11, { site_id: 101, title: 'KAI' });
  const content = await repository.getNotionPageContent(11, { site_id: 101, notion_page_id: 'page-kai' });

  assert.equal(matches.exact_matches[0].article_id, 9);
  assert.equal(matches.partial_matches[0].title, 'KAI說明');
  assert.equal(content.page.content_html, '<p>內容</p>');
  assert.deepEqual(requests.map(([, body]) => body), [{ title: 'KAI' }, { notion_page_id: 'page-kai' }]);
});

test('repository sends explicit complete order numbers for mutations', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push([url, body]);
    return new Response(JSON.stringify({ orders: [], deleted_order_numbers: body.order_numbers ?? [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const repository = new WeblessAccountRepository(fakePool(), { fetchImpl, weblessAppBaseUrl: 'https://slimweb.tw', weblessMcpSecret: 'shared-secret' });

  await repository.updateOrdersStatus(11, { site_id: 101, order_numbers: ['A2343242'], status: 'confirmed' });
  await repository.updateOrdersRecipient(11, { site_id: 101, orders: [{ order_no: 'A2343242', recipient_name: '陳大明' }] });
  await repository.deleteOrders(11, { site_id: 101, order_numbers: ['A2343242'] });

  assert.deepEqual(requests.map(([, body]) => body), [
    { order_numbers: ['A2343242'], status: 'confirmed' },
    { orders: [{ order_no: 'A2343242', recipient_name: '陳大明' }] },
    { order_numbers: ['A2343242'] }
  ]);
});

test('repository returns waybill URLs for explicit or query-selected order sets', async () => {
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    return new Response(JSON.stringify({
      type: body.type,
      waybill_url: 'https://slimweb.tw/sites/site-1/orders/logistics/waybills?order_ids=1,2',
      print_available: true,
      included_order_numbers: body.order_numbers,
      excluded_order_numbers: []
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const repository = new WeblessAccountRepository(fakePool(), { fetchImpl, weblessAppBaseUrl: 'https://slimweb.tw', weblessMcpSecret: 'shared-secret' });

  const result = await repository.getWaybillUrl(11, {
    site_id: 101,
    order_numbers: ['SW1', 'SW2'],
    type: 'forward'
  });

  assert.equal(result.print_available, true);
  assert.deepEqual(result.included_order_numbers, ['SW1', 'SW2']);
});

test('repository reads media stats and deletes unused media through Webless', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push([url, options.method ?? 'GET']);
    const payload = String(url).endsWith('/stats')
      ? { total: { count: 3, size_bytes: 30 }, unused: { count: 2, size_bytes: 20, assets: [] } }
      : { deleted: { count: 2, size_bytes: 20 }, skipped: { count: 0, size_bytes: 0 }, failed: { count: 0, size_bytes: 0 } };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const repository = new WeblessAccountRepository(fakePool(), { fetchImpl, weblessAppBaseUrl: 'https://slimweb.tw', weblessMcpSecret: 'shared-secret' });

  const stats = await repository.getMediaLibraryStats(11, { site_id: 101 });
  const cleaned = await repository.deleteUnusedMedia(11, { site_id: 101 });

  assert.equal(stats.unused.count, 2);
  assert.equal(cleaned.deleted.size_bytes, 20);
  assert.deepEqual(requests.map(([, method]) => method), ['GET', 'DELETE']);
});

test('repository updates and reads all contact settings with patch and null semantics', async () => {
  const state = {
    id: 101,
    slug: 'site-1',
    name: '測試網站',
    domain: '',
    callback_code: 'swcb_test101',
    contact_email: 'old@example.com',
    contact_line: 'https://line.me/old',
    contact_wechat: 'old-wechat',
    contact_telegram: null,
    contact_twitter: null,
    contact_instagram: null,
    contact_facebook_page: null,
    contact_store_address: '舊地址',
    contact_phone: '0200000000'
  };
  const pool = {
    async query(sql, params) {
      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        return { rows: [state] };
      }

      if (sql.includes('select contact_email')) {
        return { rows: [state] };
      }

      if (sql.includes('update sites') && sql.includes('contact_email = $1')) {
        Object.assign(state, {
          contact_email: params[0],
          contact_line: params[1],
          contact_wechat: params[2],
          contact_telegram: params[3],
          contact_twitter: params[4],
          contact_instagram: params[5],
          contact_facebook_page: params[6],
          contact_store_address: params[7],
          contact_phone: params[8]
        });
        return { rows: [state] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const repository = new WeblessAccountRepository(pool);

  const updated = await repository.updateContactSettings(11, {
    site_id: 101,
    contact_email: 'hello@example.com',
    contact_line: null,
    contact_instagram: 'https://instagram.com/example'
  });
  const read = await repository.getContactSettings(11, { site_id: 101 });

  assert.equal(updated.settings.contact_email, 'hello@example.com');
  assert.equal(updated.settings.contact_line, null);
  assert.equal(updated.settings.contact_wechat, 'old-wechat');
  assert.equal(updated.settings.contact_instagram, 'https://instagram.com/example');
  assert.equal(read.settings.contact_store_address, '舊地址');
  assert.equal(read.settings.contact_phone, '0200000000');
});

test('repository exposes site-scoped delete methods for Web admin parity', async () => {
  const deleted = [];
  const pool = {
    async query(sql, params) {
      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        return { rows: [{ id: 101, slug: 'site-1', name: '測試網站', callback_code: 'swcb_test101' }] };
      }
      if (/select id(?:, [a-z_]+)* from (discount_codes|member_tiers|threshold_gifts|product_add_ons|site_newsletters|customer_service_logs)/.test(sql)) {
        return { rows: [{ id: params[1], site_id: params[0] }] };
      }
      const match = sql.match(/delete from (discount_codes|member_tiers|threshold_gifts|product_add_ons|site_newsletters|customer_service_logs)/);
      if (match) {
        deleted.push([match[1], params]);
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const repository = new WeblessAccountRepository(pool);

  await repository.deleteDiscountCode(11, { site_id: 101, discount_code_id: 1 });
  await repository.deleteMemberTier(11, { site_id: 101, member_tier_id: 2 });
  await repository.deleteThresholdGift(11, { site_id: 101, threshold_gift_id: 3 });
  await repository.deleteProductAddOn(11, { site_id: 101, product_add_on_id: 4 });
  await repository.deleteNewsletter(11, { site_id: 101, newsletter_id: 5 });
  await repository.deleteCustomerServiceLog(11, { site_id: 101, customer_service_log_id: 6 });

  assert.deepEqual(deleted.map(([table]) => table), [
    'discount_codes',
    'member_tiers',
    'threshold_gifts',
    'product_add_ons',
    'site_newsletters',
    'customer_service_logs'
  ]);
});

test('repository deletes members and revokes issued coupons within one site', async () => {
  const writes = [];
  const pool = {
    async query(sql, params) {
      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        return { rows: [{ id: 101, slug: 'site-1', name: '測試網站', callback_code: 'swcb_test101' }] };
      }
      if (sql.trimStart().startsWith('select') && sql.includes('from members') && sql.includes('where site_id = $1 and id = $2')) {
        return { rows: [{ id: params[1], site_id: 101, name: '會員' }] };
      }
      if (sql.includes('from member_coupons')) {
        return { rows: [{ id: params[2] ?? params[1], site_id: 101, member_id: params[1], status: 'issued' }] };
      }
      if (sql.includes('delete from members') || sql.includes('update member_coupons')) {
        writes.push(['sql', sql, params]);
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const repository = new WeblessAccountRepository(pool);

  await repository.deleteMember(11, { site_id: 101, member_id: 7 });
  await repository.revokeMemberCoupon(11, { site_id: 101, member_id: 7, member_coupon_id: 8 });

  assert.ok(writes.some((write) => write[0] === 'sql' && write[1].includes('delete from members')));
  assert.ok(writes.some((write) => write[0] === 'sql' && write[1].includes("status = 'revoked'")));
});

test('repository updates and reads mail delivery settings with SMTP fields', async () => {
  const pool = mailDeliverySettingsPool();
  const repository = new WeblessAccountRepository(pool, {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'))
  });

  const updated = await repository.updateMailDeliverySettings(11, {
    site_id: 101,
    notification_smtp_host: 'smtp.gmail.com',
    notification_smtp_username: 'mailer@example.com',
    notification_smtp_password: 'app-password',
    notification_smtp_port: '465',
    notification_smtp_from_email: 'mailer@example.com',
    notification_smtp_ssl: true
  });
  const read = await repository.getMailDeliverySettings(11, { site_id: 101 });

  assert.equal(updated.ok, true);
  assert.equal(read.settings.notification_smtp_host, 'smtp.gmail.com');
  assert.equal(read.settings.notification_smtp_username, 'mailer@example.com');
  assert.equal(read.settings.notification_smtp_port, '465');
  assert.equal(read.settings.notification_smtp_ssl, true);
});

test('repository rejects email member verification when SMTP is incomplete', async () => {
  const repository = new WeblessAccountRepository(readinessPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'))
  });

  await assert.rejects(
    () => repository.updateBasicSettings(11, {
      site_id: 101,
      member_verification: 'email'
    }),
    /SMTP/
  );
});

test('repository updates supported payment and logistics providers with card exclusivity', async () => {
  const pool = paymentLogisticsPool();
  const repository = new WeblessAccountRepository(pool, {
    laravelAppKey: 'base64:' + Buffer.from('12345678901234567890123456789012').toString('base64')
  });

  const context = await repository.getPaymentLogisticsSettings(11, { site_id: 101 });
  assert.equal(context.callback_urls.site_callback_code, 'swcb_test101');
  assert.equal(context.callback_urls.payment.ecpay.notify_url, 'https://slimweb.tw/callbacks/swcb_test101/payment/ecpay/notify');
  assert.equal(context.callback_urls.logistics.hct.notify_url, 'https://slimweb.tw/callbacks/swcb_test101/logistics/hct/notify');
  const updated = await repository.updatePaymentLogisticsSettings(11, {
    site_id: 101,
    payments: [
      {
        provider: 'ecpay',
        mode: 'production',
        is_enabled: true,
        merchant_id: '2000132',
        hash_key: 'hash-key',
        hash_iv: 'hash-iv',
        language: 'jp'
      },
      {
        provider: 'linepay',
        mode: 'production',
        is_enabled: true,
        merchant_id: 'line-merchant',
        hash_key: 'line-key'
      }
    ],
    logistics: [{
      provider: 'hct',
      mode: 'production',
      is_enabled: true,
      merchant_id: 'hct-id',
      password: 'hct-key',
      sender_name: '測試商店',
      sender_phone: '0223456789',
      sender_zip: '114',
      sender_address: '台北市內湖區康樂街101號',
      collect_payment_enabled: true
    }]
  });

  assert.deepEqual(context.supported_payment_providers.map((provider) => provider.provider), ['ecpay', 'newebpay', 'linepay']);
  assert.deepEqual(context.supported_payment_providers.find((provider) => provider.provider === 'linepay').language_options, ['zh-tw', 'zh-cn', 'en', 'jp', 'ko', 'th']);
  assert.deepEqual(context.supported_logistics_providers.find((provider) => provider.provider === 'ecpay').supported_store_types, ['seven', 'family', 'hilife', 'ok']);
  assert.equal(context.supported_logistics_providers.find((provider) => provider.provider === 'ecpay').follows_payment_provider, true);
  assert.deepEqual(context.supported_logistics_providers.find((provider) => provider.provider === 'newebpay').supported_store_types, ['seven', 'family', 'hilife']);
  assert.equal(context.supported_logistics_providers.find((provider) => provider.provider === 'hct').follows_payment_provider, false);
  assert.match(context.answer_policy.convenience_store_logistics_question, /reverse logistics/);
  assert.match(context.answer_policy.slimweb_site_payment_question, /綠界 ECPay/);
  assert.equal(updated.payment_providers.find((provider) => provider.provider === 'ecpay').is_enabled, true);
  assert.equal(updated.payment_providers.find((provider) => provider.provider === 'ecpay').settings.language, 'jp');
  assert.equal(updated.payment_providers.find((provider) => provider.provider === 'newebpay').is_enabled, false);
  assert.equal(updated.payment_providers.find((provider) => provider.provider === 'linepay').is_enabled, true);
  assert.equal(updated.logistics_providers.find((provider) => provider.provider === 'hct').settings.senderName, '測試商店');

  await assert.rejects(
    () => repository.updatePaymentLogisticsSettings(11, {
      site_id: 101,
      payments: [
        { provider: 'ecpay', is_enabled: true, merchant_id: 'a', hash_key: 'b', hash_iv: 'c' },
        { provider: 'newebpay', is_enabled: true, merchant_id: 'd', hash_key: 'e', hash_iv: 'f' }
      ]
    }),
    /Only one online card payment provider/
  );
});

test('repository updates ECPay and NewebPay logistics convenience-store rules', async () => {
  const pool = paymentLogisticsPool();
  const repository = new WeblessAccountRepository(pool, {
    laravelAppKey: 'base64:' + Buffer.from('12345678901234567890123456789012').toString('base64')
  });

  await repository.updatePaymentLogisticsSettings(11, {
    site_id: 101,
    payments: [{
      provider: 'ecpay',
      mode: 'production',
      is_enabled: true,
      merchant_id: '2000132',
      hash_key: 'hash-key',
      hash_iv: 'hash-iv'
    }],
    logistics: [{
      provider: 'ecpay',
      is_enabled: false,
      sender_name: '測試商店',
      sender_phone: '0223456789',
      sender_zip: '114',
      sender_address: '台北市內湖區康樂街101號',
      store_types: ['seven', 'family', 'hilife', 'ok'],
      logistics_type: 'b2c'
    }]
  });

  const ecpay = (await repository.getPaymentLogisticsSettings(11, { site_id: 101 }))
    .logistics_providers.find((provider) => provider.provider === 'ecpay');
  assert.equal(ecpay.mode, 'production');
  assert.equal(ecpay.is_enabled, true);
  assert.equal(ecpay.settings.merchantId, '2000132');
  assert.deepEqual(ecpay.settings.storeTypes, ['seven', 'family', 'hilife', 'ok']);
  assert.equal(ecpay.settings.logisticsType, 'b2c');
  assert.equal(ecpay.settings.hashKey, undefined);

  await repository.updatePaymentLogisticsSettings(11, {
    site_id: 101,
    payments: [{
      provider: 'newebpay',
      mode: 'test',
      is_enabled: true,
      merchant_id: 'MS123456789',
      hash_key: 'hash-key',
      hash_iv: 'hash-iv'
    }]
  });

  await assert.rejects(
    () => repository.updatePaymentLogisticsSettings(11, {
      site_id: 101,
      logistics: [{
        provider: 'newebpay',
        is_enabled: true,
        sender_name: '測試商店',
        sender_phone: '0223456789',
        sender_zip: '114',
        sender_address: '台北市內湖區康樂街101號',
        store_types: ['ok']
      }]
    }),
    /store_types for newebpay/
  );
});

test('repository manages coupon templates with admin coupon rules', async () => {
  const pool = couponPool();
  const repository = new WeblessAccountRepository(pool);

  const listed = await repository.listCouponTemplates(11, { site_id: 101 });
  const created = await repository.upsertCouponTemplate(11, {
    site_id: 101,
    name: '母親節全館券',
    discount_amount: 200,
    minimum_spend: 0,
    issue_trigger: 'all_members',
    starts_at: '2099-05-01',
    ends_at: '2099-05-12'
  });
  const threshold = await repository.upsertCouponTemplate(11, {
    site_id: 101,
    name: '滿額禮券',
    discount_amount: 150,
    issue_trigger: 'order_threshold',
    trigger_amount: 2000,
    starts_at: '2099-05-01',
    ends_at: '2099-05-31'
  });
  const birthday = await repository.upsertCouponTemplate(11, {
    site_id: 101,
    name: '生日禮券',
    discount_amount: 100,
    issue_trigger: 'birthday'
  });

  assert.equal(listed.coupon_templates[0].name, '手動客服券');
  assert.equal(created.coupon_template.issue_trigger, 'all_members');
  assert.equal(threshold.coupon_template.trigger_amount, 2000);
  assert.equal(birthday.coupon_template.starts_at, null);
  assert.equal(birthday.coupon_template.ends_at, null);
  assert.deepEqual(created.guidance.issue_trigger_choices.map((choice) => choice.value), ['manual', 'all_members', 'order_threshold', 'birthday', 'product_bundle']);

  await assert.rejects(
    () => repository.upsertCouponTemplate(11, {
      site_id: 101,
      name: '缺日期',
      discount_amount: 100,
      issue_trigger: 'all_members'
    }),
    /starts_at is required/
  );
});

test('repository assigns active manual coupons to one member', async () => {
  const pool = couponPool();
  const repository = new WeblessAccountRepository(pool);

  const issued = await repository.issueMemberCoupon(11, {
    site_id: 101,
    member_id: 88,
    coupon_template_id: 2
  });

  assert.equal(issued.member.email, 'member@example.com');
  assert.equal(issued.member_coupon.status, 'issued');
  assert.equal(issued.member_coupon.issued_reason, 'manual');

  await assert.rejects(
    () => repository.issueMemberCoupon(11, {
      site_id: 101,
      member_id: 88,
      coupon_template_id: 2
    }),
    /already has an active copy/
  );
});

test('repository creates and reads Webless custom page content files', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const repository = new WeblessAccountRepository(fakePool(), {
    storageRoot,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const created = await repository.createPage(11, {
    site_id: 101,
    title: 'Japan Travel Codex Test',
    content: {
      html: '<section><h1>日本旅遊三城小旅行</h1><p>京都、北海道、大阪</p></section>'
    }
  });

  assert.equal(created.ok, true);
  assert.equal(created.storage_path, 'sites/101/templates/default/pages/japan-travel-codex-test/content.blade.php');
  assert.equal(
    await readFile(path.join(storageRoot, created.storage_path), 'utf8'),
    '<section><h1>日本旅遊三城小旅行</h1><p>京都、北海道、大阪</p></section>\n'
  );

  const read = await repository.getPageContent(11, {
    site_id: 101,
    page_name: 'japan-travel-codex-test'
  });

  assert.equal(read.exists, true);
  assert.equal(read.content.html, '<section><h1>日本旅遊三城小旅行</h1><p>京都、北海道、大阪</p></section>\n');
});

test('repository stores page-scoped libraries as managed CDN dependencies while returning clean HTML', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const repository = new WeblessAccountRepository(fakePool(), {
    storageRoot,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const created = await repository.createPage(11, {
    site_id: 101,
    title: 'Animated About Us',
    enabled_libraries: ['swiper', 'animate_css', 'scrolltrigger'],
    content: {
      html: '<section class="swiper"><div class="swiper-wrapper"><div class="swiper-slide">About</div></div></section><script>document.addEventListener("DOMContentLoaded", () => { gsap.to(".swiper", { opacity: 1 }); });</script>'
    }
  });
  const storedHtml = await readFile(path.join(storageRoot, created.storage_path), 'utf8');
  const metadata = JSON.parse(await readFile(path.join(storageRoot, created.metadata_path), 'utf8'));
  const read = await repository.getPageContent(11, {
    site_id: 101,
    page_name: 'animated-about-us'
  });

  assert.deepEqual(created.enabled_libraries, ['animate_css', 'swiper', 'gsap', 'scrolltrigger']);
  assert.match(storedHtml, /slimweb:page-libraries:start/);
  assert.match(storedHtml, /animate\.css@4\.1\.1/);
  assert.match(storedHtml, /swiper@12\/swiper-bundle\.min\.js/);
  assert.match(storedHtml, /gsap@3\.13\.0\/dist\/gsap\.min\.js/);
  assert.match(storedHtml, /ScrollTrigger\.min\.js/);
  assert.deepEqual(metadata.enabled_libraries, ['animate_css', 'swiper', 'gsap', 'scrolltrigger']);
  assert.deepEqual(read.enabled_libraries, ['animate_css', 'swiper', 'gsap', 'scrolltrigger']);
  assert.doesNotMatch(read.content.html, /slimweb:page-libraries/);
  assert.match(read.content.html, /<script>document\.addEventListener/);
});

test('repository updates content SEO metadata for custom pages after page workflows', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const repository = new WeblessAccountRepository(fakePool(), {
    storageRoot,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  await repository.createPage(11, {
    site_id: 101,
    title: '京都三日遊',
    content: {
      html: '<section><h1>京都三日遊</h1><p>清水寺、嵐山與祇園。</p></section>'
    }
  });

  const updated = await repository.updateContentSeo(11, {
    site_id: 101,
    content_type: 'page',
    page_name: '京都三日遊',
    workflow_context: 'page_create',
    seo_title: '京都三日遊行程規劃',
    canonical_url: 'https://slimweb.tw/sites/site-1/pages/page-101?utm_source=test#schedule',
    og_description: '清水寺、嵐山與祇園的三日旅行安排。'
  });
  const metadata = JSON.parse(await readFile(path.join(storageRoot, updated.metadata_path), 'utf8'));

  assert.equal(updated.ok, true);
  assert.equal(updated.content_type, 'page');
  assert.equal(updated.page.page_key, 'page-101');
  assert.equal(updated.metadata_path, 'sites/101/templates/default/pages/page-101/.page.json');
  assert.equal(metadata.name, '京都三日遊');
  assert.deepEqual(Object.keys(metadata.seo).sort(), [
    'seo_title',
    'seo_description',
    'seo_keywords',
    'canonical_url',
    'robots_policy',
    'og_title',
    'og_description',
    'og_image_url',
    'llms_txt',
    'aeo_business_summary',
    'aeo_target_audience',
    'aeo_products_services',
    'aeo_customer_questions',
    'aeo_answer_style',
    'aeo_entity_facts',
    'geo_citation_targets',
    'geo_verifiable_claims',
    'geo_trust_signals',
    'geo_same_as_profiles',
    'geo_comparison_positioning'
  ].sort());
  assert.match(metadata.seo_updated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(metadata.seo.seo_title, '京都三日遊行程規劃');
  assert.equal(metadata.seo.canonical_url, 'https://slimweb.tw/sites/site-1/pages/page-101');
  assert.equal(metadata.seo.og_description, '清水寺、嵐山與祇園的三日旅行安排。');
  assert.equal(metadata.seo.robots_policy, 'index,follow');
});

test('repository rejects unrelated content canonical hosts before writing metadata', async () => {
  const repository = new WeblessAccountRepository(fakePool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  await assert.rejects(
    () => repository.updateContentSeo(11, {
      site_id: 101,
      content_type: 'page',
      page_name: '京都三日遊',
      workflow_context: 'page_update',
      canonical_url: 'https://other.example.com/page',
      og_image_url: 'ftp://files.example.com/image.jpg'
    }),
    (error) => error?.code === 'VALIDATION_FAILED' && /canonical_url/.test(error.message)
  );

  await assert.rejects(
    () => repository.updateContentSeo(11, {
      site_id: 101,
      content_type: 'page',
      page_name: '京都三日遊',
      workflow_context: 'page_update',
      canonical_url: 'https://slimweb.tw/sites/site-1/pages/page-101',
      og_image_url: 'ftp://files.example.com/image.jpg'
    }),
    (error) => error?.code === 'VALIDATION_FAILED' && /og_image_url/.test(error.message)
  );
});

test('repository writes article SEO to the documented storage contract', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const basePool = fakePool();
  const repository = new WeblessAccountRepository({
    async query(sql, params) {
      if (sql.includes('from articles') && sql.includes('where site_id = $1 and id = $2')) {
        assert.deepEqual(params, [101, 88]);
        return { rows: [{
          id: 88,
          site_id: 101,
          title: 'SEO Article',
          content: '<p>Article</p>',
          cover_path: null,
          created_at: new Date('2026-08-01T00:00:00Z'),
          updated_at: new Date('2026-08-02T00:00:00Z')
        }] };
      }
      return basePool.query(sql, params);
    }
  }, {
    storageRoot,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const updated = await repository.updateContentSeo(11, {
    site_id: 101,
    content_type: 'article',
    article_id: 88,
    workflow_context: 'article_update',
    seo_title: 'SEO Article Title'
  });
  const metadata = JSON.parse(await readFile(path.join(storageRoot, updated.metadata_path), 'utf8'));

  assert.equal(updated.metadata_path, 'sites/101/articles/88/seo.json');
  assert.equal(metadata.article_id, 88);
  assert.equal(metadata.seo.seo_title, 'SEO Article Title');
  assert.match(metadata.seo_updated_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('repository rejects standalone content SEO updates without workflow context', async () => {
  const repository = new WeblessAccountRepository(fakePool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  await assert.rejects(
    () => repository.updateContentSeo(11, {
      site_id: 101,
      content_type: 'page',
      page_name: '京都三日遊',
      seo_title: '京都三日遊'
    }),
    /workflow_context must be page_create, page_update, article_create, or article_update/
  );
});

test('repository reads and updates editable homepage content through page tools', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const repository = new WeblessAccountRepository(fakePool(), {
    storageRoot,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const homepagePath = path.join(storageRoot, 'sites/101/templates/default/pages/index/content.blade.php');
  await mkdir(path.dirname(homepagePath), { recursive: true });
  await writeFile(
    homepagePath,
    '<section>Original homepage</section>\n',
    'utf8'
  );

  const pages = await repository.listPages(11, { site_id: 101 });
  const indexPage = pages.pages.find((page) => page.page_key === 'index');

  assert.equal(indexPage?.is_fixed, true);
  assert.equal(indexPage?.can_edit, true);
  assert.equal(indexPage?.can_delete, false);

  const read = await repository.getPageContent(11, {
    site_id: 101,
    page_name: 'index'
  });

  assert.equal(read.exists, true);
  assert.equal(read.page_key, 'index');
  assert.equal(read.is_fixed, true);
  assert.equal(read.can_edit, true);
  assert.equal(read.content.html, '<section>Original homepage</section>\n');

  const updated = await repository.updatePage(11, {
    site_id: 101,
    page_name: 'index',
    content: {
      html: '<section>Original homepage</section><section>Poster</section>'
    }
  });

  assert.equal(updated.ok, true);
  assert.equal(updated.page_key, 'index');
  assert.equal(updated.title, '首頁');
  assert.equal(updated.storage_path, 'sites/101/templates/default/pages/index/content.blade.php');
  assert.equal(updated.metadata_path, null);
  assert.equal(
    await readFile(path.join(storageRoot, updated.storage_path), 'utf8'),
    '<section>Original homepage</section><section>Poster</section>\n'
  );
});

test('repository falls back to legacy formal homepage template when site-level homepage is empty', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const repository = new WeblessAccountRepository(fakePool(), {
    storageRoot,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const legacyHomepagePath = path.join(storageRoot, 'site-page-templates/101/7/pages/index.blade.php');
  await mkdir(path.dirname(legacyHomepagePath), { recursive: true });
  await writeFile(
    legacyHomepagePath,
    '<section>Legacy homepage</section>\n',
    'utf8'
  );

  const read = await repository.getPageContent(11, {
    site_id: 101,
    page_name: 'index'
  });

  assert.equal(read.content.html, '<section>Legacy homepage</section>\n');
  assert.equal(read.storage_path, 'site-page-templates/101/7/pages/index.blade.php');

  const updated = await repository.updatePage(11, {
    site_id: 101,
    page_name: 'index',
    content: {
      html: '<section>Legacy homepage</section><section>Poster</section>'
    }
  });

  assert.equal(updated.storage_path, 'site-page-templates/101/7/pages/index.blade.php');
  assert.equal(
    await readFile(path.join(storageRoot, updated.storage_path), 'utf8'),
    '<section>Legacy homepage</section><section>Poster</section>\n'
  );
});

test('repository still rejects non-home fixed page updates', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const repository = new WeblessAccountRepository(fakePool(), {
    storageRoot,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  await assert.rejects(
    () => repository.updatePage(11, {
      site_id: 101,
      page_name: 'cart',
      content: {
        html: '<section>Cart override</section>'
      }
    }),
    /Fixed template pages cannot be modified/
  );
});

test('repository creates custom pages at the site level regardless of theme_id', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const repository = new WeblessAccountRepository(fakePool(), {
    storageRoot,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const created = await repository.createPage(11, {
    site_id: 101,
    title: 'One Page Home',
    theme_id: 22,
    content: {
      html: '<section class="hero">One homepage</section>'
    }
  });

  assert.equal(created.storage_path, 'sites/101/templates/default/pages/one-page-home/content.blade.php');
  await assert.rejects(
    readFile(path.join(storageRoot, 'sites/101/templates/schemes/22/pages/one-page-home/body.blade.php'), 'utf8'),
    /ENOENT/
  );

  const read = await repository.getPageContent(11, {
    site_id: 101,
    page_name: 'one-page-home'
  });

  assert.equal(read.storage_path, 'sites/101/templates/default/pages/one-page-home/content.blade.php');
  assert.equal(read.content.html, '<section class="hero">One homepage</section>\n');
});

test('repository creates a custom page with a Chinese title when an ASCII page_key is provided', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const repository = new WeblessAccountRepository(fakePool(), {
    storageRoot,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const created = await repository.createPage(11, {
    site_id: 101,
    title: '大阪京都6日遊',
    page_key: 'osaka-kyoto-6d',
    content: {
      html: '<section><h1>大阪京都6日遊</h1><p>大阪與京都雙城旅行。</p></section>'
    }
  });

  assert.equal(created.page_key, 'osaka-kyoto-6d');
  assert.equal(created.storage_path, 'sites/101/templates/default/pages/osaka-kyoto-6d/content.blade.php');
  assert.equal(
    await readFile(path.join(storageRoot, created.storage_path), 'utf8'),
    '<section><h1>大阪京都6日遊</h1><p>大阪與京都雙城旅行。</p></section>\n'
  );
});

test('repository auto-generates a safe page key for a custom page with a Chinese title', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const repository = new WeblessAccountRepository(fakePool(), {
    storageRoot,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const created = await repository.createPage(11, {
    site_id: 101,
    title: '大阪京都6日遊',
    content: {
      html: '<section><h1>大阪京都6日遊</h1><p>大阪與京都雙城旅行。</p></section>'
    }
  });

  assert.equal(created.page_key, 'page-101');
  assert.equal(created.storage_path, 'sites/101/templates/default/pages/page-101/content.blade.php');
});

test('repository creates and searches custom pages with real public urls', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const repository = new WeblessAccountRepository(fakePool(), {
    storageRoot,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const created = await repository.createPage(11, {
    site_id: 101,
    title: 'Japan Travel Codex Test',
    theme_id: 22,
    content: {
      html: '<section><h1>日本旅遊三城小旅行</h1><p>京都、北海道、大阪</p></section>'
    }
  });

  assert.equal(created.storage_path, 'sites/101/templates/default/pages/japan-travel-codex-test/content.blade.php');
  assert.equal(created.metadata_path, 'sites/101/templates/default/pages/japan-travel-codex-test/.page.json');
  assert.equal(created.public_url, 'https://slimweb.tw/sites/site-1/pages/japan-travel-codex-test');
  await assert.rejects(
    readFile(path.join(storageRoot, 'sites/101/templates/schemes/22/pages/japan-travel-codex-test/body.blade.php'), 'utf8'),
    /ENOENT/
  );

  const pages = await repository.listPages(11, { site_id: 101 });
  const page = pages.pages.find((entry) => entry.page_key === 'japan-travel-codex-test');

  assert.equal(page?.title, 'Japan Travel Codex Test');
  assert.equal(page?.is_fixed, false);
  assert.equal(page?.public_url, 'https://slimweb.tw/sites/site-1/pages/japan-travel-codex-test');
  assert.equal(page?.can_edit, true);
  assert.equal(page?.can_delete, true);
  assert.ok(pages.pages.length >= 1);
});

test('repository lists custom pages with selected theme preview urls when theme_id is provided', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const repository = new WeblessAccountRepository(fakePool(), {
    storageRoot,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  await repository.createPage(11, {
    site_id: 101,
    title: 'Finland Aurora Trip',
    content: {
      html: '<section><h1>極光之旅</h1></section>'
    }
  });

  const pages = await repository.listPages(11, { site_id: 101, theme_id: 22 });
  const page = pages.pages.find((entry) => entry.page_key === 'finland-aurora-trip');

  assert.equal(page?.public_url, 'https://slimweb.tw/sites/site-1/default-preview?mcp_site_id=101&mcp_page_key=finland-aurora-trip&preview_page=finland-aurora-trip&mcp_theme_id=22&preview_style_scheme=22');
  assert.equal(page?.preview_url, 'https://slimweb.tw/sites/site-1/default-preview?mcp_site_id=101&mcp_page_key=finland-aurora-trip&preview_page=finland-aurora-trip&mcp_theme_id=22&preview_style_scheme=22');
});

test('repository creates and reads Webless custom page content files in GCS', async () => {
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

    if (String(url).startsWith('https://storage.googleapis.com/storage/v1/b/webless_bucket/o?prefix=')) {
      const parsed = new URL(url);
      const prefix = parsed.searchParams.get('prefix') ?? '';
      const items = Array.from(objects.keys())
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({ name }));

      return new Response(JSON.stringify({
        kind: 'storage#objects',
        items
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
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

  const created = await repository.createPage(11, {
    site_id: 101,
    title: 'GCS Page',
    content: {
      html: '<section class="hero">Hello GCS</section>'
    }
  });
  const read = await repository.getPageContent(11, { site_id: 101, page_name: 'gcs-page' });

  assert.equal(created.storage_path, 'sites/101/templates/default/pages/gcs-page/content.blade.php');
  assert.equal(read.content.html, '<section class="hero">Hello GCS</section>\n');
  assert.equal(objects.get(created.storage_path).contentType, 'text/x-php; charset=utf-8');
  assert.equal(requests.filter((request) => request.url === 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token').length, 1);
});

test('repository registers committed page assets under the selected Webless site', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const repository = new WeblessAccountRepository(fakePool(), {
    storageRoot,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const upload = await repository.uploadAsset(11, {
    site_id: 101,
    source: {
      media_path: 'sites/101/mcp-uploads/committed/hero.png'
    },
    target_usage: 'home_page',
    asset_scope: 'page',
    suggested_filename: 'hero.png',
    alt_text: 'Hero'
  });

  assert.equal(upload.ok, true);
  assert.equal(upload.storage_path, 'sites/101/mcp-uploads/committed/hero.png');
  assert.equal(upload.public_url, 'https://slimweb.tw/media/sites/101/mcp-uploads/committed/hero.png');
});

test('repository rejects unsafe page event handlers and unmanaged external scripts', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const repository = new WeblessAccountRepository(fakePool(), {
    storageRoot
  });

  await assert.rejects(
    repository.createPage(11, {
      site_id: 101,
      title: 'Bad page',
      content: {
        html: '<section onclick="alert(1)">Bad</section>'
      }
    }),
    /inline event handlers/
  );

  await assert.rejects(
    repository.createPage(11, {
      site_id: 101,
      title: 'Bad external script page',
      content: {
        html: '<section>Bad</section><script src="https://example.com/bad.js"></script>'
      },
      enabled_libraries: []
    }),
    /external script/
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
    theme_mode: 'dark'
  });

  assert.equal(result.theme.id, 22);
  assert.equal(result.theme.name, '可愛版型');
  assert.equal(result.theme.theme_mode, 'light');
  assert.equal(result.inherits_site_theme_mode, true);
  assert.equal(result.site_theme_mode, 'dark');
  assert.equal(result.copied_from_default, true);
  assert.equal(result.content_fallback, 'site_level_homepage');
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

test('repository public theme list excludes Default', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const result = await repository.listThemesForAccountSite(11, {
    site_id: 101
  });

  assert.deepEqual(result.themes.map((theme) => theme.name), ['可愛版型']);
  assert.equal(result.themes.some((theme) => theme.is_default), false);
});

test('repository updates site-level theme mode', async () => {
  const pool = themeMutationPool();
  const repository = new WeblessAccountRepository(pool, {
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const result = await repository.updateSiteThemeMode(11, {
    site_id: 101,
    theme_mode: 'dark'
  });

  assert.equal(result.ok, true);
  assert.equal(result.theme_mode, 'dark');
  assert.equal(result.scope, 'site');
});

test('repository activates a selected theme for a site', async () => {
  const pool = themeMutationPool();
  const repository = new WeblessAccountRepository(pool, {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const result = await repository.activateTheme(11, {
    site_id: 101,
    theme_id: '22'
  });

  assert.equal(result.ok, true);
  assert.equal(result.theme.id, 22);
  assert.equal(result.theme.is_active, true);
  assert.equal(result.themes.find((theme) => theme.id === 7).is_active, false);
  assert.equal(result.themes.find((theme) => theme.id === 22).is_active, true);
  assert.match(result.preview_url, /preview_style_scheme=22/);
  assert.equal(pool.queries.some((query) => query.sql === 'BEGIN'), true);
  assert.equal(pool.queries.some((query) => query.sql === 'COMMIT'), true);
});

test('repository returns theme shell context for design reference', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const repository = new WeblessAccountRepository(designContextPool({ categoryNavigationMode: 'navbar_categories' }), {
    storageRoot,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  await repository.storage.write(
    'sites/101/templates/schemes/22/assets/root-elements/css/00-mcp-theme.css',
    Buffer.from('.navbar{background:pink}\n.footer{background:mistyrose}\n', 'utf8')
  );

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
  assert.deepEqual(context.theme_scope.root_elements, ['navbar', 'floating_actions', 'footer']);
  assert.match(context.theme_scope.navbar_fragment_rule, /static HTML.*Blade.*PHP.*components.*bound attributes/i);
  assert.match(context.theme_scope.navbar_fragment_rule, /balanced tree.*div.*nav.*header.*structurally empty/i);
  assert.match(context.theme_scope.navbar_href_rule, /literal href.*#.*relative.*https?/i);
  assert.equal(context.storefront_actions.website_type, 'ecommerce');
  assert.equal(context.storefront_actions.theme_slot_requirement, 'required');
  assert.deepEqual(context.storefront_actions.required_theme_slots, ['primary_navigation', 'member_auth', 'cart']);
  assert.equal(context.storefront_actions.slot_attributes.primary_navigation, 'data-storefront-primary-navigation-slot');
  assert.equal(context.storefront_actions.slot_attributes.member_auth, 'data-storefront-member-auth-slot');
  assert.equal(context.storefront_actions.slot_attributes.cart, 'data-storefront-cart-slot');
  assert.equal(context.product_categories.navigation_mode, 'navbar_categories');
  assert.deepEqual(context.product_categories.runtime_states, ['category_menu', 'navbar_categories']);
  assert.deepEqual(context.product_categories.runtime_hooks, {
    runtime_container: 'data-storefront-primary-navigation-runtime',
    primary_navigation: 'data-storefront-primary-navigation',
    category_menu: 'data-storefront-category-menu',
    navbar_categories: 'data-storefront-navbar-categories',
    ordinary_navigation: 'data-storefront-nav-items',
    node: 'data-storefront-nav-node',
    trigger: 'data-storefront-nav-trigger',
    panel: 'data-storefront-nav-panel',
    children: 'data-storefront-nav-children',
    depth: 'data-storefront-nav-depth'
  });
  assert.match(context.product_categories.serialization_rule, /labels.*URLs.*not.*serialized.*Theme root HTML/i);
  assert.match(context.storefront_actions.visibility_rule, /Webless runtime/i);
  assert.equal(context.storefront_actions.required_navbar_actions, undefined);
  assert.match(context.storefront_actions.appearance_rule, /appearance/i);
  assert.deepEqual(context.floating_actions.default_actions, ['scroll_top', 'ai_assistant']);
  assert.equal(context.floating_actions.ai_assistant_enabled, true);
  assert.equal(context.online_support, undefined);
  assert.equal(context.root_css.current_css, '.navbar{background:pink}\n.footer{background:mistyrose}\n');
  assert.equal(context.root_css.update_field, 'css');
});

test('repository requires the same navbar presentation slots for brand sites', async () => {
  const repository = new WeblessAccountRepository(designContextPool({ websiteType: 'brand' }), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const context = await repository.getThemeShellContext(11, {
    site_id: 101,
    theme_id: 22
  });

  assert.equal(context.storefront_actions.website_type, 'brand');
  assert.equal(context.storefront_actions.theme_slot_requirement, 'required');
  assert.deepEqual(context.storefront_actions.required_theme_slots, ['primary_navigation', 'member_auth', 'cart']);
  assert.equal(context.storefront_actions.slot_attributes.primary_navigation, 'data-storefront-primary-navigation-slot');
  assert.equal(context.storefront_actions.slot_attributes.member_auth, 'data-storefront-member-auth-slot');
  assert.equal(context.storefront_actions.slot_attributes.cart, 'data-storefront-cart-slot');
  assert.match(context.storefront_actions.visibility_rule, /Webless runtime/i);
});

test('repository theme shell context falls back to category menu navigation mode', async () => {
  const repository = new WeblessAccountRepository(designContextPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const context = await repository.getThemeShellContext(11, {
    site_id: 101,
    theme_id: 22
  });

  assert.equal(context.product_categories.navigation_mode, 'category_menu');
  assert.deepEqual(context.product_categories.runtime_states, ['category_menu', 'navbar_categories']);
});

test('repository accepts model-shaped theme id values for theme shell context', async () => {
  const repository = new WeblessAccountRepository(designContextPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const context = await repository.getThemeShellContext(11, {
    site_id: 101,
    theme_id: { id: 22, name: '可愛版型' }
  });

  assert.equal(context.theme.id, 22);
  assert.equal(context.navbar.counts.total_items, 2);
});

test('repository accepts string theme id values for theme shell context', async () => {
  const repository = new WeblessAccountRepository(designContextPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const context = await repository.getThemeShellContext(11, {
    site_id: 101,
    theme_id: '22'
  });

  assert.equal(context.theme.id, 22);
  assert.equal(context.reference_only, true);
});

test('repository returns visual design context for the active theme', async () => {
  const repository = new WeblessAccountRepository(designContextPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const context = await repository.getDesignContext(11, {
    site_id: 101
  });

  assert.equal(context.theme.id, 22);
  assert.equal(context.design_summary, '童趣、柔和、手繪插圖');
  assert.equal(context.color_mode, 'light');
  assert.equal(context.framework, 'Tailwind');
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

test('repository stores theme style profile actor id from admin identity object', async () => {
  const pool = styleProfilePool();
  const repository = new WeblessAccountRepository(pool, {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'))
  });
  const actor = {
    account_id: 11,
    email: 'admin@example.test',
    site_id: 101,
    permissions: ['backend_ai_assistant', 'page_management_templates']
  };

  const upserted = await repository.upsertThemeStyleProfile(actor, {
    site_id: 101,
    theme_id: 22,
    summary: '暗色版型',
    visual_keywords: ['dark mode']
  });
  const appended = await repository.appendThemeStyleProfileRequest(actor, {
    site_id: 101,
    theme_id: 22,
    request: '補上黑底白字規格'
  });

  assert.equal(pool.state.profile.created_by_account_id, 2);
  assert.equal(pool.state.profile.updated_by_account_id, 2);
  assert.equal(appended.profile.user_requests.length, 1);
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
      navbar: '<nav class="cute-nav"><div data-storefront-primary-navigation-slot></div><div data-storefront-commerce-actions><button data-storefront-member-auth-slot>註冊／登入</button><button data-storefront-cart-slot>購物車</button></div></nav>',
      floating_actions: '<div class="cute-actions"><button>LINE</button></div>',
      footer: '<footer>Cute footer</footer>'
    },
    css: '.cute-nav{background:#fff7d6}'
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.updated_fragments, ['navbar', 'floating_actions', 'footer']);
  assert.equal(
    await readFile(path.join(storageRoot, 'sites/101/templates/schemes/22/root-elements/floating-actions.blade.php'), 'utf8'),
    '<div class="cute-actions"><button>LINE</button></div>\n'
  );
  assert.equal(
    await readFile(path.join(storageRoot, 'sites/101/templates/schemes/22/root-elements/navbar.blade.php'), 'utf8'),
    '<nav class="cute-nav"><div data-storefront-primary-navigation-slot></div><div data-storefront-commerce-actions><button data-storefront-member-auth-slot>註冊／登入</button><button data-storefront-cart-slot>購物車</button></div></nav>\n'
  );
  assert.equal(
    await readFile(path.join(storageRoot, 'sites/101/templates/schemes/22/root-elements/footer.blade.php'), 'utf8'),
    '<footer>Cute footer</footer>\n'
  );
  assert.equal(
    await readFile(path.join(storageRoot, 'sites/101/templates/schemes/22/assets/root-elements/css/00-mcp-theme.css'), 'utf8'),
    '.cute-nav{background:#fff7d6}\n'
  );

  const defaultResult = await repository.updateThemeRootElements(11, {
    site_id: 101,
    theme_id: 7,
    fragments: {
      navbar: '<nav class="default-nav"><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
      floating_actions: '<button data-scroll-top>Top</button>',
      footer: '<footer class="default-footer">Default footer</footer>'
    },
    css: '.default-nav{background:#fff0f5}'
  });
  assert.equal(defaultResult.ok, true);
  assert.deepEqual(defaultResult.updated_fragments, ['navbar', 'floating_actions', 'footer']);
  assert.equal(
    await readFile(path.join(storageRoot, 'sites/101/templates/default/root-elements/floating-actions.blade.php'), 'utf8'),
    '<button data-scroll-top>Top</button>\n'
  );
  assert.equal(
    await readFile(path.join(storageRoot, 'sites/101/templates/default/root-elements/navbar.blade.php'), 'utf8'),
    '<nav class="default-nav"><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>\n'
  );
  assert.equal(
    await readFile(path.join(storageRoot, 'sites/101/templates/default/root-elements/footer.blade.php'), 'utf8'),
    '<footer class="default-footer">Default footer</footer>\n'
  );
  assert.equal(
    await readFile(path.join(storageRoot, 'sites/101/templates/default/assets/root-elements/css/00-mcp-theme.css'), 'utf8'),
    '.default-nav{background:#fff0f5}\n'
  );
});

test('repository rejects navbar fragments without exactly one primary container and clickable member and cart slots', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  for (const navbar of [
    '<nav><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button></nav>',
    '<nav><div data-storefront-primary-navigation-slot></div><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><div data-storefront-primary-navigation-slot></div><div data-storefront-member-auth-slot>Member</div><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>One</button><button data-storefront-member-auth-slot>Two</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><div data-storefront-primary-navigation-slot></div><section data-storefront-primary-navigation-slot></section><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>'
  ]) {
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: { navbar }
      }),
      /navbar.*slot|slot.*navbar/i
    );
  }
});

test('repository rejects clickable primary navigation slots', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  for (const primarySlot of [
    '<a href="#" data-storefront-primary-navigation-slot>Navigation</a>',
    '<button type="button" data-storefront-primary-navigation-slot>Navigation</button>'
  ]) {
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: {
          navbar: `<nav>${primarySlot}<button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>`
        }
      }),
      /primary-navigation-slot.*supported structural container/i
    );
  }
});

test('repository rejects void and inherently interactive elements as primary navigation containers', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  for (const primarySlot of [
    '<select data-storefront-primary-navigation-slot><option>Navigation</option></select>',
    '<textarea data-storefront-primary-navigation-slot>Navigation</textarea>',
    '<label data-storefront-primary-navigation-slot>Navigation</label>',
    '<details data-storefront-primary-navigation-slot><summary>Navigation</summary></details>',
    '<img src="navigation.webp" alt="" data-storefront-primary-navigation-slot>',
    '<input type="hidden" data-storefront-primary-navigation-slot>',
    '<br data-storefront-primary-navigation-slot>'
  ]) {
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: {
          navbar: `<nav>${primarySlot}<button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>`
        }
      }),
      /primary-navigation-slot.*supported structural container/i
    );
  }
});

for (const [element, primarySlot] of [
  ['audio', '<audio controls data-storefront-primary-navigation-slot></audio>'],
  ['video', '<video controls data-storefront-primary-navigation-slot></video>'],
  ['iframe', '<iframe src="about:blank" data-storefront-primary-navigation-slot></iframe>'],
  ['object', '<object data="about:blank" data-storefront-primary-navigation-slot></object>']
]) {
  test(`repository rejects ${element} as a primary navigation container`, async () => {
    const repository = new WeblessAccountRepository(themeMutationPool(), {
      storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
      publicSiteBaseUrl: 'https://slimweb.tw'
    });

    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: {
          navbar: `<nav>${primarySlot}<button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>`
        }
      }),
      /primary-navigation-slot.*supported structural container|HTML content cannot include/i
    );
  });
}

test('repository accepts structural primary navigation containers', async () => {
  for (const element of ['div', 'nav', 'header']) {
    const repository = new WeblessAccountRepository(themeMutationPool(), {
      storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
      publicSiteBaseUrl: 'https://slimweb.tw'
    });
    const result = await repository.updateThemeRootElements(11, {
      site_id: 101,
      theme_id: 22,
      fragments: {
        navbar: `<nav><${element} data-storefront-primary-navigation-slot></${element}><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>`
      }
    });

    assert.deepEqual(result.updated_fragments, ['navbar']);
  }
});

test('repository rejects malformed or unbalanced navbar trees and self-closing HTML containers', async () => {
  const navbars = [
    '<nav><div data-storefront-primary-navigation-slot></nav><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button>',
    '<nav><div data-storefront-primary-navigation-slot /><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><div><span></div></span><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>'
  ];

  for (const navbar of navbars) {
    const repository = new WeblessAccountRepository(themeMutationPool(), {
      storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
      publicSiteBaseUrl: 'https://slimweb.tw'
    });
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: { navbar }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && /HTML parse error.*(unclosed|self closing|trailing solidus|unexpected|duplicate|end tag)/i.test(error.message)
    );
  }
});

test('repository requires an empty non-inline primary slot outside interactive ancestors', async () => {
  const navbars = [
    '<nav><span data-storefront-primary-navigation-slot></span><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><div data-storefront-primary-navigation-slot>Runtime goes here</div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><div data-storefront-primary-navigation-slot><span>child</span></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><button><div data-storefront-primary-navigation-slot></div></button><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><div data-storefront-primary-navigation-slot><button data-storefront-member-auth-slot>Member</button></div><button data-storefront-cart-slot>Cart</button></nav>'
  ];

  for (const navbar of navbars) {
    const repository = new WeblessAccountRepository(themeMutationPool(), {
      storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
      publicSiteBaseUrl: 'https://slimweb.tw'
    });
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: { navbar }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && /primary-navigation-slot|interactive ancestor|structurally empty/i.test(error.message)
    );
  }
});

test('repository requires three distinct required-slot elements outside interactive ancestors', async () => {
  const navbars = [
    '<nav><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot data-storefront-cart-slot>Actions</button></nav>',
    '<nav><div data-storefront-primary-navigation-slot></div><a href="#"><button data-storefront-member-auth-slot>Member</button></a><button data-storefront-cart-slot>Cart</button></nav>'
  ];

  for (const navbar of navbars) {
    const repository = new WeblessAccountRepository(themeMutationPool(), {
      storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
      publicSiteBaseUrl: 'https://slimweb.tw'
    });
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: { navbar }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && /distinct|required.*slot|interactive ancestor/i.test(error.message)
    );
  }
});

test('repository accepts a balanced static navbar tree with wrappers, comments, and SVG icons', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const result = await repository.updateThemeRootElements(11, {
    site_id: 101,
    theme_id: 22,
    fragments: {
      navbar: '<nav><div class="navigation-wrap"><header data-storefront-primary-navigation-slot> <!-- runtime --> </header><div class="actions"><button data-storefront-member-auth-slot><svg viewBox="0 0 24 24"><path d="M1 1h2" /></svg>Member</button><a href="/cart" data-storefront-cart-slot><span>Cart</span></a></div></div></nav>'
    }
  });

  assert.deepEqual(result.updated_fragments, ['navbar']);
});

test('repository reports HTML5 parse errors with source locations', async () => {
  const slots = '<div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button>';
  const navbars = [
    `<nav><!-->${slots}</nav>`,
    '<nav><div data-storefront-primary-navigation-slot></nav><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button>',
    `<nav><div data-storefront-primary-navigation-slot />${slots.slice(slots.indexOf('<button'))}</nav>`,
    `<nav><div data-storefront-primary-navigation-slot data-storefront-primary-navigation-slot></div>${slots.slice(slots.indexOf('<button'))}</nav>`
  ];

  for (const navbar of navbars) {
    const repository = new WeblessAccountRepository(themeMutationPool(), {
      storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
      publicSiteBaseUrl: 'https://slimweb.tw'
    });
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: { navbar }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && /line 1, column \d+/i.test(error.message)
        && /HTML parse error/i.test(error.message)
    );
  }
});

test('repository follows HTML5 unquoted slash semantics while preserving valid SVG and comments', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const result = await repository.updateThemeRootElements(11, {
    site_id: 101,
    theme_id: 22,
    fragments: {
      navbar: '<nav><!-- static --><header data-storefront-primary-navigation-slot></header><a href=/member/ data-storefront-member-auth-slot><svg viewBox="0 0 10 10"><path d="M0 0h1" /></svg>Member</a><button data-storefront-cart-slot>Cart</button><a href=/help/>Help</a></nav>'
    }
  });

  assert.deepEqual(result.updated_fragments, ['navbar']);
});

test('repository rejects document wrapper tags that HTML5 fragment parsing would discard', async () => {
  const slots = '<div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button>';

  for (const wrapper of ['html', 'head', 'body']) {
    for (const navbar of [`<${wrapper}>${slots}</${wrapper}>`, `<${wrapper}>${slots}`]) {
      const repository = new WeblessAccountRepository(themeMutationPool(), {
        storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
        publicSiteBaseUrl: 'https://slimweb.tw'
      });
      await assert.rejects(
        repository.updateThemeRootElements(11, {
          site_id: 101,
          theme_id: 22,
          fragments: { navbar }
        }),
        (error) => error?.code === 'VALIDATION_FAILED'
          && new RegExp(`document wrapper <${wrapper}>`, 'i').test(error.message)
          && /line 1, column 1/i.test(error.message)
      );
    }
  }
});

test('repository rejects wrapper start tags after an ordinary fragment element', async () => {
  const slots = '<div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button>';

  for (const wrapper of ['html', 'head', 'body']) {
    for (const navbar of [`<nav>${slots}</nav><${wrapper}></${wrapper}>`, `<nav>${slots}</nav><${wrapper}>`]) {
      const repository = new WeblessAccountRepository(themeMutationPool(), {
        storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
        publicSiteBaseUrl: 'https://slimweb.tw'
      });
      await assert.rejects(
        repository.updateThemeRootElements(11, {
          site_id: 101,
          theme_id: 22,
          fragments: { navbar }
        }),
        (error) => error?.code === 'VALIDATION_FAILED'
          && new RegExp(`document wrapper <${wrapper}>`, 'i').test(error.message)
          && /line 1, column \d+/i.test(error.message)
      );
    }
  }
});

test('repository accepts wrapper-shaped text inside comments and quoted attributes', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const result = await repository.updateThemeRootElements(11, {
    site_id: 101,
    theme_id: 22,
    fragments: {
      navbar: '<nav title="literal <html> text" data-note=\'literal <body> text\'><!-- literal <head> text --><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>'
    }
  });

  assert.deepEqual(result.updated_fragments, ['navbar']);
});

test('repository accepts wrapper-shaped text inside style and title raw text', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const result = await repository.updateThemeRootElements(11, {
    site_id: 101,
    theme_id: 22,
    fragments: {
      navbar: '<nav><style>.sample::before { content: "<html><body>"; }</style><title>literal <head> text</title><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>'
    }
  });

  assert.deepEqual(result.updated_fragments, ['navbar']);
});

test('repository requires every navbar anchor to have exactly one valued safe nonblank href', async () => {
  const hrefForms = ['', ' href', ' href=""', ' href="   "', ' href="/one" href="/two"'];

  for (const href of hrefForms) {
    const repository = new WeblessAccountRepository(themeMutationPool(), {
      storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
      publicSiteBaseUrl: 'https://slimweb.tw'
    });
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: {
          navbar: `<nav><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button><a${href}>Ordinary</a></nav>`
        }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && /every.*anchor|anchor.*exactly one.*href|duplicate attribute/i.test(error.message)
    );
  }
});

test('repository rejects unavailable required slots and accepts explicitly available controls', async () => {
  const unavailable = [
    '<nav><div hidden data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav inert><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav aria-hidden="true"><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><div data-storefront-primary-navigation-slot></div><button aria-disabled="true" data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav aria-disabled="true"><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><span hidden><button data-storefront-cart-slot>Cart</button></span></nav>',
    '<nav><div data-storefront-primary-navigation-slot></div><fieldset disabled><button data-storefront-member-auth-slot>Member</button></fieldset><button data-storefront-cart-slot>Cart</button></nav>'
  ];

  for (const navbar of unavailable) {
    const repository = new WeblessAccountRepository(themeMutationPool(), {
      storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
      publicSiteBaseUrl: 'https://slimweb.tw'
    });
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: { navbar }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && /required slot|primary-navigation-slot|member-auth-slot|cart-slot/i.test(error.message)
        && /available|hidden|inert|disabled/i.test(error.message)
    );
  }

  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const result = await repository.updateThemeRootElements(11, {
    site_id: 101,
    theme_id: 22,
    fragments: {
      navbar: '<nav aria-hidden="false"><div data-storefront-primary-navigation-slot></div><fieldset><button aria-disabled="false" data-storefront-member-auth-slot>Member</button></fieldset><a href="/cart" aria-disabled="false" data-storefront-cart-slot>Cart</a><a href="help">Help</a></nav>'
    }
  });
  assert.deepEqual(result.updated_fragments, ['navbar']);
});

test('repository rejects required slots on foreign-namespace SVG and MathML elements', async () => {
  const navbars = [
    '<nav><div data-storefront-primary-navigation-slot></div><svg><a href="#member" data-storefront-member-auth-slot>Member</a><button data-storefront-cart-slot>Cart</button></svg></nav>',
    '<nav><div data-storefront-primary-navigation-slot></div><math><a href="#member" data-storefront-member-auth-slot>Member</a><button data-storefront-cart-slot>Cart</button></math></nav>',
    '<nav><svg><nav data-storefront-primary-navigation-slot></nav></svg><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><math><nav data-storefront-primary-navigation-slot></nav></math><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>'
  ];

  for (const navbar of navbars) {
    const repository = new WeblessAccountRepository(themeMutationPool(), {
      storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
      publicSiteBaseUrl: 'https://slimweb.tw'
    });
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: { navbar }
      }),
      (error) => error?.code === 'VALIDATION_FAILED' && /required.*HTML namespace|slot.*HTML namespace/i.test(error.message)
    );
  }
});

test('repository rejects elements outside the primary navigation structural allowlist', async () => {
  for (const element of ['style', 'template', 'canvas', 'meter', 'progress', 'svg']) {
    const repository = new WeblessAccountRepository(themeMutationPool(), {
      storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
      publicSiteBaseUrl: 'https://slimweb.tw'
    });

    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: {
          navbar: `<nav><${element} data-storefront-primary-navigation-slot></${element}><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>`
        }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && (
          /primary-navigation-slot.*supported structural container/i.test(error.message)
          || /primary-navigation-slot.*HTML namespace/i.test(error.message)
          || (element === 'template' && /does not allow the template element/i.test(error.message))
        )
    );
  }
});

test('repository rejects disabled member and cart buttons', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  for (const [attribute, label] of [
    ['data-storefront-member-auth-slot', 'Member'],
    ['data-storefront-cart-slot', 'Cart']
  ]) {
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: {
          navbar: `<nav><div data-storefront-primary-navigation-slot></div><button ${attribute} disabled>${label}</button>${attribute.includes('member') ? '<button data-storefront-cart-slot>Cart</button>' : '<button data-storefront-member-auth-slot>Member</button>'}</nav>`
        }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && new RegExp(`${attribute}.*enabled button`, 'i').test(error.message)
    );
  }
});

test('repository rejects member and cart anchors without a usable href', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  for (const href of ['', ' href=""', ' href="   "']) {
    for (const attribute of ['data-storefront-member-auth-slot', 'data-storefront-cart-slot']) {
      const otherSlot = attribute.includes('member')
        ? '<button data-storefront-cart-slot>Cart</button>'
        : '<button data-storefront-member-auth-slot>Member</button>';

      await assert.rejects(
        repository.updateThemeRootElements(11, {
          site_id: 101,
          theme_id: 22,
          fragments: {
            navbar: `<nav><div data-storefront-primary-navigation-slot></div><a ${attribute}${href}>Action</a>${otherSlot}</nav>`
          }
        }),
        (error) => error?.code === 'VALIDATION_FAILED'
          && new RegExp(`${attribute}.*usable href`, 'i').test(error.message)
      );
    }
  }
});

test('repository accepts enabled buttons and anchors with usable static hrefs', async () => {
  for (const [memberSlot, cartSlot] of [
    ['<button data-storefront-member-auth-slot>Member</button>', '<button type="button" data-storefront-cart-slot>Cart</button>'],
    ['<a href="#member" data-storefront-member-auth-slot>Member</a>', '<a href="/cart" data-storefront-cart-slot>Cart</a>']
  ]) {
    const repository = new WeblessAccountRepository(themeMutationPool(), {
      storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
      publicSiteBaseUrl: 'https://slimweb.tw'
    });
    const result = await repository.updateThemeRootElements(11, {
      site_id: 101,
      theme_id: 22,
      fragments: {
        navbar: `<nav><div data-storefront-primary-navigation-slot></div>${memberSlot}${cartSlot}</nav>`
      }
    });

    assert.deepEqual(result.updated_fragments, ['navbar']);
  }
});

test('repository rejects unsafe or unsupported hrefs on required-slot and ordinary Theme anchors', async () => {
  const unsafeHrefs = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'java&#x0a;script&colon;alert(1)',
    '&#106;avascript&#58;alert(1)',
    'data:text/plain,unsafe',
    'vbscript:msgbox(1)',
    'ftp://example.test/file'
  ];

  for (const href of unsafeHrefs) {
    for (const placement of ['member', 'cart', 'ordinary']) {
      const repository = new WeblessAccountRepository(themeMutationPool(), {
        storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
        publicSiteBaseUrl: 'https://slimweb.tw'
      });
      const memberSlot = placement === 'member'
        ? `<a href="${href}" data-storefront-member-auth-slot>Member</a>`
        : '<button data-storefront-member-auth-slot>Member</button>';
      const cartSlot = placement === 'cart'
        ? `<a href="${href}" data-storefront-cart-slot>Cart</a>`
        : '<button data-storefront-cart-slot>Cart</button>';
      const ordinaryAnchor = placement === 'ordinary' ? `<a href="${href}">Other</a>` : '';

      await assert.rejects(
        repository.updateThemeRootElements(11, {
          site_id: 101,
          theme_id: 22,
          fragments: {
            navbar: `<nav><div data-storefront-primary-navigation-slot></div>${memberSlot}${cartSlot}${ordinaryAnchor}</nav>`
          }
        }),
        (error) => error?.code === 'VALIDATION_FAILED'
          && /anchor has an unsafe or unsupported href/i.test(error.message)
      );
    }
  }
});

test('repository rejects Blade route helpers now that navbar hrefs must be literal', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  await assert.rejects(
    repository.updateThemeRootElements(11, {
      site_id: 101,
      theme_id: 22,
      fragments: {
        navbar: '<nav><div data-storefront-primary-navigation-slot></div><a href="{{ route(\'member.login\') }}" data-storefront-member-auth-slot>Member</a><button data-storefront-cart-slot>Cart</button></nav>'
      }
    }),
    (error) => error?.code === 'VALIDATION_FAILED'
      && /static HTML|server-template|Blade syntax/i.test(error.message)
  );
});

test('repository accepts safe literal hrefs on all Theme anchors', async () => {
  const safeHrefs = [
    '#fragment',
    'account',
    'account/profile?tab=orders',
    '?view=compact',
    '/account',
    './account',
    '../account',
    '//shop.example.test/account',
    'http://shop.example.test/account',
    'https://shop.example.test/account'
  ];

  for (const href of safeHrefs) {
    const repository = new WeblessAccountRepository(themeMutationPool(), {
      storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
      publicSiteBaseUrl: 'https://slimweb.tw'
    });
    const result = await repository.updateThemeRootElements(11, {
      site_id: 101,
      theme_id: 22,
      fragments: {
        navbar: `<nav><div data-storefront-primary-navigation-slot></div><a href="${href}" data-storefront-member-auth-slot>Member</a><button data-storefront-cart-slot>Cart</button><a href="${href}">Other</a></nav>`
      }
    });

    assert.deepEqual(result.updated_fragments, ['navbar']);
  }
});

test('repository ignores required slots that exist only inside HTML comments', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  await assert.rejects(
    repository.updateThemeRootElements(11, {
      site_id: 101,
      theme_id: 22,
      fragments: {
        navbar: `<nav>
          <!--
            <div data-storefront-primary-navigation-slot></div>
            <button data-storefront-member-auth-slot>Member</button>
            <button data-storefront-cart-slot>Cart</button>
          -->
        </nav>`
      }
    }),
    /navbar.*slot|slot.*navbar/i
  );
});

test('repository ignores duplicate slot markers in well-formed HTML comments and rejects unterminated comments', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const liveSlots = '<div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button>';

  const result = await repository.updateThemeRootElements(11, {
    site_id: 101,
    theme_id: 22,
    fragments: { navbar: `<nav aria-label="Navigation > <!-- label text -->">${liveSlots}<!-- <div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot></button><button data-storefront-cart-slot></button> --></nav>` }
  });
  assert.deepEqual(result.updated_fragments, ['navbar']);

  await assert.rejects(
    repository.updateThemeRootElements(11, {
      site_id: 101,
      theme_id: 22,
      fragments: { navbar: `<nav>${liveSlots}<!-- unterminated</nav>` }
    }),
    /HTML parse error.*eof in comment/i
  );
});

test('repository ignores reserved runtime attributes that exist only inside comments', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const result = await repository.updateThemeRootElements(11, {
    site_id: 101,
    theme_id: 22,
    fragments: {
      navbar: '<nav><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button><!-- <div data-storefront-nav-node></div> --></nav>'
    }
  });

  assert.deepEqual(result.updated_fragments, ['navbar']);
});

test('repository rejects executable Blade syntax inside ordinary HTML comments', async () => {
  const liveSlots = '<div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button>';
  const commentBodies = [
    '{{ system("id") }}',
    '{!! system("id") !!}',
    '@php system("id"); @endphp'
  ];

  for (const commentBody of commentBodies) {
    const repository = new WeblessAccountRepository(themeMutationPool(), {
      storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
      publicSiteBaseUrl: 'https://slimweb.tw'
    });

    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: {
          navbar: `<nav>${liveSlots}<!-- ${commentBody} --></nav>`
        }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && /HTML comments.*Blade|static slot structure.*Blade/i.test(error.message)
    );
  }
});

test('repository rejects server-template syntax inside Blade comments', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  await assert.rejects(
    repository.updateThemeRootElements(11, {
      site_id: 101,
      theme_id: 22,
      fragments: {
        navbar: `<nav><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button>{{-- {{ system("id") }} --}}</nav>`
      }
    }),
    /static HTML|Blade syntax/i
  );
});

test('repository rejects unterminated Blade comments instead of ignoring executable tails', async () => {
  const liveSlots = '<div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button>';
  const unterminatedComments = [
    '{{-- {!! system("id") !!}',
    '{{-- @php system("id"); @endphp'
  ];

  for (const comment of unterminatedComments) {
    const repository = new WeblessAccountRepository(themeMutationPool(), {
      storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
      publicSiteBaseUrl: 'https://slimweb.tw'
    });

    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: {
          navbar: `<nav>${liveSlots}${comment}</nav>`
        }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && /static HTML|Blade syntax/i.test(error.message)
    );
  }
});

test('repository ignores required slots that exist only inside Blade comments', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  await assert.rejects(
    repository.updateThemeRootElements(11, {
      site_id: 101,
      theme_id: 22,
      fragments: {
        navbar: `<nav>
          {{--
            <div data-storefront-primary-navigation-slot></div>
            <button data-storefront-member-auth-slot>Member</button>
            <button data-storefront-cart-slot>Cart</button>
          --}}
        </nav>`
      }
    }),
    /static HTML|Blade syntax/i
  );
});

test('repository rejects duplicate slot markers inside Blade comments as server-template syntax', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  await assert.rejects(
    repository.updateThemeRootElements(11, {
      site_id: 101,
      theme_id: 22,
      fragments: {
        navbar: '<nav><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button>{{-- duplicate slots --}}</nav>'
      }
    }),
    /static HTML|Blade syntax/i
  );
});

test('repository ignores tag-shaped slot and reserved text inside style raw text', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const result = await repository.updateThemeRootElements(11, {
    site_id: 101,
    theme_id: 22,
    fragments: {
      navbar: `<nav>
        <style>.example::before { content: "<div data-storefront-primary-navigation-slot data-storefront-nav-node>ignored ></div>"; }</style>
        <div data-storefront-primary-navigation-slot></div>
        <button data-storefront-member-auth-slot>Member</button>
        <button data-storefront-cart-slot>Cart</button>
      </nav>`
    }
  });

  assert.deepEqual(result.updated_fragments, ['navbar']);
});

test('repository rejects every server-template construct in navbar HTML', async () => {
  const liveSlots = '<div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button>';
  const navbars = [
    `<nav><?php system('id'); ?>${liveSlots}</nav>`,
    `<nav>{{ $value }}${liveSlots}</nav>`,
    `<nav>{!! $markup !!}${liveSlots}</nav>`,
    `<nav>@if(true)${liveSlots}@endif</nav>`,
    `<nav>{{-- ${liveSlots} --}}${liveSlots}</nav>`,
    `<nav><!-- <?php system('id'); ?> -->${liveSlots}</nav>`,
    `<nav><style>.x{content:"<?php system('id'); ?>"}</style>${liveSlots}</nav>`,
    `<nav title="<?php system('id'); ?>">${liveSlots}</nav>`,
    `<nav><x-navigation>${liveSlots}</x-navigation></nav>`,
    `<nav><x-slot:actions>${liveSlots}</x-slot:actions></nav>`,
    `<nav :class="$classes">${liveSlots}</nav>`,
    `<nav x-bind:class="$classes">${liveSlots}</nav>`
  ];

  for (const navbar of navbars) {
    const repository = new WeblessAccountRepository(themeMutationPool(), {
      storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
      publicSiteBaseUrl: 'https://slimweb.tw'
    });
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: { navbar }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && /static HTML|server-template|Blade syntax/i.test(error.message)
    );
  }
});

test('repository rejects inert or parser-changing elements in Theme navbar fragments', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const cases = [
    {
      element: 'noscript',
      navbar: '<nav><noscript><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></noscript></nav>'
    },
    {
      element: 'noscript',
      navbar: '<nav><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button><noscript><div data-storefront-primary-navigation-slot data-storefront-nav-node></div></noscript></nav>'
    },
    {
      element: 'plaintext',
      navbar: '<nav><plaintext>fallback <div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>'
    },
    {
      element: 'template',
      navbar: '<nav><template><div title="quoted </template> text"><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></div></template></nav>'
    },
    {
      element: 'noscript',
      navbar: '<nav><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></noscript></nav>'
    }
  ];

  for (const { element, navbar } of cases) {
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: { navbar }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && (
          new RegExp(`Theme navbar does not allow the ${element} element`, 'i').test(error.message)
          || /HTML parse error/i.test(error.message)
        )
    );
  }
});

test('repository rejects malformed tags instead of scanning nested required or reserved markers', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const malformedNavbars = [
    '<nav><div title="unterminated <div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><div class=broken <span data-storefront-nav-node></span><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>'
  ];

  for (const navbar of malformedNavbars) {
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: { navbar }
      }),
      (error) => error?.code === 'VALIDATION_FAILED' && /HTML parse error.*(eof|attribute|tag)/i.test(error.message)
    );
  }
});

test('repository rejects standalone Blade constructs inside opening tags', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const navbars = [
    '<nav {{ $attrs }}><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><div {!! $attrs !!} data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot @disabled($locked)>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot @class($classes)>Cart</button></nav>',
    '<nav class={{ $class }}><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>'
  ];

  for (const navbar of navbars) {
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: { navbar }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && /does not allow dynamic Blade attributes inside opening tags/i.test(error.message)
    );
  }
});

test('repository accepts a literal member href with otherwise static navbar markup', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const result = await repository.updateThemeRootElements(11, {
    site_id: 101,
    theme_id: 22,
    fragments: {
      navbar: '<nav class="site-nav"><div data-storefront-primary-navigation-slot></div><a href="/member/login" data-storefront-member-auth-slot>Member</a><a href="/cart" class="cart-link" data-storefront-cart-slot>Cart</a></nav>'
    }
  });

  assert.deepEqual(result.updated_fragments, ['navbar']);
});

test('repository rejects Blade constructs anywhere inside unquoted attribute values', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const navbars = [
    '<nav class=foo{{ $class }}><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav class=foo{!! $class !!}><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav class=prefix@disabled($locked)><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav data-state=prefix@class($classes)suffix><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>'
  ];

  for (const navbar of navbars) {
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: { navbar }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && /does not allow dynamic Blade attributes inside opening tags/i.test(error.message)
    );
  }
});

test('repository permits ordinary at signs in safe quoted and unquoted values', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const result = await repository.updateThemeRootElements(11, {
    site_id: 101,
    theme_id: 22,
    fragments: {
      navbar: '<nav class="site-nav" data-handle="support@slimweb"><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button><a href=https://user@example.test/path data-label=user@example.test>Other</a></nav>'
    }
  });

  assert.deepEqual(result.updated_fragments, ['navbar']);
});

test('repository rejects required slots hidden inside a false Blade branch', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  await assert.rejects(
    repository.updateThemeRootElements(11, {
      site_id: 101,
      theme_id: 22,
      fragments: {
        navbar: '<nav>@if(false)<div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button>@endif</nav>'
      }
    }),
    (error) => error?.code === 'VALIDATION_FAILED'
      && /static slot structure.*does not allow.*Blade/i.test(error.message)
  );
});

test('repository rejects mutually exclusive Blade slot branches with a static-structure error', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const branch = '<div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button>';

  await assert.rejects(
    repository.updateThemeRootElements(11, {
      site_id: 101,
      theme_id: 22,
      fragments: {
        navbar: `<nav>@if($compact)${branch}@else${branch}@endif</nav>`
      }
    }),
    (error) => error?.code === 'VALIDATION_FAILED'
      && /static slot structure.*does not allow.*Blade/i.test(error.message)
      && !/duplicate/i.test(error.message)
  );
});

test('repository rejects raw Blade output in text and quoted attribute values', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const liveSlots = '<div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button>';

  for (const navbar of [
    `<nav>{!! $runtimeMarkup !!}${liveSlots}</nav>`,
    `<nav data-runtime="{!! $attrs !!}">${liveSlots}</nav>`
  ]) {
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: { navbar }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && /static slot structure.*does not allow.*Blade/i.test(error.message)
    );
  }
});

test('repository rejects unapproved escaped Blade expressions in text and quoted attributes', async () => {
  const expressions = [
    '{{ system("id") }}',
    '{{ new App\\RuntimeMarkup }}',
    '{{ RuntimeMarkup::make() }}',
    '{{ $site->render() }}',
    '{{ $left . $right }}',
    '{{ $items[0] }}',
    '{{ call_user_func($handler) }}',
    '{{ new Illuminate\\Support\\HtmlString($runtimeMarkup) }}',
    '{{ $runtimeMarkup }}',
    '{{ $class }}',
    '{{ $site->name }}'
  ];
  const liveSlots = '<div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button>';

  for (const expression of expressions) {
    for (const navbar of [
      `<nav>${expression}${liveSlots}</nav>`,
      `<nav title='${expression}'>${liveSlots}</nav>`
    ]) {
      const repository = new WeblessAccountRepository(themeMutationPool(), {
        storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
        publicSiteBaseUrl: 'https://slimweb.tw'
      });

      await assert.rejects(
        repository.updateThemeRootElements(11, {
          site_id: 101,
          theme_id: 22,
          fragments: { navbar }
        }),
        (error) => error?.code === 'VALIDATION_FAILED'
          && /escaped Blade expression.*not allowed/i.test(error.message)
      );
    }
  }
});

test('repository rejects unclosed or malformed escaped Blade echoes', async () => {
  const liveSlots = '<div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button>';
  const navbars = [
    `<nav>{{ $name ${liveSlots}</nav>`,
    `<nav title="{{ $class">${liveSlots}</nav>`,
    `<nav>{{ }}${liveSlots}</nav>`
  ];

  for (const navbar of navbars) {
    const repository = new WeblessAccountRepository(themeMutationPool(), {
      storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
      publicSiteBaseUrl: 'https://slimweb.tw'
    });

    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: { navbar }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && /malformed escaped Blade expression|escaped Blade expression.*not allowed/i.test(error.message)
    );
  }
});

test('repository rejects structural and output-capable Blade directives in navbar text', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const liveSlots = '<div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button>';
  const directives = [
    '@if($visible)', '@elseif($compact)', '@else', '@endif',
    '@foreach($items as $item)', '@endforeach', '@for($i = 0; $i < 1; $i++)', '@endfor',
    '@while($visible)', '@endwhile', '@forelse($items as $item)', '@empty', '@endforelse',
    "@include('nav.part')", "@component('nav.part')", '@endcomponent',
    '@php', '@endphp', '@verbatim', '@endverbatim', '@auth', '@endauth',
    "@can('edit')", '@endcan', '@isset($value)', '@endisset', '@empty($value)', '@endempty',
    "@section('navbar')", '@endsection', "@yield('navbar')", "@push('navbar')", '@endpush', "@stack('navbar')"
  ];

  for (const directive of directives) {
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: { navbar: `<nav>${directive}${liveSlots}</nav>` }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && /static slot structure.*does not allow.*Blade/i.test(error.message)
    );
  }
});

test('repository rejects standalone no-parenthesis and custom Blade directives generically', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const liveSlots = '<div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button>';
  const directives = ['@break', '@continue', '@enderror', '@stop', '@overwrite', '@admin', '@endadmin'];

  for (const directive of directives) {
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: { navbar: `<nav>${directive} protected content ${liveSlots}</nav>` }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && /static slot structure.*does not allow.*Blade/i.test(error.message)
    );
  }
});

test('repository rejects Laravel directives after dot, plus, and minus boundaries', async () => {
  const liveSlots = '<div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button>';
  const navbars = [
    `<nav>.@if(false)${liveSlots}</nav>`,
    `<nav>+@if(false)${liveSlots}</nav>`,
    `<nav>-@if(false)${liveSlots}</nav>`,
    `<nav>.@php system('id'); .@endphp${liveSlots}</nav>`,
    `<nav>+@php system('id'); +@endphp${liveSlots}</nav>`,
    `<nav>-@break${liveSlots}</nav>`
  ];

  for (const navbar of navbars) {
    const repository = new WeblessAccountRepository(themeMutationPool(), {
      storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
      publicSiteBaseUrl: 'https://slimweb.tw'
    });

    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: { navbar }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && /static slot structure.*does not allow.*Blade/i.test(error.message)
    );
  }
});

test('repository rejects embedded directive calls inside quoted attribute values', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  await assert.rejects(
    repository.updateThemeRootElements(11, {
      site_id: 101,
      theme_id: 22,
      fragments: {
        navbar: '<nav title="prefix@admin($user)"><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>'
      }
    }),
    (error) => error?.code === 'VALIDATION_FAILED'
      && /static slot structure.*does not allow.*Blade/i.test(error.message)
  );
});

test('repository rejects Blade attribute-generating directives on slot elements', async () => {
  const directives = [
    '@class($classes)', '@style($styles)', '@checked($checked)', '@selected($selected)',
    '@disabled($disabled)', '@readonly($readonly)', '@required($required)'
  ];

  for (const directive of directives) {
    const repository = new WeblessAccountRepository(themeMutationPool(), {
      storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
      publicSiteBaseUrl: 'https://slimweb.tw'
    });

    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: {
          navbar: `<nav><div ${directive} data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>`
        }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && /static slot structure.*does not allow.*Blade/i.test(error.message)
    );
  }
});

test('repository keeps email addresses and encoded leading-at handles in harmless text', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const result = await repository.updateThemeRootElements(11, {
    site_id: 101,
    theme_id: 22,
    fragments: {
      navbar: '<nav title="Contact hello@example.test or &#64;slimweb" data-handle="support@slimweb"><div data-storefront-primary-navigation-slot></div><span>Welcome — hello@example.test &#64;slimweb</span><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>'
    }
  });

  assert.deepEqual(result.updated_fragments, ['navbar']);
});

test('repository requires exact required-slot attribute names', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const navbars = [
    '<nav><div x-data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><div data-storefront-primary-navigation-slot></div><button x-data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button x-data-storefront-cart-slot>Cart</button></nav>'
  ];

  for (const navbar of navbars) {
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: { navbar }
      }),
      /navbar.*slot|slot.*navbar/i
    );
  }
});

test('repository counts duplicate required-slot attributes on the same opening tag', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const navbars = [
    '<nav><div data-storefront-primary-navigation-slot data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot data-storefront-cart-slot>Cart</button></nav>'
  ];

  for (const navbar of navbars) {
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: { navbar }
      }),
      /HTML parse error.*duplicate attribute/i
    );
  }
});

test('repository rejects reserved storefront runtime navigation attributes in theme navbar fragments', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  for (const attribute of [
    'data-storefront-auth-open',
    'data-storefront-primary-navigation-runtime',
    'data-storefront-primary-navigation',
    'data-storefront-category-menu',
    'data-storefront-navbar-categories',
    'data-storefront-nav-items',
    'data-storefront-nav-node',
    'data-storefront-nav-trigger',
    'data-storefront-nav-panel',
    'data-storefront-nav-children',
    'data-storefront-nav-depth'
  ]) {
    await assert.rejects(
      repository.updateThemeRootElements(11, {
        site_id: 101,
        theme_id: 22,
        fragments: {
          navbar: `<nav ${attribute}><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>`
        }
      }),
      (error) => error?.code === 'VALIDATION_FAILED'
        && error.message === `Theme navbar contains reserved storefront runtime attribute: ${attribute}.`
    );
  }
});

test('repository does not treat a prefixed runtime attribute as an exact reserved attribute', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const result = await repository.updateThemeRootElements(11, {
    site_id: 101,
    theme_id: 22,
    fragments: {
      navbar: '<nav x-data-storefront-nav-node><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>'
    }
  });

  assert.deepEqual(result.updated_fragments, ['navbar']);
});

test('repository allows non-navbar root fragment updates without repeating navbar slots', async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const result = await repository.updateThemeRootElements(11, {
    site_id: 101,
    theme_id: 22,
    fragments: { footer: '<footer>Footer only</footer>' }
  });

  assert.deepEqual(result.updated_fragments, ['footer']);
});

test('repository rejects the removed online_support root fragment', async () => {
  const repository = new WeblessAccountRepository(themeMutationPool(), {
    storageRoot: await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-')),
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  await assert.rejects(
    repository.updateThemeRootElements(11, {
      site_id: 101,
      theme_id: 22,
      fragments: { online_support: '<button>Old</button>' }
    }),
    /Unsupported root element fragment: online_support/
  );
});

function orderOperationsPool() {
  const state = {
    queries: [],
    site: {
      id: 101,
      slug: 'site-1',
      name: '測試網站',
      domain: '',
      callback_code: 'swcb_test101',
      site_status: 'active'
    },
    logisticsProviders: [
      { id: 1, site_id: 101, provider: 'hct', mode: 'test', is_enabled: true, settings: { collect_payment_enabled: true, sender_name: '測試人' }, sort_order: 40 },
      { id: 2, site_id: 101, provider: 'ecpay', mode: 'test', is_enabled: true, settings: { store_types: ['seven'], logistics_type: 'b2c' }, sort_order: 10 }
    ],
    paymentProviders: [
      { id: 1, site_id: 101, provider: 'ecpay', mode: 'test', is_enabled: true, settings: {}, sort_order: 10 }
    ],
    orders: [
      {
        id: 1,
        site_id: 101,
        order_no: 'SWCVS',
        status: 'pending',
        payment_method: 'cvs_pickup_cod',
        payment_provider: 'ecpay',
        payment_completed_at: new Date('2026-06-01T01:00:00Z'),
        payment_completed_at_display: '2026-06-01 01:00:00',
        logistics_completed_at: null,
        logistics_details: null,
        pickup_store_provider: 'ecpay',
        pickup_store_type: 'seven',
        pickup_store_id: '123456',
        pickup_store_name: '測試門市',
        return_requested_at: null,
        return_cancelled_at: null,
        return_status: null,
        return_logistics_tracking_no: null,
        refund_status: null,
        refund_completed_at: null,
        refund_amount: 0,
        grand_total_amount: 1200,
        item_count: 1,
        total_quantity: 1,
        created_at: new Date('2026-06-01T01:00:00Z'),
        created_at_display: '2026-06-01 01:00:00'
      },
      {
        id: 2,
        site_id: 101,
        order_no: 'SWHOME',
        status: 'confirmed',
        payment_method: 'home_delivery_online_payment',
        payment_provider: 'ecpay',
        payment_completed_at: new Date('2026-06-01T02:00:00Z'),
        logistics_completed_at: null,
        logistics_details: null,
        pickup_store_provider: null,
        pickup_store_type: null,
        pickup_store_id: null,
        return_requested_at: new Date('2026-06-01T03:00:00Z'),
        return_cancelled_at: null,
        return_status: 'pending',
        return_logistics_tracking_no: null,
        refund_status: null,
        refund_completed_at: null,
        refund_amount: 0,
        grand_total_amount: 2000,
        item_count: 1,
        total_quantity: 1,
        recipient_name: 'Eric Chen',
        recipient_phone: '0912123123',
        recipient_zip: '104',
        recipient_address: '台北市內湖區',
        created_at: new Date('2026-06-01T02:00:00Z')
      },
      {
        id: 3,
        site_id: 101,
        order_no: 'SWUNPAID',
        status: 'pending',
        payment_method: 'home_delivery_online_payment',
        payment_provider: 'ecpay',
        payment_completed_at: null,
        logistics_completed_at: null,
        logistics_details: null,
        pickup_store_provider: null,
        pickup_store_type: null,
        pickup_store_id: null,
        return_requested_at: null,
        return_cancelled_at: null,
        return_status: null,
        return_logistics_tracking_no: null,
        refund_status: null,
        refund_completed_at: null,
        refund_amount: 0,
        grand_total_amount: 1600,
        item_count: 1,
        total_quantity: 1,
        buyer_name: '陳 Bobo',
        buyer_email: 'bobo@example.com',
        recipient_name: '陳 Bobo',
        recipient_phone: '0911111111',
        created_at: new Date('2026-06-01T04:00:00Z')
      }
    ],
    orderItems: [
      { id: 1, order_id: 1, product_id: 1, quantity: 2 },
      { id: 2, order_id: 2, product_id: 2, quantity: 1 },
      { id: 3, order_id: 3, product_id: 1, quantity: 1 }
    ],
    products: [
      { id: 1, cost_price: 500 },
      { id: 2, cost_price: 0 }
    ]
  };

  return {
    state,
    async query(sql, params) {
      state.queries.push({ sql, params });
      const filterOrdersForSql = () => state.orders.filter((order) => {
        if (sql.includes('return_requested_at is not null') && !order.return_requested_at) {
          return false;
        }
        if (sql.includes('(return_requested_at is null or return_cancelled_at is not null)') && order.return_requested_at && !order.return_cancelled_at) {
          return false;
        }
        if (sql.includes('payment_completed_at is not null') && !order.payment_completed_at) {
          return false;
        }
        if (sql.includes('payment_completed_at is null') && order.payment_completed_at) {
          return false;
        }
        if (sql.includes('logistics_completed_at is null') && order.logistics_completed_at) {
          return false;
        }
        return true;
      });

      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        return { rows: [state.site] };
      }
      if (sql.includes('select shipping_fee') && sql.includes('from sites')) {
        return { rows: [{ shipping_fee: 120 }] };
      }
      if (sql.includes('from site_payment_providers') && sql.includes('where site_id = $1')) {
        return { rows: state.paymentProviders };
      }
      if (sql.includes('from site_logistics_providers') && sql.includes('where site_id = $1')) {
        return { rows: state.logisticsProviders };
      }
      if (sql.includes('select count(*)::int as total') && sql.includes('from orders')) {
        return { rows: [{ total: String(filterOrdersForSql().length) }] };
      }
      if (sql.includes('from orders') && sql.includes('limit $') && sql.includes('return_requested_at is not null')) {
        return { rows: filterOrdersForSql() };
      }
      if (sql.includes('from orders') && sql.includes('limit $') && sql.includes('(return_requested_at is null or return_cancelled_at is not null)')) {
        return { rows: filterOrdersForSql() };
      }
      if (sql.includes('from orders') && sql.includes('limit 1')) {
        return {
          rows: state.orders.filter((order) => order.site_id === params[0]
            && (params[1] === null || order.id === params[1])
            && (params[2] === null || order.order_no === params[2])).slice(0, 1)
        };
      }
      if (sql.includes('sum(coalesce(p.cost_price, 0)') && sql.includes('from orders o')) {
        const dateFrom = params[1] ?? null;
        const dateTo = params[2] ?? null;
        return {
          rows: state.orders
            .filter((order) => order.site_id === params[0])
            .filter((order) => order.payment_completed_at)
            .filter((order) => order.status !== 'cancelled')
            .filter((order) => !dateFrom || String(order.created_at_display ?? order.created_at).slice(0, 10) >= dateFrom)
            .filter((order) => !dateTo || String(order.created_at_display ?? order.created_at).slice(0, 10) <= dateTo)
            .map((order) => {
              const items = state.orderItems.filter((item) => item.order_id === order.id);
              const hasMissingCost = items.length === 0 || items.some((item) => {
                const product = state.products.find((candidate) => candidate.id === item.product_id);
                return !product || Number.parseInt(product.cost_price ?? '0', 10) <= 0;
              });
              const productCostTotal = items.reduce((total, item) => {
                const product = state.products.find((candidate) => candidate.id === item.product_id);
                return total + (Number.parseInt(product?.cost_price ?? '0', 10) * Number.parseInt(item.quantity ?? '0', 10));
              }, 0);

              return {
                id: order.id,
                order_no: order.order_no,
                grand_total_amount: order.grand_total_amount,
                shipping_fee_amount: order.shipping_fee_amount ?? 0,
                product_cost_total: productCostTotal,
                item_count: items.length,
                has_missing_cost: hasMissingCost
              };
            })
        };
      }
      if (sql.includes('from order_items')) {
        return { rows: [] };
      }
      if (sql.includes('update orders') && sql.includes('logistics_details')) {
        const order = state.orders.find((item) => item.id === params[1]);
        order.logistics_completed_at = new Date();
        order.logistics_details = JSON.parse(params[2]);
        return { rows: [] };
      }
      if (sql.includes('update orders') && sql.includes('return_logistics_details')) {
        const order = state.orders.find((item) => item.id === params[1]);
        order.return_status = 'created';
        order.return_logistics_provider = params[2];
        order.return_logistics_type = params[3];
        order.return_logistics_tracking_no = params[4];
        order.return_logistics_status = 'created';
        order.return_logistics_details = JSON.parse(params[5]);
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

test('repository exposes order actions and validates logistics creation', async () => {
  const pool = orderOperationsPool();
  const repository = new WeblessAccountRepository(pool, {
    laravelAppKey: 'base64:' + Buffer.from('12345678901234567890123456789012').toString('base64')
  });

  const orders = await repository.listOrders(11, { site_id: 101 });
  assert.equal(orders.orders[0].order_no, 'SWCVS');
  assert.equal(orders.orders[0].created_at, '2026-06-01 01:00:00');
  assert.equal(orders.orders[0].payment_completed_at, '2026-06-01 01:00:00');
  assert.deepEqual(orders.orders[0].available_actions.filter((action) => action.action === 'create_logistics').map((action) => [action.provider, action.store_type]), [['ecpay', 'seven']]);

  await assert.rejects(
    () => repository.createOrderLogistics(11, { site_id: 101, order_no: 'SWCVS', provider: 'hct' }),
    /cannot create the requested logistics/
  );

  const updated = await repository.createOrderLogistics(11, { site_id: 101, order_no: 'SWCVS', provider: 'ecpay', store_type: 'seven' });
  assert.equal(updated.order.logistics_status, 'created');

  const returns = await repository.listPendingReturns(11, { site_id: 101 });
  const returnActions = returns.orders[0].available_actions.map((action) => action.action);
  assert.ok(returnActions.includes('cancel_return'));
  assert.ok(returnActions.includes('complete_return'));
  assert.ok(returnActions.includes('create_return_logistics'));
});

test('repository searches orders with admin pending and payment incomplete filters', async () => {
  const pool = orderOperationsPool();
  const repository = new WeblessAccountRepository(pool, {
    laravelAppKey: 'base64:' + Buffer.from('12345678901234567890123456789012').toString('base64')
  });

  const pending = await repository.listOrders(11, { site_id: 101, logistics_status: 'pending' });
  assert.deepEqual(pending.orders.map((order) => order.order_no), ['SWCVS']);
  assert.equal(pending.filters.logistics_status, 'pending');
  assert.equal(pending.total, 1);

  const unpaid = await repository.listOrders(11, { site_id: 101, search_field: 'payment_incomplete' });
  assert.deepEqual(unpaid.orders.map((order) => order.order_no), ['SWUNPAID']);
  assert.equal(unpaid.filters.search_field, 'payment_incomplete');
  assert.equal(unpaid.total, 1);
});

test('repository calculates order profit statistics with optional date range', async () => {
  const pool = orderOperationsPool();
  pool.state.orders[0].shipping_fee_amount = 0;
  pool.state.orders[0].grand_total_amount = 3000;
  pool.state.orders[0].created_at_display = '2026-06-02 10:00:00';
  pool.state.orders[1].shipping_fee_amount = 80;
  pool.state.orders[1].grand_total_amount = 2000;
  pool.state.orders[1].created_at = new Date('2026-06-03T10:00:00Z');
  pool.state.orders[1].created_at_display = '2026-06-03 10:00:00';
  pool.state.orders.push({
    ...pool.state.orders[0],
    id: 4,
    order_no: 'SWOUTSIDE',
    grand_total_amount: 2500,
    shipping_fee_amount: 100,
    created_at_display: '2026-05-01 10:00:00'
  });
  pool.state.orderItems.push({ id: 4, order_id: 4, product_id: 1, quantity: 2 });
  const repository = new WeblessAccountRepository(pool, {
    laravelAppKey: 'base64:' + Buffer.from('12345678901234567890123456789012').toString('base64')
  });

  const ranged = await repository.calculateOrderProfitStatistics(11, {
    site_id: 101,
    date_from: '2026-06-01',
    date_to: '2026-06-30'
  });
  assert.equal(ranged.profit.total_amount, 1880);
  assert.equal(ranged.profit.calculated_order_count, 1);
  assert.equal(ranged.profit.skipped_order_count, 1);
  assert.equal(ranged.profit.gross_order_total, 3000);
  assert.equal(ranged.profit.product_cost_total, 1000);
  assert.equal(ranged.profit.free_shipping_cost_total, 120);

  const all = await repository.calculateOrderProfitStatistics(11, { site_id: 101 });
  assert.equal(all.profit.total_amount, 3380);
  assert.equal(all.profit.calculated_order_count, 2);
});

test('repository returns too many orders instead of listing more than twenty matches', async () => {
  const pool = orderOperationsPool();
  for (let index = 0; index < 21; index += 1) {
    pool.state.orders.push({
      ...pool.state.orders[0],
      id: 100 + index,
      order_no: `SWBULK${index}`
    });
  }
  const repository = new WeblessAccountRepository(pool, {
    laravelAppKey: 'base64:' + Buffer.from('12345678901234567890123456789012').toString('base64')
  });

  const result = await repository.listOrders(11, { site_id: 101, logistics_status: 'pending' });
  assert.equal(result.too_many, true);
  assert.equal(result.total, 22);
  assert.deepEqual(result.orders, []);
});

function memberEmailPool() {
  const site = {
    id: 101,
    slug: 'site-1',
    name: '測試網站',
    domain: '',
    site_status: 'active',
    icon_path: 'sites/101/settings/site-logo.png',
    contact_email: 'owner@example.com'
  };

  return {
    async query(sql, params) {
      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        return { rows: [site] };
      }

      if (sql.includes('from members') && sql.includes('where site_id = $1 and id = any')) {
        return {
          rows: [
            { id: 7, site_id: 101, email: 'bobo@example.com', name: '陳bobo', status: 'active' }
          ]
        };
      }

      if (sql.includes('from products p') && sql.includes('where p.site_id = $1 and p.id = any')) {
        return {
          rows: [
            {
              id: 8,
              site_id: 101,
              site_category_id: 23,
              sku: 'AURORA-X1',
              name: 'Aurora X1 NeoCyber 88鍵旗艦智慧電鋼琴',
              summary: '<p>旗艦智慧電鋼琴</p>',
              base_price: 128000,
              sale_price: null,
              stock: 12,
              status: 'active',
              sales_volume: 0,
              created_at: null,
              updated_at: null,
              primary_image_path: 'sites/101/mcp-uploads/committed/aurora.png'
            }
          ]
        };
      }

      if (sql.includes('from site_mail_layouts')) {
        return { rows: [] };
      }

      if (sql.includes('select contact_email from sites where id = $1')) {
        return { rows: [{ contact_email: 'owner@example.com' }] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

function newsletterPool() {
  const site = {
    id: 101,
    slug: 'site-1',
    name: '測試網站',
    domain: '',
    site_status: 'active'
  };
  const members = [
    { id: 7, site_id: 101, email: 'eric-1@example.com', name: 'Eric', status: 'active' },
    { id: 8, site_id: 101, email: 'eric-2@example.com', name: 'Eric', status: 'active' },
    { id: 9, site_id: 101, email: 'judy@example.com', name: 'Judy', status: 'active' },
    { id: 10, site_id: 101, email: 'member-10@example.com', name: '會員 10', status: 'active' }
  ];
  const state = {
    newsletters: [],
    recipients: []
  };

  return {
    state,
    async query(sql, params) {
      if (sql.includes('from sites') && sql.includes('account_id = $1 and id = $2')) {
        return { rows: [site] };
      }

      if (sql.includes('from members') && sql.includes('where site_id = $1 and id = any')) {
        return {
          rows: (params[1] ?? []).map((id) => members.find((member) => member.id === id) ?? ({
            id,
            site_id: 101,
            email: `member-${id}@example.com`,
            name: `會員 ${id}`,
            status: 'active'
          }))
        };
      }

      if (sql.includes('from members') && sql.includes('lower(name) = lower($2)')) {
        const name = String(params[1] ?? '').trim().toLowerCase();
        return {
          rows: members.filter((member) => member.name.toLowerCase() === name)
        };
      }

      if (sql.includes('insert into site_newsletters')) {
        const row = {
          id: state.newsletters.length + 1,
          site_id: params[0],
          title: params[1],
          recipient_scope: params[2],
          html_content: params[3],
          status: params[4],
          scheduled_at: params[5],
          created_at: params[6],
          updated_at: params[7]
        };
        state.newsletters.push(row);
        return { rows: [row] };
      }

      if (sql.includes('insert into site_newsletter_recipients')) {
        state.recipients.push({
          site_newsletter_id: params[0],
          member_id: params[1],
          member_name: params[2],
          member_email: params[3]
        });
        return { rows: [] };
      }

      if (sql.includes('select count(*)::int as total from site_newsletters')) {
        return { rows: [{ total: state.newsletters.length }] };
      }

      if (sql.includes('from site_newsletters') && sql.includes('order by updated_at')) {
        return { rows: [...state.newsletters] };
      }

      if (sql.includes('from site_newsletters') && sql.includes('where site_id = $1 and id = $2')) {
        return { rows: state.newsletters.filter((newsletter) => newsletter.site_id === params[0] && newsletter.id === params[1]) };
      }

      if (sql.includes('from site_newsletter_recipients')) {
        return { rows: state.recipients.filter((recipient) => recipient.site_newsletter_id === params[0]) };
      }

      if (sql.includes('update site_newsletters')) {
        const newsletter = state.newsletters.find((item) => item.site_id === params[4] && item.id === params[5]);
        Object.assign(newsletter, { title: params[0], recipient_scope: params[1], html_content: params[2], scheduled_at: params[3] });
        return { rows: [newsletter] };
      }

      if (sql.includes('delete from site_newsletter_recipients')) {
        state.recipients = state.recipients.filter((recipient) => recipient.site_newsletter_id !== params[0]);
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

test('repository creates newsletter and defaults scheduled time to five minutes later', async () => {
  const pool = newsletterPool();
  const repository = new WeblessAccountRepository(pool, {
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const before = Date.now();

  const result = await repository.createNewsletter(11, {
    site_id: 101,
    recipient_scope: 'all_members',
    title: '六月新品電子報',
    html_content: '<p onclick="alert(1)">新品上市</p><script>alert(1)</script>'
  });

  const after = Date.now();
  assert.equal(result.ok, true);
  assert.equal(result.newsletter.title, '六月新品電子報');
  assert.equal(result.newsletter.recipient_scope, 'all');
  assert.equal(result.newsletter.status, 'pending');
  assert.equal(pool.state.recipients.length, 0);
  assert.doesNotMatch(result.newsletter.html_content, /onclick|script/i);

  const scheduledAt = new Date(result.newsletter.scheduled_at).getTime();
  assert.ok(scheduledAt >= before + 5 * 60 * 1000 - 1000);
  assert.ok(scheduledAt <= after + 5 * 60 * 1000 + 1000);
});

test('repository lists, gets, and updates existing newsletters', async () => {
  const pool = newsletterPool();
  const repository = new WeblessAccountRepository(pool);
  const created = await repository.createNewsletter(11, {
    site_id: 101,
    recipient_scope: 'all_members',
    title: '原標題',
    html_content: '<p>原內容</p>'
  });

  const listed = await repository.listNewsletters(11, { site_id: 101 });
  const read = await repository.getNewsletter(11, { site_id: 101, newsletter_id: created.newsletter.id });
  const updated = await repository.updateNewsletter(11, {
    site_id: 101,
    newsletter_id: created.newsletter.id,
    title: '新標題'
  });

  assert.equal(listed.newsletters.length, 1);
  assert.equal(read.newsletter.title, '原標題');
  assert.equal(updated.newsletter.title, '新標題');
  assert.equal(updated.newsletter.html_content, '<p>原內容</p>');
});

test('repository creates newsletter for selected members only when member ids are provided', async () => {
  const pool = newsletterPool();
  const repository = new WeblessAccountRepository(pool, {
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const scheduledAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const result = await repository.createNewsletter(11, {
    site_id: 101,
    recipient_scope: 'members',
    member_names: ['Eric', 'Judy'],
    member_emails: ['eric@example.test', 'judy@example.test'],
    title: '指定會員通知',
    html_content: '<p>VIP 活動</p>',
    scheduled_at: scheduledAt
  });

  assert.equal(result.newsletter.recipient_scope, 'members');
  assert.deepEqual(result.recipient_summary.member_names, ['Eric', 'Judy']);
  assert.deepEqual(result.recipient_summary.member_emails, ['eric@example.test', 'judy@example.test']);
  assert.deepEqual(pool.state.recipients.map((row) => row.member_name), ['Eric', 'Judy']);
  assert.equal(result.newsletter.scheduled_at, scheduledAt);

  await assert.rejects(
    () => repository.createNewsletter(11, {
      site_id: 101,
      recipient_scope: 'members',
      title: '缺少會員',
      html_content: '<p>內容</p>'
    }),
    /member_names/
  );
});

function posterPool() {
  const site = {
    id: 101,
    slug: 'site-1',
    name: '測試網站',
    domain: '',
    callback_code: 'swcb_test',
    icon_path: 'sites/101/settings/logo.webp',
    site_status: 'active',
    site_admin_id: 501
  };
  const products = [
    { id: 7, site_id: 101, name: 'Aurora 鋼琴', status: 'active', summary: '入門款數位鋼琴', description: '適合初學者與小空間。', primary_image_path: 'sites/101/products/aurora.webp' },
    { id: 8, site_id: 101, name: 'Aurora 鋼琴 Pro', status: 'active', summary: '進階款數位鋼琴', description: '含三踏板與木質琴鍵。', primary_image_path: 'sites/101/products/aurora-pro.webp' },
    { id: 9, site_id: 101, name: 'Judy 香氛', status: 'active', summary: '木質調香氛', description: '<p>前調佛手柑，後調雪松。</p>', primary_image_path: 'sites/101/products/judy.webp' }
  ];

  return {
    async query(sql, params) {
      if (sql.includes('from site_admins a') && sql.includes('inner join sites s')) {
        return {
          rows: [{
            ...site,
            account_id: 11,
            google_email: 'owner@example.com',
            google_sub: 'google-sub-1',
            permissions: ['backend_ai_assistant', 'product_management'],
            first_admin_id: 501
          }]
        };
      }

      if (sql.includes('from products p') && sql.includes('lower(p.name) like lower($2)')) {
        const keyword = String(params[1] ?? '').replaceAll('%', '').toLowerCase();
        return {
          rows: products.filter((product) => product.name.toLowerCase().includes(keyword))
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

test('repository stops poster creation when product fuzzy search is ambiguous', async () => {
  const repository = new WeblessAccountRepository(posterPool(), {
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const result = await repository.createPoster({
    email: 'owner@example.com',
    google_id: 'google-sub-1'
  }, {
    site_id: 101,
    product_names: ['Aurora'],
    drawing_prompt: '母親節促銷7折優惠'
  });

  assert.equal(result.requiresProductSelection, true);
  assert.equal(result.productName, 'Aurora');
  assert.deepEqual(result.matches.map((product) => product.name), ['Aurora 鋼琴', 'Aurora 鋼琴 Pro']);
});

test('repository creates poster through Webless backend when products resolve uniquely', async () => {
  const requests = [];
  const logs = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });

    if (String(url) === 'https://webless.test/sites/site-1/mcp-posters') {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['x-slimweb-mcp-secret'], 'secret-for-tests');
      assert.ok(options.signal instanceof AbortSignal);
      assert.ok(options.dispatcher);

      const body = JSON.parse(options.body);
      assert.equal(body.site_admin_id, 501);
      assert.equal(body.aspect_ratio, '1:1');
      assert.equal(body.products[0].name, 'Judy 香氛');
      assert.equal(body.products[0].summary, '木質調香氛');
      assert.equal(body.products[0].description, '前調佛手柑，後調雪松。');
      assert.equal(body.products[0].primary_image_url, 'https://slimweb.tw/media/sites/101/products/judy.webp');

      return new Response(JSON.stringify({
        ok: true,
        queued: true,
        job_id: 'poster-job-1',
        status: 'queued',
        status_url: 'https://webless.test/sites/site-1/mcp-posters/poster-job-1'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    assert.equal(String(url), 'https://webless.test/sites/site-1/mcp-posters/poster-job-1');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers['x-slimweb-mcp-secret'], 'secret-for-tests');
    assert.ok(options.signal instanceof AbortSignal);
    assert.ok(options.dispatcher);

    return new Response(JSON.stringify({
      ok: true,
      queued: false,
      job_id: 'poster-job-1',
      status: 'completed',
      image_url: 'https://tmp.example.test/poster.webp',
      aspect_ratio: '1:1',
      usage: { monthlyUsedUsd: 0.01 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const repository = new WeblessAccountRepository(posterPool(), {
    fetchImpl,
    logger: {
      info(message, context) {
        logs.push({ level: 'info', message, context });
      },
      error(message, context) {
        logs.push({ level: 'error', message, context });
      }
    },
    publicSiteBaseUrl: 'https://slimweb.tw',
    weblessAppBaseUrl: 'https://webless.test',
    weblessMcpSecret: 'secret-for-tests',
    posterPollIntervalMs: 0
  });

  const result = await repository.createPoster({
    email: 'owner@example.com',
    google_id: 'google-sub-1'
  }, {
    site_id: 101,
    product_names: ['Judy'],
    aspect_ratio: '1:1',
    drawing_prompt: '母親節促銷7折優惠'
  });

  assert.equal(result.ok, true);
  assert.equal(result.image_url, 'https://tmp.example.test/poster.webp');
  assert.equal(result.products[0].primary_image_url, 'https://slimweb.tw/media/sites/101/products/judy.webp');
  assert.equal(result.products[0].summary, '木質調香氛');
  assert.equal(result.products[0].description, '前調佛手柑，後調雪松。');
  assert.equal(requests.length, 2);
  assert.deepEqual(logs.map((log) => log.message), [
    'Webless poster request started',
    'Webless poster request finished',
    'Webless poster job polling started',
    'Webless poster job poll received'
  ]);
  assert.equal(logs[0].context.url, 'https://webless.test/sites/site-1/mcp-posters');
  assert.equal(logs[0].context.site_id, 101);
  assert.equal(logs[0].context.site_slug, 'site-1');
  assert.equal(logs[0].context.aspect_ratio, '1:1');
  assert.equal(logs[0].context.product_count, 1);
  assert.equal(typeof logs[1].context.duration_ms, 'number');
});

test('repository surfaces failed async poster status details', async () => {
  const fetchImpl = async (url) => {
    if (String(url) === 'https://webless.test/sites/site-1/mcp-posters') {
      return new Response(JSON.stringify({
        ok: true,
        queued: true,
        job_id: 'poster-job-2',
        status: 'queued',
        status_url: 'https://webless.test/sites/site-1/mcp-posters/poster-job-2'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      ok: false,
      queued: false,
      job_id: 'poster-job-2',
      status: 'failed',
      message: 'OpenAI image request failed: upstream 500'
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const repository = new WeblessAccountRepository(posterPool(), {
    fetchImpl,
    publicSiteBaseUrl: 'https://slimweb.tw',
    weblessAppBaseUrl: 'https://webless.test',
    weblessMcpSecret: 'secret-for-tests',
    posterPollIntervalMs: 0
  });

  await assert.rejects(
    () => repository.createPoster({
      email: 'owner@example.com',
      google_id: 'google-sub-1'
    }, {
      site_id: 101,
      product_names: ['Judy'],
      aspect_ratio: '16:9',
      drawing_prompt: '中秋節促銷8折優惠'
    }),
    /OpenAI image request failed: upstream 500/
  );
});

test('repository logs Webless poster request failures with outbound URL and duration', async () => {
  const logs = [];
  const fetchImpl = async () => {
    const error = new Error('upstream request timeout');
    error.name = 'AbortError';
    throw error;
  };
  const repository = new WeblessAccountRepository(posterPool(), {
    fetchImpl,
    logger: {
      info(message, context) {
        logs.push({ level: 'info', message, context });
      },
      error(message, context) {
        logs.push({ level: 'error', message, context });
      }
    },
    publicSiteBaseUrl: 'https://slimweb.tw',
    weblessAppBaseUrl: 'https://webless.test',
    weblessMcpSecret: 'secret-for-tests'
  });

  await assert.rejects(
    () => repository.createPoster({
      email: 'owner@example.com',
      google_id: 'google-sub-1'
    }, {
      site_id: 101,
      product_names: ['Judy'],
      aspect_ratio: '16:9',
      drawing_prompt: '中秋節促銷8折優惠'
    }),
    /upstream request timeout/
  );

  assert.deepEqual(logs.map((log) => log.message), [
    'Webless poster request started',
    'Webless poster request failed'
  ]);
  assert.equal(logs[1].level, 'error');
  assert.equal(logs[1].context.url, 'https://webless.test/sites/site-1/mcp-posters');
  assert.equal(logs[1].context.site_id, 101);
  assert.equal(logs[1].context.site_slug, 'site-1');
  assert.equal(logs[1].context.aspect_ratio, '16:9');
  assert.equal(logs[1].context.product_count, 1);
  assert.equal(logs[1].context.error_name, 'AbortError');
  assert.equal(logs[1].context.error_message, 'upstream request timeout');
  assert.equal(typeof logs[1].context.duration_ms, 'number');
});

test('repository returns candidate emails when a newsletter recipient name is ambiguous', async () => {
  const pool = newsletterPool();
  const repository = new WeblessAccountRepository(pool, {
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const result = await repository.createNewsletter(11, {
    site_id: 101,
    recipient_scope: 'members',
    member_names: ['Eric'],
    title: '歧義名單',
    html_content: '<p>內容</p>'
  });

  assert.equal(result.requiresRecipientSelection, true);
  assert.deepEqual(result.candidateEmails, ['eric-1@example.com', 'eric-2@example.com']);
  assert.equal(pool.state.newsletters.length, 0);
  assert.equal(pool.state.recipients.length, 0);
});

test('repository previews member email with sanitized html and signed draft token', async () => {
  const repository = new WeblessAccountRepository(memberEmailPool(), {
    weblessMcpSecret: 'secret-for-tests',
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const preview = await repository.previewMemberEmail(11, {
    site_id: 101,
    recipient_scope: 'members',
    member_ids: [7],
    product_ids: [8],
    subject: '到貨通知',
    html_content: '<p onclick="alert(1)">到貨了</p><script>alert(1)</script><iframe src="https://evil.test"></iframe>'
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.recipient_summary.scope, 'members');
  assert.equal(preview.recipient_summary.count, 1);
  assert.equal(preview.products[0].id, 8);
  assert.match(preview.preview_html, /到貨了/);
  assert.match(preview.preview_html, /https:\/\/slimweb\.tw\/media\/sites\/101\/settings\/site-logo\.png/);
  assert.match(preview.preview_html, /Aurora X1 NeoCyber 88鍵旗艦智慧電鋼琴/);
  assert.match(preview.preview_html, /https:\/\/slimweb\.tw\/media\/sites\/101\/mcp-uploads\/committed\/aurora\.png/);
  assert.match(preview.preview_html, /開啟商品/);
  assert.match(preview.preview_html, /旗艦智慧電鋼琴/);
  assert.doesNotMatch(preview.preview_html, /&lt;p&gt;|&lt;\/p&gt;/);
  assert.doesNotMatch(preview.preview_html, /onclick|script|iframe/i);
  assert.equal(typeof preview.email_draft_token, 'string');
  assert.equal(typeof preview.confirmation_token, 'string');
});

test('repository previews member email with singular member and product id aliases', async () => {
  const repository = new WeblessAccountRepository(memberEmailPool(), {
    weblessMcpSecret: 'secret-for-tests',
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const preview = await repository.previewMemberEmail(11, {
    site_id: 101,
    recipient_scope: 'members',
    member_id: 7,
    product_id: 8,
    subject: '到貨通知',
    html_content: '<p>到貨了</p>'
  });

  assert.equal(preview.recipient_summary.count, 1);
  assert.deepEqual(preview.recipient_summary.members.map((member) => member.id), [7]);
  assert.deepEqual(preview.products.map((product) => product.id), [8]);
});

test('repository previews member email with scalar member_ids and product_ids values', async () => {
  const repository = new WeblessAccountRepository(memberEmailPool(), {
    weblessMcpSecret: 'secret-for-tests',
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const preview = await repository.previewMemberEmail(11, {
    site_id: 101,
    recipient_scope: 'members',
    member_ids: 7,
    product_ids: 8,
    subject: '到貨通知',
    html_content: '<p>到貨了</p>'
  });

  assert.deepEqual(preview.recipient_summary.members.map((member) => member.id), [7]);
  assert.deepEqual(preview.products.map((product) => product.id), [8]);
});

test('repository previews member email with model-shaped id values', async () => {
  const repository = new WeblessAccountRepository(memberEmailPool(), {
    weblessMcpSecret: 'secret-for-tests',
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const preview = await repository.previewMemberEmail(11, {
    site_id: 101,
    recipient_scope: 'members',
    member_ids: '[7]',
    product_ids: [{ id: 8 }],
    subject: '到貨通知',
    html_content: '<p>到貨了</p>'
  });

  assert.deepEqual(preview.recipient_summary.members.map((member) => member.id), [7]);
  assert.deepEqual(preview.products.map((product) => product.id), [8]);
});

test('repository sends only a confirmed member email draft through Webless', async () => {
  const calls = [];
  const repository = new WeblessAccountRepository(memberEmailPool(), {
    weblessMcpSecret: 'secret-for-tests',
    publicSiteBaseUrl: 'https://slimweb.tw',
    weblessAppBaseUrl: 'https://app.slimweb.tw',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            delivery_mode: 'queue',
            queued: true,
            recipient_count: 42,
            bcc_email: 'owner@example.com'
          };
        }
      };
    }
  });

  const preview = await repository.previewMemberEmail(11, {
    site_id: 101,
    recipient_scope: 'all_members',
    product_ids: [8],
    subject: '母親節特惠',
    html_content: '<p>Aurora 特價中</p>'
  });
  const sent = await repository.sendMemberEmail(11, {
    site_id: 101,
    email_draft_token: preview.email_draft_token,
    confirmation_token: preview.confirmation_token
  });

  assert.equal(sent.ok, true);
  assert.equal(sent.delivery_mode, 'queue');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://app.slimweb.tw/sites/site-1/mcp-member-emails/send');
  assert.equal(calls[0].options.headers['x-slimweb-mcp-secret'], 'secret-for-tests');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.recipient_scope, 'all_members');
  assert.equal(body.subject, '母親節特惠');
  assert.equal(body.bcc_contact_email, 'owner@example.com');
  assert.deepEqual(body.product_ids, [8]);
});
