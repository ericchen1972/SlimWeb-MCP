import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

function testAdminSitesFor(profile, permissions = ['backend_ai_assistant', 'system_admin']) {
  return [{
    site_admin_id: 10,
    site_id: 101,
    id: 101,
    slug: 'site-1',
    name: '測試網站',
    domain: '',
    permissions,
    site_status: 'active',
    site_status_label: '正常運作',
    google_email: profile.email,
    google_sub: profile.sub
  }];
}

const README_TOOL_TABLE_NAMES = [
  ...readFileSync(new URL('../README.md', import.meta.url), 'utf8').matchAll(
    /^\|\s*`(slimweb_[a-z0-9_]+)`\s*\|\s*([^|]+?)\s*\|/gm
  )
].map((match) => ({ name: match[1], status: match[2].trim() }));

const PLANNED_TOOL_NAMES = [
  'slimweb_members_list',
  'slimweb_members_get',
  'slimweb_discount_codes_list',
  'slimweb_discount_codes_upsert',
  'slimweb_member_tiers_list',
  'slimweb_member_tiers_upsert',
  'slimweb_threshold_gifts_list',
  'slimweb_threshold_gifts_upsert',
  'slimweb_product_add_ons_list',
  'slimweb_product_add_ons_upsert',
  'slimweb_faqs_list',
  'slimweb_faqs_upsert',
  'slimweb_customer_service_logs_list',
  'slimweb_customer_service_settings_get',
  'slimweb_customer_service_settings_update',
  'slimweb_exports_create',
  'slimweb_audit_list'
];

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

test('MCP tools list includes output schemas for structured content', async () => {
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

    assert.equal(response.status, 200);
    assert.equal(body.id, 22);
    assert.ok(Array.isArray(body.result.tools));

    for (const tool of body.result.tools) {
      assert.equal(typeof tool.outputSchema, 'object');
      assert.equal(tool.outputSchema.type, 'object');
      assert.equal(typeof tool.outputSchema.properties, 'object');
    }
  });
});

test('README main tool table lists every discoverable tool as available', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 25,
        method: 'tools/list'
      })
    });

    const body = await response.json();
    const readmeRowsByName = new Map(README_TOOL_TABLE_NAMES.map((row) => [row.name, row]));

    assert.equal(response.status, 200);

    for (const tool of body.result.tools) {
      assert.ok(readmeRowsByName.has(tool.name), `${tool.name} should be listed in README tool table`);
      assert.equal(readmeRowsByName.get(tool.name).status, 'Available', `${tool.name} should be marked Available in README`);
    }

    for (const toolName of PLANNED_TOOL_NAMES) {
      assert.equal(readmeRowsByName.get(toolName)?.status, 'Available', `${toolName} should no longer be Planned`);
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
      'slimweb_site_select',
      'slimweb_themes_list',
      'slimweb_theme_shell_get_context',
      'slimweb_themes_create_from_default',
      'slimweb_themes_delete',
      'slimweb_themes_update_root_elements',
      'slimweb_theme_style_profile_get',
      'slimweb_theme_style_profile_upsert',
      'slimweb_theme_style_profile_append_request',
      'slimweb_site_readiness_get',
      'slimweb_seo_settings_get',
      'slimweb_seo_settings_update',
      'slimweb_integration_settings_get',
      'slimweb_integration_settings_update',
      'slimweb_payment_logistics_get',
      'slimweb_payment_logistics_update',
      'slimweb_orders_list',
      'slimweb_orders_profit_statistics',
      'slimweb_orders_get',
      'slimweb_orders_create_logistics',
      'slimweb_orders_mark_shipped',
      'slimweb_returns_pending_list',
      'slimweb_returns_create_logistics',
      'slimweb_returns_cancel',
      'slimweb_returns_complete',
      'slimweb_refunds_complete',
      'slimweb_refunds_create',
      'slimweb_dashboard_summary',
      'slimweb_settings_get',
      'slimweb_settings_update',
      'slimweb_admins_list',
      'slimweb_admins_upsert',
      'slimweb_admins_delete',
      'slimweb_external_assets_list',
      'slimweb_external_assets_upsert',
      'slimweb_external_assets_delete',
      'slimweb_external_assets_reorder',
      'slimweb_images_import_chatgpt_attachment',
      'slimweb_uploads_create',
      'slimweb_uploads_commit',
      'slimweb_articles_list',
      'slimweb_articles_upsert',
      'slimweb_categories_list',
      'slimweb_categories_upsert',
      'slimweb_categories_delete',
      'slimweb_nav_items_list',
      'slimweb_nav_items_upsert',
      'slimweb_nav_items_delete',
      'slimweb_products_list',
      'slimweb_products_get',
      'slimweb_products_upsert',
	      'slimweb_products_delete',
	      'slimweb_products_import_inspect',
	      'slimweb_products_import_validate',
	      'slimweb_products_import_commit',
	      'slimweb_coupon_templates_list',
	      'slimweb_coupon_templates_upsert',
	      'slimweb_members_coupons_issue',
	      'slimweb_members_list',
	      'slimweb_members_get',
	      'slimweb_discount_codes_list',
	      'slimweb_discount_codes_upsert',
	      'slimweb_member_tiers_list',
	      'slimweb_member_tiers_upsert',
	      'slimweb_threshold_gifts_list',
	      'slimweb_threshold_gifts_upsert',
	      'slimweb_product_add_ons_list',
	      'slimweb_product_add_ons_upsert',
	      'slimweb_faqs_list',
	      'slimweb_faqs_upsert',
	      'slimweb_customer_service_logs_list',
	      'slimweb_customer_service_settings_get',
	      'slimweb_customer_service_settings_update',
	      'slimweb_exports_create',
	      'slimweb_audit_list',
	      'slimweb_assets_upload',
      'slimweb_pages_get_home_content',
      'slimweb_pages_update_home_content',
      'slimweb_pages_upsert',
      'slimweb_pages_delete',
      'slimweb_preview_get_page_url'
    ]) {
      assert.ok(toolsByName.has(toolName), `${toolName} should be discoverable`);
    }

    assert.equal(toolsByName.get('slimweb_themes_create_from_default').inputSchema.required.includes('name'), true);
    assert.equal(toolsByName.get('slimweb_theme_shell_get_context').inputSchema.required.includes('theme_id'), true);
    assert.equal(toolsByName.get('slimweb_themes_update_root_elements').inputSchema.required.includes('theme_id'), true);
    assert.equal(toolsByName.get('slimweb_theme_style_profile_upsert').inputSchema.required.includes('theme_id'), true);
    assert.equal(toolsByName.get('slimweb_assets_upload').inputSchema.required.includes('source'), true);
    assert.equal(toolsByName.get('slimweb_assets_upload').inputSchema.properties.source.properties.attachment_ref, undefined);
    assert.equal(toolsByName.get('slimweb_assets_upload').inputSchema.properties.source.properties.data_ref, undefined);
    assert.equal(toolsByName.get('slimweb_assets_upload').inputSchema.properties.source.additionalProperties, false);
    assert.equal(toolsByName.get('slimweb_assets_upload').inputSchema.properties.source.properties.data_base64, undefined);
    assert.equal(toolsByName.get('slimweb_assets_upload').inputSchema.properties.source.properties.media_path.type, 'string');
    assert.equal(toolsByName.get('slimweb_assets_upload').inputSchema.properties.source.properties.image_url, undefined);
    assert.equal(toolsByName.get('slimweb_assets_upload').inputSchema.properties.source.properties.file_url, undefined);
    assert.equal(toolsByName.get('slimweb_assets_upload').inputSchema.properties.source.properties.image, undefined);
    assert.equal(toolsByName.get('slimweb_products_upsert').inputSchema.properties.primary_images.items.anyOf[0].properties.source.additionalProperties, false);
    assert.equal(toolsByName.get('slimweb_products_upsert').inputSchema.properties.primary_images.items.anyOf[0].properties.source.properties.attachment_ref, undefined);
    assert.equal(toolsByName.get('slimweb_products_upsert').inputSchema.properties.primary_images.items.anyOf.length, 1);
    assert.equal(toolsByName.get('slimweb_products_upsert').inputSchema.properties.primary_images.items.anyOf[0].properties.source.properties.image_url, undefined);
    assert.equal(toolsByName.get('slimweb_products_upsert').inputSchema.properties.primary_images.items.anyOf[0].properties.source.properties.file_url, undefined);
    assert.equal(toolsByName.get('slimweb_products_upsert').inputSchema.properties.primary_images.items.anyOf[0].properties.source.properties.image, undefined);
    assert.equal(toolsByName.get('slimweb_products_upsert').inputSchema.properties.primary_images.items.anyOf[0].properties.source.properties.data_base64, undefined);
    assert.equal(toolsByName.get('slimweb_products_upsert').inputSchema.properties.primary_images.items.anyOf[0].properties.source.properties.media_path.type, 'string');
    assert.deepEqual(toolsByName.get('slimweb_products_upsert').inputSchema.properties.primary_images_mode.enum, ['append', 'replace']);
    assert.match(toolsByName.get('slimweb_products_upsert').inputSchema.properties.primary_images_mode.description, /Defaults to append when updating/);
    assert.deepEqual(toolsByName.get('slimweb_products_upsert').inputSchema.properties.content_images_mode.enum, ['append', 'replace']);
    assert.match(toolsByName.get('slimweb_products_upsert').inputSchema.properties.primary_images.description, /runtime/);
    assert.match(toolsByName.get('slimweb_products_upsert').inputSchema.properties.primary_images.description, /ChatGPT Remote MCP/);
    assert.equal(toolsByName.get('slimweb_orders_pending_list'), undefined);
    assert.ok(toolsByName.get('slimweb_orders_list').inputSchema.properties.search_field.enum.includes('buyer_name'));
    assert.ok(toolsByName.get('slimweb_orders_list').inputSchema.properties.search_field.enum.includes('payment_incomplete'));
    assert.match(toolsByName.get('slimweb_orders_list').inputSchema.properties.logistics_status.description, /payment is completed/);
    assert.equal(toolsByName.get('slimweb_orders_profit_statistics').inputSchema.properties.date_from.description.includes('optional'), true);
    assert.match(toolsByName.get('slimweb_articles_upsert').description, /draft the article and cover-image concept first/);
    assert.match(toolsByName.get('slimweb_articles_upsert').description, /ask the user to paste or re-upload the selected image/);
    assert.match(toolsByName.get('slimweb_articles_upsert').inputSchema.properties.cover_image.description, /16:9/);
    assert.match(toolsByName.get('slimweb_articles_upsert').inputSchema.properties.cover_image.description, /slimweb_images_import_chatgpt_attachment/);
    assert.deepEqual(toolsByName.get('slimweb_images_import_chatgpt_attachment')._meta['openai/fileParams'], ['image']);
    assert.equal(toolsByName.get('slimweb_images_import_chatgpt_attachment').inputSchema.required.includes('image'), true);
    assert.match(toolsByName.get('slimweb_images_import_chatgpt_attachment').description, /ChatGPT web\/desktop/);
    assert.match(toolsByName.get('slimweb_uploads_create').description, /PUT the raw image bytes/);
    assert.match(toolsByName.get('slimweb_uploads_create').description, /Codex or Hermes/);
    assert.equal(toolsByName.get('slimweb_admins_delete').inputSchema.required.includes('admin_id'), true);
    assert.equal(toolsByName.get('slimweb_admins_upsert').inputSchema.required.includes('google_email'), true);
    assert.equal(toolsByName.get('slimweb_admins_upsert').inputSchema.properties.password, undefined);
    assert.match(toolsByName.get('slimweb_payment_logistics_get').description, /supported/);
    assert.equal(toolsByName.get('slimweb_payment_logistics_update').inputSchema.properties.payments.items.properties.provider.enum.includes('linepay'), true);
    assert.equal(toolsByName.get('slimweb_payment_logistics_update').inputSchema.properties.payments.items.properties.language.enum.includes('ko'), true);
    assert.equal(toolsByName.get('slimweb_payment_logistics_update').inputSchema.properties.payments.items.properties.language.enum.includes('th'), true);
    assert.equal(toolsByName.get('slimweb_payment_logistics_update').inputSchema.properties.logistics.items.properties.hash_key, undefined);
    assert.equal(toolsByName.get('slimweb_payment_logistics_update').inputSchema.properties.logistics.items.properties.store_types.items.enum.includes('ok'), true);
    assert.equal(toolsByName.get('slimweb_external_assets_upsert').inputSchema.required.includes('url'), true);
    assert.equal(toolsByName.has('slimweb_debug_attachment_refs'), false);
    assert.match(toolsByName.get('slimweb_products_upsert').description, /ask the user to choose an existing leaf category/);
    assert.match(toolsByName.get('slimweb_categories_upsert').description, /icon_svg_base64/);
    assert.equal(toolsByName.get('slimweb_pages_update_home_content').inputSchema.required.includes('content'), true);
    assert.equal(toolsByName.get('slimweb_preview_get_page_url').inputSchema.required.includes('page_key'), true);
    assert.equal(toolsByName.get('slimweb_categories_upsert').inputSchema.properties.icon_svg_base64.type, 'string');
    assert.match(toolsByName.get('slimweb_categories_upsert').inputSchema.properties.parent_id.description, /omit or pass null/);
    assert.equal(toolsByName.get('slimweb_nav_items_upsert').inputSchema.properties.icon_svg_base64.type, 'string');
    assert.match(toolsByName.get('slimweb_nav_items_upsert').inputSchema.properties.parent_id.description, /omit or pass null/);
  });
});

test('homepage editing tools call repository implementations', async () => {
  const calls = [];
  const actorPermissions = [
    'backend_ai_assistant',
    'system_admin',
    'basic_settings',
    'seo_settings',
    'integration_settings',
    'payment_logistics',
    'page_management',
    'page_management_navbar',
    'page_management_templates',
    'page_management_pages',
    'page_management_external_assets',
    'product_management',
    'product_management_categories',
    'product_management_products',
    'product_management_import',
    'member_management',
    'member_list',
    'discount_management',
    'coupon_templates',
    'article_management',
    'article_list'
  ];
  const repository = {
    listAdminSitesForGoogleProfile: async (profile) => {
      assert.equal(profile.email, 'owner@example.com');
      return [{
        site_admin_id: 13,
        site_id: 101,
        slug: 'site-1',
        name: '測試網站',
        permissions: actorPermissions
      }];
    },
    listSitesForAdminIdentity: async (identity) => {
      assert.equal(identity.email, 'owner@example.com');
      return [{
        site_admin_id: 13,
        site_id: 101,
        slug: 'site-1',
        name: '測試網站',
        permissions: actorPermissions
      }];
    },
    upsertGoogleAccount: async () => ({
      id: 99,
      email: 'owner@example.com',
      name: 'Owner',
      google_id: 'google-sub-planned'
    }),
    listSitesForAccount: async () => [],
    selectSiteForAdminIdentity: async (accountId, args) => {
      calls.push(['select', accountId, args]);
      return { selected_site: { id: args.site_id, slug: 'site-1' } };
    },
    listThemesForAccountSite: async (accountId, args) => {
      calls.push(['themes_list', accountId, args]);
      return { themes: [{ id: 1, name: 'Default' }] };
    },
    createThemeFromDefault: async (accountId, args) => {
      calls.push(['themes_create', accountId, args]);
      return { theme: { id: 22, name: args.name }, copied_from_default: true, content_fallback: 'default' };
    },
    deleteTheme: async (accountId, args) => {
      calls.push(['themes_delete', accountId, args]);
      return { ok: true, deleted_theme_id: args.theme_id };
    },
    getThemeShellContext: async (accountId, args) => {
      calls.push(['shell_context', accountId, args]);
      return { reference_only: true, navbar: { counts: { total_items: 2 } } };
    },
    updateThemeRootElements: async (accountId, args) => {
      calls.push(['themes_root', accountId, args]);
      return { ok: true, theme: { id: args.theme_id }, updated_fragments: Object.keys(args.fragments ?? {}) };
    },
    getThemeStyleProfile: async (accountId, args) => {
      calls.push(['profile_get', accountId, args]);
      return { profile: { summary: '童趣' } };
    },
    upsertThemeStyleProfile: async (accountId, args) => {
      calls.push(['profile_upsert', accountId, args]);
      return { ok: true, profile: { summary: args.summary } };
    },
    appendThemeStyleProfileRequest: async (accountId, args) => {
      calls.push(['profile_append', accountId, args]);
      return { ok: true, profile: { user_requests: [{ request: args.request }] } };
    },
    getSeoSettings: async (accountId, args) => {
      calls.push(['seo_get', accountId, args]);
      return { site: { id: args.site_id }, settings: { seo_title: '質感女裝' } };
    },
    updateSeoSettings: async (accountId, args) => {
      calls.push(['seo_update', accountId, args]);
      return { ok: true, site: { id: args.site_id }, settings: { seo_title: args.seo_title, aeo_business_summary: args.aeo_business_summary, geo_verifiable_claims: args.geo_verifiable_claims } };
    },
    getIntegrationSettings: async (accountId, args) => {
      calls.push(['integration_get', accountId, args]);
      return { site: { id: args.site_id }, settings: { ai_provider: 'openai_gpt' } };
    },
    updateIntegrationSettings: async (accountId, args) => {
      calls.push(['integration_update', accountId, args]);
      return { ok: true, site: { id: args.site_id }, settings: { ai_api_key: args.ai_api_key, notion_token: args.notion_token } };
    },
    getPaymentLogisticsSettings: async (accountId, args) => {
      calls.push(['payment_logistics_get', accountId, args]);
      return {
        supported_payment_providers: [{ provider: 'ecpay', label: '綠界 ECPay' }],
        supported_logistics_providers: [{ provider: 'hct', label: '新竹物流' }],
        payment_providers: [],
        logistics_providers: []
      };
    },
    updatePaymentLogisticsSettings: async (accountId, args) => {
      calls.push(['payment_logistics_update', accountId, args]);
      return { ok: true, payment_providers: args.payments ?? [], logistics_providers: args.logistics ?? [] };
    },
    listOrders: async (accountId, args) => {
      calls.push(['orders_list', accountId, args]);
      return { orders: [{ order_no: 'SW1', available_actions: [] }] };
    },
    calculateOrderProfitStatistics: async (accountId, args) => {
      calls.push(['orders_profit_statistics', accountId, args]);
      return { profit: { total_amount: 1880, calculated_order_count: 1, skipped_order_count: 0 } };
    },
    getOrder: async (accountId, args) => {
      calls.push(['orders_get', accountId, args]);
      return { order: { order_no: args.order_no ?? 'SW1', available_actions: [] } };
    },
    createOrderLogistics: async (accountId, args) => {
      calls.push(['orders_create_logistics', accountId, args]);
      return { order: { order_no: args.order_no ?? 'SW1', logistics_status: 'created' } };
    },
    markOrderShipped: async (accountId, args) => {
      calls.push(['orders_mark_shipped', accountId, args]);
      return { order: { order_no: args.order_no ?? 'SW1', logistics_status: 'completed' } };
    },
    listPendingReturns: async (accountId, args) => {
      calls.push(['returns_pending_list', accountId, args]);
      return { orders: [{ order_no: 'SWR', available_actions: [] }] };
    },
    createReturnLogistics: async (accountId, args) => {
      calls.push(['returns_create_logistics', accountId, args]);
      return { order: { order_no: args.order_no ?? 'SWR', return_logistics_status: 'created' } };
    },
    cancelReturn: async (accountId, args) => {
      calls.push(['returns_cancel', accountId, args]);
      return { order: { order_no: args.order_no ?? 'SWR', return_status: 'cancelled' } };
    },
    completeReturn: async (accountId, args) => {
      calls.push(['returns_complete', accountId, args]);
      return { order: { order_no: args.order_no ?? 'SWR', return_status: 'completed' } };
    },
    completeRefund: async (accountId, args) => {
      calls.push(['refunds_complete', accountId, args]);
      return { order: { order_no: args.order_no ?? 'SWR', refund_status: 'completed' } };
    },
    createRefund: async (accountId, args) => {
      calls.push(['refunds_create', accountId, args]);
      return { order: { order_no: args.order_no ?? 'SWR', refund_status: 'created' } };
    },
    getDashboardSummary: async (accountId, args) => {
      calls.push(['dashboard_summary', accountId, args]);
      return { stats: { totalProducts: 1 }, recentOrders: [], recentMembers: [], lowStockProducts: [] };
    },
    getBasicSettings: async (accountId, args) => {
      calls.push(['settings_get', accountId, args]);
      return { site: { id: args.site_id }, settings: { site_status: 'active' } };
    },
    getSiteReadiness: async (accountId, args) => {
      calls.push(['site_readiness_get', accountId, args]);
      return { summary: { status: 'needs_setup' }, missing_categories: [{ key: 'payment_logistics' }] };
    },
    updateBasicSettings: async (accountId, args) => {
      calls.push(['settings_update', accountId, args]);
      return { ok: true, site: { id: args.site_id }, settings: { site_status: args.site_status } };
    },
    listAdmins: async (accountId, args) => {
      calls.push(['admins_list', accountId, args]);
      return { admins: [{ id: 1, username: 'admin', isSystemAdmin: true, canDelete: false, permissionKeys: ['system_admin'] }] };
    },
    upsertAdmin: async (accountId, args) => {
      calls.push(['admin_upsert', accountId, args]);
      return { ok: true, admin: { id: args.admin_id ?? 2, google_email: args.google_email, permissionKeys: args.permissions } };
    },
    deleteAdmin: async (accountId, args) => {
      calls.push(['admin_delete', accountId, args]);
      return { ok: true, deleted_admin_id: args.admin_id };
    },
    listExternalAssets: async (accountId, args) => {
      calls.push(['external_assets_list', accountId, args]);
      return { assets: [{ id: 71, scope: 'site', asset_type: 'css', url: 'https://cdn.example.com/site.css' }] };
    },
    upsertExternalAsset: async (accountId, args) => {
      calls.push(['external_asset_upsert', accountId, args]);
      return { ok: true, asset: { id: args.asset_id ?? 72, scope: args.scope, asset_type: args.asset_type, url: args.url } };
    },
    deleteExternalAsset: async (accountId, args) => {
      calls.push(['external_asset_delete', accountId, args]);
      return { ok: true, deleted_asset_id: args.asset_id };
    },
    reorderExternalAssets: async (accountId, args) => {
      calls.push(['external_assets_reorder', accountId, args]);
      return { ok: true, assets: args.asset_ids.map((id, index) => ({ id, sort_order: index })) };
    },
    createUpload: async (accountId, args) => {
      calls.push(['upload_create', accountId, args]);
      return { ok: true, upload_id: 'upload-1', upload_token: 'token-1', upload_url: 'https://slimweb.tw/sites/site-1/mcp-uploads/upload-1?token=token-1', headers: { 'Content-Type': args.mime_type } };
    },
    commitUpload: async (accountId, args) => {
      calls.push(['upload_commit', accountId, args]);
      return { ok: true, asset: { media_path: 'sites/101/mcp-uploads/committed/upload-1.webp', public_url: 'https://slimweb.tw/media/sites/101/mcp-uploads/committed/upload-1.webp' } };
    },
    importChatGptAttachment: async (accountId, args) => {
      calls.push(['chatgpt_attachment_import', accountId, args]);
      return { ok: true, asset: { media_path: 'sites/101/mcp-uploads/committed/chatgpt-upload.webp', public_url: 'https://slimweb.tw/media/sites/101/mcp-uploads/committed/chatgpt-upload.webp' } };
    },
    listArticles: async (accountId, args) => {
      calls.push(['articles_list', accountId, args]);
      return { articles: [{ id: 9, title: '春季穿搭' }], pagination: { page: 1, last_page: 1, total: 1 } };
    },
    upsertArticle: async (accountId, args) => {
      calls.push(['article_upsert', accountId, args]);
      return { ok: true, article: { id: args.article_id ?? 10, title: args.title, content: args.content_html } };
    },
    listCategories: async (accountId, args) => {
      calls.push(['categories_list', accountId, args]);
      return { categories: [{ id: 5, name: '女裝' }] };
    },
    upsertCategory: async (accountId, args) => {
      calls.push(['category_upsert', accountId, args]);
      return { ok: true, category: { id: args.category_id ?? 6, name: args.name, parent_id: args.parent_id ?? null } };
    },
    deleteCategory: async (accountId, args) => {
      calls.push(['category_delete', accountId, args]);
      return { ok: true, deleted_category_ids: [args.category_id] };
    },
    listNavItems: async (accountId, args) => {
      calls.push(['nav_items_list', accountId, args]);
      return { nav_items: [{ id: 11, name: '男裝' }] };
    },
    upsertNavItem: async (accountId, args) => {
      calls.push(['nav_item_upsert', accountId, args]);
      return { ok: true, nav_item: { id: args.nav_item_id ?? 12, name: args.name, parent_id: args.parent_id ?? null } };
    },
    deleteNavItem: async (accountId, args) => {
      calls.push(['nav_item_delete', accountId, args]);
      return { ok: true, deleted_nav_item_ids: [args.nav_item_id] };
    },
    listProducts: async (accountId, args) => {
      calls.push(['products_list', accountId, args]);
      return { products: [{ id: 7, name: '洋裝' }], pagination: { page: 1, last_page: 1, total: 1 } };
    },
    getProduct: async (accountId, args) => {
      calls.push(['product_get', accountId, args]);
      return { product: { id: args.product_id, name: '洋裝' } };
    },
    upsertProduct: async (accountId, args) => {
      calls.push(['product_upsert', accountId, args]);
      return { ok: true, product: { id: args.product_id ?? 7, name: args.name, primary_images: args.primary_images } };
    },
    deleteProduct: async (accountId, args) => {
      calls.push(['product_delete', accountId, args]);
      return { ok: true, deleted_product_id: args.product_id };
    },
    inspectProductImport: async (accountId, args) => {
      calls.push(['product_import_inspect', accountId, args]);
      return { dataset: { total_rows: 2, columns: { 商品名稱: {} } } };
    },
    validateProductImport: async (accountId, args) => {
      calls.push(['product_import_validate', accountId, args]);
      return { convertible: true, mapping: args.mapping };
    },
    commitProductImport: async (accountId, args) => {
      calls.push(['product_import_commit', accountId, args]);
      return { ok: true, result: { created_products: 2 } };
    },
    listCouponTemplates: async (accountId, args) => {
      calls.push(['coupon_templates_list', accountId, args]);
      return { coupon_templates: [{ id: 3, name: '母親節優惠' }], pagination: { page: 1, last_page: 1, total: 1 } };
    },
    upsertCouponTemplate: async (accountId, args) => {
      calls.push(['coupon_template_upsert', accountId, args]);
      return { ok: true, coupon_template: { id: args.coupon_template_id ?? 3, name: args.name, issue_trigger: args.issue_trigger } };
    },
	    issueMemberCoupon: async (accountId, args) => {
	      calls.push(['member_coupon_issue', accountId, args]);
	      return { ok: true, member_coupon: { member_id: args.member_id, coupon_template_id: args.coupon_template_id } };
	    },
	    listMembers: async (accountId, args) => {
	      calls.push(['members_list', accountId, args]);
	      return { members: [{ id: 88, email: 'member@example.com' }], pagination: { page: 1, last_page: 1, total: 1 } };
	    },
	    getMember: async (accountId, args) => {
	      calls.push(['member_get', accountId, args]);
	      return { member: { id: args.member_id, email: 'member@example.com' }, orders: [], coupon_templates: [] };
	    },
	    listDiscountCodes: async (accountId, args) => {
	      calls.push(['discount_codes_list', accountId, args]);
	      return { discount_codes: [{ id: 4, code: 'VIP200' }], pagination: { page: 1, last_page: 1, total: 1 } };
	    },
	    upsertDiscountCode: async (accountId, args) => {
	      calls.push(['discount_code_upsert', accountId, args]);
	      return { ok: true, discount_code: { id: args.discount_code_id ?? 4, code: args.code } };
	    },
	    listMemberTiers: async (accountId, args) => {
	      calls.push(['member_tiers_list', accountId, args]);
	      return { member_tiers: [{ id: 2, name: 'VIP' }] };
	    },
	    upsertMemberTier: async (accountId, args) => {
	      calls.push(['member_tier_upsert', accountId, args]);
	      return { ok: true, member_tier: { id: args.member_tier_id ?? 2, name: args.name } };
	    },
	    listThresholdGifts: async (accountId, args) => {
	      calls.push(['threshold_gifts_list', accountId, args]);
	      return { threshold_gifts: [{ id: 5, name: '滿額禮' }] };
	    },
	    upsertThresholdGift: async (accountId, args) => {
	      calls.push(['threshold_gift_upsert', accountId, args]);
	      return { ok: true, threshold_gift: { id: args.threshold_gift_id ?? 5, name: args.name } };
	    },
	    listProductAddOns: async (accountId, args) => {
	      calls.push(['product_add_ons_list', accountId, args]);
	      return { product_add_ons: [{ id: 6, name: '加購袋' }] };
	    },
	    upsertProductAddOn: async (accountId, args) => {
	      calls.push(['product_add_on_upsert', accountId, args]);
	      return { ok: true, product_add_on: { id: args.product_add_on_id ?? 6, name: args.name } };
	    },
	    listFaqs: async (accountId, args) => {
	      calls.push(['faqs_list', accountId, args]);
	      return { faqs: [{ id: 7, question: '如何退貨？' }] };
	    },
	    upsertFaq: async (accountId, args) => {
	      calls.push(['faq_upsert', accountId, args]);
	      return { ok: true, faq: { id: args.faq_id ?? 7, question: args.question } };
	    },
	    listCustomerServiceLogs: async (accountId, args) => {
	      calls.push(['customer_service_logs_list', accountId, args]);
	      return { logs: [{ id: 8, channel: 'line' }], pagination: { page: 1, last_page: 1, total: 1 } };
	    },
	    getCustomerServiceSettings: async (accountId, args) => {
	      calls.push(['customer_service_settings_get', accountId, args]);
	      return { settings: { use_ai_customer_service: true } };
	    },
	    updateCustomerServiceSettings: async (accountId, args) => {
	      calls.push(['customer_service_settings_update', accountId, args]);
	      return { ok: true, settings: { use_ai_customer_service: args.use_ai_customer_service } };
	    },
	    createExport: async (accountId, args) => {
	      calls.push(['export_create', accountId, args]);
	      return { ok: true, export: { type: args.export_type, rows: [] } };
	    },
	    listAuditLogs: async (accountId, args) => {
	      calls.push(['audit_list', accountId, args]);
	      return { audit_logs: [{ id: 9, tool_name: 'slimweb_sites_list' }] };
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
    upsertPage: async (accountId, args) => {
      calls.push(['page_upsert', accountId, args]);
      return { ok: true, page_key: args.page_key, title: args.title, storage_path: `sites/101/templates/default/pages/${args.page_key}/content.blade.php` };
    },
    deletePage: async (accountId, args) => {
      calls.push(['page_delete', accountId, args]);
      return { ok: true, deleted_page_key: args.page_key };
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

    assert.equal((await callTool(23, 'slimweb_site_select', { site_id: 101 })).result.structuredContent.selected_site.slug, 'site-1');
    assert.equal((await callTool(24, 'slimweb_themes_list', { site_id: 101 })).result.structuredContent.themes.length, 1);
    assert.equal((await callTool(25, 'slimweb_themes_create_from_default', { site_id: 101, name: '可愛版型' })).result.structuredContent.theme.id, 22);
    assert.equal((await callTool(26, 'slimweb_theme_shell_get_context', { site_id: 101, theme_id: 22 })).result.structuredContent.reference_only, true);
    assert.equal((await callTool(27, 'slimweb_theme_style_profile_get', { site_id: 101, theme_id: 22 })).result.structuredContent.profile.summary, '童趣');
    assert.equal((await callTool(28, 'slimweb_theme_style_profile_upsert', { site_id: 101, theme_id: 22, summary: '童趣' })).result.structuredContent.ok, true);
    assert.equal((await callTool(29, 'slimweb_theme_style_profile_append_request', { site_id: 101, theme_id: 22, request: '加手繪星星' })).result.structuredContent.ok, true);
    assert.equal((await callTool(30, 'slimweb_site_readiness_get', { site_id: 101 })).result.structuredContent.missing_categories[0].key, 'payment_logistics');
    assert.equal((await callTool(31, 'slimweb_seo_settings_get', { site_id: 101 })).result.structuredContent.settings.seo_title, '質感女裝');
    assert.equal((await callTool(31, 'slimweb_seo_settings_update', {
      site_id: 101,
      seo_title: '質感女裝、上班穿搭推薦',
      aeo_business_summary: '服飾電商，提供上班與日常穿搭',
      geo_verifiable_claims: '提供台灣本島快速出貨'
    })).result.structuredContent.settings.aeo_business_summary, '服飾電商，提供上班與日常穿搭');
    assert.equal((await callTool(32, 'slimweb_integration_settings_get', { site_id: 101 })).result.structuredContent.settings.ai_provider, 'openai_gpt');
    assert.equal((await callTool(33, 'slimweb_integration_settings_update', { site_id: 101, ai_api_key: 'sk-test', notion_token: 'ntn-test' })).result.structuredContent.settings.notion_token, 'ntn-test');
    assert.equal((await callTool(34, 'slimweb_payment_logistics_get', { site_id: 101 })).result.structuredContent.supported_payment_providers[0].provider, 'ecpay');
    assert.equal((await callTool(35, 'slimweb_payment_logistics_update', { site_id: 101, payments: [{ provider: 'ecpay', is_enabled: true }] })).result.structuredContent.payment_providers[0].provider, 'ecpay');
    assert.equal((await callTool(36, 'slimweb_orders_list', { site_id: 101 })).result.structuredContent.orders[0].order_no, 'SW1');
    assert.equal((await callTool(37, 'slimweb_orders_profit_statistics', { site_id: 101, date_from: '2026-06-01', date_to: '2026-06-30' })).result.structuredContent.profit.total_amount, 1880);
    assert.equal((await callTool(38, 'slimweb_orders_get', { site_id: 101, order_no: 'SW1' })).result.structuredContent.order.order_no, 'SW1');
    assert.equal((await callTool(39, 'slimweb_orders_create_logistics', { site_id: 101, order_no: 'SW1', provider: 'hct' })).result.structuredContent.order.logistics_status, 'created');
    assert.equal((await callTool(40, 'slimweb_orders_mark_shipped', { site_id: 101, order_no: 'SW1' })).result.structuredContent.order.logistics_status, 'completed');
    assert.equal((await callTool(41, 'slimweb_returns_pending_list', { site_id: 101 })).result.structuredContent.orders[0].order_no, 'SWR');
    assert.equal((await callTool(42, 'slimweb_returns_create_logistics', { site_id: 101, order_no: 'SWR', provider: 'hct' })).result.structuredContent.order.return_logistics_status, 'created');
    assert.equal((await callTool(43, 'slimweb_returns_cancel', { site_id: 101, order_no: 'SWR' })).result.structuredContent.order.return_status, 'cancelled');
    assert.equal((await callTool(44, 'slimweb_returns_complete', { site_id: 101, order_no: 'SWR' })).result.structuredContent.order.return_status, 'completed');
    assert.equal((await callTool(45, 'slimweb_refunds_complete', { site_id: 101, order_no: 'SWR' })).result.structuredContent.order.refund_status, 'completed');
    assert.equal((await callTool(46, 'slimweb_refunds_create', { site_id: 101, order_no: 'SWR', provider: 'ecpay' })).result.structuredContent.order.refund_status, 'created');
    assert.equal((await callTool(47, 'slimweb_dashboard_summary', { site_id: 101 })).result.structuredContent.stats.totalProducts, 1);
    assert.equal((await callTool(37, 'slimweb_settings_get', { site_id: 101 })).result.structuredContent.settings.site_status, 'active');
    assert.equal((await callTool(38, 'slimweb_settings_update', { site_id: 101, site_status: 'maintenance' })).result.structuredContent.settings.site_status, 'maintenance');
    assert.equal((await callTool(39, 'slimweb_admins_list', { site_id: 101 })).result.structuredContent.admins[0].canDelete, false);
    assert.equal((await callTool(40, 'slimweb_admins_upsert', { site_id: 101, google_email: 'staff@example.com', permissions: ['product_management'] })).result.structuredContent.admin.google_email, 'staff@example.com');
    assert.equal((await callTool(41, 'slimweb_admins_delete', { site_id: 101, admin_id: 2 })).result.structuredContent.deleted_admin_id, 2);
    assert.equal((await callTool(42, 'slimweb_external_assets_list', { site_id: 101 })).result.structuredContent.assets[0].asset_type, 'css');
    assert.equal((await callTool(43, 'slimweb_external_assets_upsert', { site_id: 101, scope: 'site', asset_type: 'js', url: 'https://cdn.example.com/app.js', load_mode: 'defer' })).result.structuredContent.asset.url, 'https://cdn.example.com/app.js');
    assert.equal((await callTool(44, 'slimweb_external_assets_delete', { site_id: 101, asset_id: 72 })).result.structuredContent.deleted_asset_id, 72);
    assert.equal((await callTool(45, 'slimweb_external_assets_reorder', { site_id: 101, asset_ids: [72, 71] })).result.structuredContent.assets[1].sort_order, 1);
    assert.equal((await callTool(44, 'slimweb_articles_list', { site_id: 101 })).result.structuredContent.articles[0].title, '春季穿搭');
    assert.equal((await callTool(45, 'slimweb_articles_upsert', {
      site_id: 101,
      title: '春季穿搭',
      content_html: '<article><h1>春季穿搭</h1></article>',
      cover_image: { media_path: 'sites/101/mcp-uploads/committed/article-cover.webp' }
    })).result.structuredContent.article.id, 10);
    assert.equal((await callTool(46, 'slimweb_categories_list', { site_id: 101 })).result.structuredContent.categories[0].name, '女裝');
    assert.equal((await callTool(47, 'slimweb_categories_upsert', { site_id: 101, parent_id: null, name: '童裝', icon_svg_base64: 'PHN2Zy8+' })).result.structuredContent.category.name, '童裝');
    assert.equal((await callTool(48, 'slimweb_categories_delete', { site_id: 101, category_id: 6 })).result.structuredContent.deleted_category_ids[0], 6);
    assert.equal((await callTool(49, 'slimweb_nav_items_list', { site_id: 101 })).result.structuredContent.nav_items[0].name, '男裝');
    assert.equal((await callTool(50, 'slimweb_nav_items_upsert', { site_id: 101, name: '男裝', item_type: 'link', icon_svg_base64: 'PHN2Zy8+' })).result.structuredContent.nav_item.name, '男裝');
    assert.equal((await callTool(51, 'slimweb_nav_items_delete', { site_id: 101, nav_item_id: 12 })).result.structuredContent.deleted_nav_item_ids[0], 12);
    assert.equal((await callTool(52, 'slimweb_products_list', { site_id: 101 })).result.structuredContent.products[0].name, '洋裝');
    assert.equal((await callTool(53, 'slimweb_products_get', { site_id: 101, product_id: 7 })).result.structuredContent.product.name, '洋裝');
    assert.equal((await callTool(54, 'slimweb_uploads_create', { site_id: 101, filename: 'main.png', mime_type: 'image/png', size_bytes: 1234, target_usage: 'product_image' })).result.structuredContent.upload_url, 'https://slimweb.tw/sites/site-1/mcp-uploads/upload-1?token=token-1');
    assert.equal((await callTool(55, 'slimweb_uploads_commit', { site_id: 101, upload_id: 'upload-1', upload_token: 'token-1' })).result.structuredContent.asset.media_path, 'sites/101/mcp-uploads/committed/upload-1.webp');
    assert.equal((await callTool(55, 'slimweb_images_import_chatgpt_attachment', {
      site_id: 101,
      target_usage: 'product_image',
      image: {
        download_url: 'https://files.oaiusercontent.com/file-abc',
        name: 'main.png',
        mime_type: 'image/png',
        size: 1234
      }
    })).result.structuredContent.asset.media_path, 'sites/101/mcp-uploads/committed/chatgpt-upload.webp');
    assert.equal((await callTool(56, 'slimweb_products_upsert', { site_id: 101, site_category_id: 5, name: '新款洋裝', base_price: 1200, primary_images: [{ source: { media_path: 'sites/101/mcp-uploads/committed/upload-1.webp' } }] })).result.structuredContent.product.id, 7);
    assert.equal((await callTool(57, 'slimweb_products_delete', { site_id: 101, product_id: 7 })).result.structuredContent.deleted_product_id, 7);
    assert.equal((await callTool(55, 'slimweb_products_import_inspect', { site_id: 101, source: { data_base64: Buffer.from('商品名稱,價格\\n洋裝,1200').toString('base64'), filename: 'products.csv' } })).result.structuredContent.dataset.total_rows, 2);
    assert.equal((await callTool(56, 'slimweb_products_import_validate', { site_id: 101, source: { data_base64: Buffer.from('商品名稱,價格\\n洋裝,1200').toString('base64'), filename: 'products.csv' }, mapping: { field_mapping: { name: '商品名稱', base_price: '價格' } } })).result.structuredContent.convertible, true);
    assert.equal((await callTool(57, 'slimweb_products_import_commit', { site_id: 101, source: { data_base64: Buffer.from('商品名稱,價格\\n洋裝,1200').toString('base64'), filename: 'products.csv' }, mapping: { field_mapping: { name: '商品名稱', base_price: '價格' } } })).result.structuredContent.result.created_products, 2);
	    assert.equal((await callTool(58, 'slimweb_coupon_templates_list', { site_id: 101 })).result.structuredContent.coupon_templates[0].name, '母親節優惠');
	    assert.equal((await callTool(59, 'slimweb_coupon_templates_upsert', { site_id: 101, name: '母親節全館券', discount_amount: 200, issue_trigger: 'all_members', starts_at: '2026-05-01', ends_at: '2026-05-12' })).result.structuredContent.coupon_template.id, 3);
	    assert.equal((await callTool(60, 'slimweb_members_coupons_issue', { site_id: 101, member_id: 88, coupon_template_id: 3 })).result.structuredContent.member_coupon.member_id, 88);
	    assert.equal((await callTool(61, 'slimweb_members_list', { site_id: 101, keyword: 'member@example.com' })).result.structuredContent.members[0].email, 'member@example.com');
	    assert.equal((await callTool(62, 'slimweb_members_get', { site_id: 101, member_id: 88 })).result.structuredContent.member.id, 88);
	    assert.equal((await callTool(63, 'slimweb_discount_codes_list', { site_id: 101 })).result.structuredContent.discount_codes[0].code, 'VIP200');
	    assert.equal((await callTool(64, 'slimweb_discount_codes_upsert', { site_id: 101, code: 'VIP200', discount_amount: 200 })).result.structuredContent.discount_code.code, 'VIP200');
	    assert.equal((await callTool(65, 'slimweb_member_tiers_list', { site_id: 101 })).result.structuredContent.member_tiers[0].name, 'VIP');
	    assert.equal((await callTool(66, 'slimweb_member_tiers_upsert', { site_id: 101, name: 'VIP', threshold_amount: 10000 })).result.structuredContent.member_tier.name, 'VIP');
	    assert.equal((await callTool(67, 'slimweb_threshold_gifts_list', { site_id: 101 })).result.structuredContent.threshold_gifts[0].name, '滿額禮');
	    assert.equal((await callTool(68, 'slimweb_threshold_gifts_upsert', { site_id: 101, name: '滿額禮', threshold_amount: 2000 })).result.structuredContent.threshold_gift.name, '滿額禮');
	    assert.equal((await callTool(69, 'slimweb_product_add_ons_list', { site_id: 101 })).result.structuredContent.product_add_ons[0].name, '加購袋');
	    assert.equal((await callTool(70, 'slimweb_product_add_ons_upsert', { site_id: 101, name: '加購袋', product_id: 7, add_on_product_id: 8 })).result.structuredContent.product_add_on.name, '加購袋');
	    assert.equal((await callTool(71, 'slimweb_faqs_list', { site_id: 101 })).result.structuredContent.faqs[0].question, '如何退貨？');
	    assert.equal((await callTool(72, 'slimweb_faqs_upsert', { site_id: 101, question: '如何退貨？', answer: '請聯絡客服。' })).result.structuredContent.faq.question, '如何退貨？');
	    assert.equal((await callTool(73, 'slimweb_customer_service_logs_list', { site_id: 101 })).result.structuredContent.logs[0].channel, 'line');
	    assert.equal((await callTool(74, 'slimweb_customer_service_settings_get', { site_id: 101 })).result.structuredContent.settings.use_ai_customer_service, true);
	    assert.equal((await callTool(75, 'slimweb_customer_service_settings_update', { site_id: 101, use_ai_customer_service: false })).result.structuredContent.settings.use_ai_customer_service, false);
	    assert.equal((await callTool(76, 'slimweb_exports_create', { site_id: 101, export_type: 'members', format: 'csv' })).result.structuredContent.export.type, 'members');
	    assert.equal((await callTool(77, 'slimweb_audit_list', { site_id: 101 })).result.structuredContent.audit_logs[0].tool_name, 'slimweb_sites_list');
	    assert.equal((await callTool(61, 'slimweb_themes_update_root_elements', { site_id: 101, theme_id: 22, fragments: { navbar: '<nav>cute</nav>' } })).result.structuredContent.ok, true);
    assert.match((await callTool(62, 'slimweb_preview_get_page_url', { site_id: 101, page_key: 'index' })).result.structuredContent.url, /mcp_page_key=index/);
    assert.equal((await callTool(63, 'slimweb_pages_get_home_content', { site_id: 101 })).result.structuredContent.content.html, '<section>Home</section>');
    assert.equal((await callTool(64, 'slimweb_pages_update_home_content', { site_id: 101, content: { html: '<section>New</section>' } })).result.structuredContent.ok, true);
    assert.equal((await callTool(65, 'slimweb_pages_upsert', { site_id: 101, page_key: 'about-us', title: '關於我們', content: { html: '<section>About</section>' } })).result.structuredContent.page_key, 'about-us');
    assert.equal((await callTool(66, 'slimweb_pages_delete', { site_id: 101, page_key: 'landing' })).result.structuredContent.deleted_page_key, 'landing');
    assert.match((await callTool(67, 'slimweb_assets_upload', {
      site_id: 101,
      source: { media_path: 'sites/101/mcp-uploads/committed/upload-1.webp' },
      target_usage: 'home_page',
      asset_scope: 'page'
    })).result.structuredContent.public_url, /hero\.png/);
    assert.equal((await callTool(68, 'slimweb_themes_delete', { site_id: 101, theme_id: 22 })).result.structuredContent.deleted_theme_id, 22);

		    assert.deepEqual(calls.map((call) => call[0]), ['select', 'themes_list', 'themes_create', 'shell_context', 'profile_get', 'profile_upsert', 'profile_append', 'site_readiness_get', 'seo_get', 'seo_update', 'integration_get', 'integration_update', 'payment_logistics_get', 'payment_logistics_update', 'orders_list', 'orders_profit_statistics', 'orders_get', 'orders_create_logistics', 'orders_mark_shipped', 'returns_pending_list', 'returns_create_logistics', 'returns_cancel', 'returns_complete', 'refunds_complete', 'refunds_create', 'dashboard_summary', 'settings_get', 'settings_update', 'admins_list', 'admin_upsert', 'admin_delete', 'external_assets_list', 'external_asset_upsert', 'external_asset_delete', 'external_assets_reorder', 'articles_list', 'article_upsert', 'categories_list', 'category_upsert', 'category_delete', 'nav_items_list', 'nav_item_upsert', 'nav_item_delete', 'products_list', 'product_get', 'upload_create', 'upload_commit', 'chatgpt_attachment_import', 'product_upsert', 'product_delete', 'product_import_inspect', 'product_import_validate', 'product_import_commit', 'coupon_templates_list', 'coupon_template_upsert', 'member_coupon_issue', 'members_list', 'member_get', 'discount_codes_list', 'discount_code_upsert', 'member_tiers_list', 'member_tier_upsert', 'threshold_gifts_list', 'threshold_gift_upsert', 'product_add_ons_list', 'product_add_on_upsert', 'faqs_list', 'faq_upsert', 'customer_service_logs_list', 'customer_service_settings_get', 'customer_service_settings_update', 'export_create', 'audit_list', 'themes_root', 'preview', 'get_home', 'update_home', 'page_upsert', 'page_delete', 'upload', 'themes_delete']);
		    assert.deepEqual(calls.map((call) => call[1].email), Array.from({ length: 81 }, () => 'owner@example.com'));
  });
});

test('auth status requires an MCP session', async () => {
  await withServerOptions({
    publicBaseUrl: 'https://mcp.example.test'
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'slimweb_auth_status',
          arguments: {}
        }
      })
    });

    const body = await response.json();
    const authenticate = response.headers.get('www-authenticate');

    assert.equal(response.status, 401);
    assert.match(authenticate, /^Bearer /);
    assert.match(authenticate, /resource_metadata="https:\/\/mcp\.example\.test\/\.well-known\/oauth-protected-resource\/mcp"/);
    assert.equal(body.id, null);
    assert.equal(body.error.code, -32001);
    assert.equal(body.error.data.reason, 'AUTH_REQUIRED');
    assert.equal(body.error.data.resource_metadata, 'https://mcp.example.test/.well-known/oauth-protected-resource/mcp');
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
      listAdminSitesForGoogleProfile: async (profile) => testAdminSitesFor(profile)
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
    assert.equal(body.admin.email, 'owner@example.com');
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
      listAdminSitesForGoogleProfile: async () => {
        throw new Error('should not be called');
      }
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

test('OAuth discovery exposes ChatGPT-compatible endpoints', async () => {
  await withServerOptions({
    publicBaseUrl: 'https://mcp.example.test',
    sessionSecret: 'test-secret'
  }, async (baseUrl) => {
    const protectedResourceResponse = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    const protectedResourceMcpResponse = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
    const protectedResourceMcpPrefixResponse = await fetch(`${baseUrl}/mcp/.well-known/oauth-protected-resource`);
    const protectedResource = await protectedResourceResponse.json();
    const authorizationServerResponse = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
    const authorizationServerMcpResponse = await fetch(`${baseUrl}/.well-known/oauth-authorization-server/mcp`);
    const authorizationServerMcpPrefixResponse = await fetch(`${baseUrl}/mcp/.well-known/oauth-authorization-server`);
    const authorizationServer = await authorizationServerResponse.json();

    assert.equal(protectedResourceResponse.status, 200);
    assert.equal(protectedResourceMcpResponse.status, 200);
    assert.equal(protectedResourceMcpPrefixResponse.status, 200);
    assert.equal(protectedResource.resource, 'https://mcp.example.test/mcp');
    assert.deepEqual(protectedResource.authorization_servers, ['https://mcp.example.test']);

    assert.equal(authorizationServerResponse.status, 200);
    assert.equal(authorizationServerMcpResponse.status, 200);
    assert.equal(authorizationServerMcpPrefixResponse.status, 200);
    assert.equal(authorizationServer.issuer, 'https://mcp.example.test');
    assert.equal(authorizationServer.authorization_endpoint, 'https://mcp.example.test/oauth/authorize');
    assert.equal(authorizationServer.token_endpoint, 'https://mcp.example.test/oauth/token');
    assert.equal(authorizationServer.registration_endpoint, 'https://mcp.example.test/oauth/register');
    assert.ok(authorizationServer.grant_types_supported.includes('authorization_code'));
    assert.ok(authorizationServer.code_challenge_methods_supported.includes('S256'));
    assert.ok(authorizationServer.token_endpoint_auth_methods_supported.includes('none'));
  });
});

test('OAuth dynamic client registration returns a public client', async () => {
  await withServerOptions({
    publicBaseUrl: 'https://mcp.example.test',
    sessionSecret: 'test-secret'
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'ChatGPT',
        redirect_uris: ['https://chatgpt.com/oauth/callback']
      })
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.client_name, 'ChatGPT');
    assert.match(body.client_id, /^swmcp_/);
    assert.equal(body.token_endpoint_auth_method, 'none');
    assert.deepEqual(body.redirect_uris, ['https://chatgpt.com/oauth/callback']);
  });
});

test('OAuth authorization code flow exchanges logged-in session for MCP bearer token', async () => {
  await withServerOptions({
    publicBaseUrl: 'https://mcp.example.test',
    googleVerifier: {
      verify: async () => ({
        sub: 'google-sub-oauth',
        email: 'owner@example.com',
        name: 'Owner'
      })
    },
    accountRepository: {
      listAdminSitesForGoogleProfile: async (profile) => testAdminSitesFor(profile),
      listSitesForAdminIdentity: async (identity) => testAdminSitesFor({ email: identity.email, sub: identity.google_id })
    },
    sessionSecret: 'test-secret'
  }, async (baseUrl) => {
    const loginResponse = await fetch(`${baseUrl}/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential: 'google-id-token' })
    });
    const cookie = loginResponse.headers.get('set-cookie');

    const codeVerifier = 'this-is-a-long-pkce-code-verifier-for-chatgpt';
    const codeChallenge = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
    ).toString('base64url');
    const redirectUri = 'https://chatgpt.com/oauth/callback';
    const authorizeUrl = new URL(`${baseUrl}/oauth/authorize`);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', 'chatgpt-client');
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('state', 'state-123');
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');

    const authorizeResponse = await fetch(authorizeUrl, {
      headers: { cookie },
      redirect: 'manual'
    });
    const location = authorizeResponse.headers.get('location');
    const callbackUrl = new URL(location);

    assert.equal(authorizeResponse.status, 302);
    assert.equal(callbackUrl.origin + callbackUrl.pathname, redirectUri);
    assert.equal(callbackUrl.searchParams.get('state'), 'state-123');
    assert.ok(callbackUrl.searchParams.get('code'));

    const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'chatgpt-client',
        redirect_uri: redirectUri,
        code: callbackUrl.searchParams.get('code'),
        code_verifier: codeVerifier
      })
    });
    const tokenBody = await tokenResponse.json();

    assert.equal(tokenResponse.status, 200);
    assert.equal(tokenBody.token_type, 'Bearer');
    assert.equal(tokenBody.expires_in, 604800);
    assert.ok(tokenBody.access_token);

    const mcpResponse = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${tokenBody.access_token}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: {
          name: 'slimweb_auth_status',
          arguments: {}
        }
      })
    });
    const mcpBody = await mcpResponse.json();

    assert.equal(mcpBody.result.structuredContent.authenticated, true);
    assert.equal(mcpBody.result.structuredContent.account.email, 'owner@example.com');
  });
});

test('auth success page does not expose bearer token after OAuth login', async () => {
  await withServerOptions({
    googleVerifier: {
      verify: async () => ({
        sub: 'google-sub-token',
        email: 'owner@example.com',
        name: 'Owner'
      })
    },
    accountRepository: {
      listAdminSitesForGoogleProfile: async (profile) => testAdminSitesFor(profile)
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
    assert.match(html, /OAuth 授權已完成/);
    assert.match(html, /不需要手動複製 token/);
    assert.doesNotMatch(html, /Authorization:\s*Bearer/);
    assert.doesNotMatch(html, /<textarea/i);
    assert.doesNotMatch(html, /copy-token/);
    assert.doesNotMatch(html, new RegExp(loginBody.session.access_token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
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
      listAdminSitesForGoogleProfile: async (profile) => [{
        site_admin_id: 11,
        site_id: 101,
        id: 101,
        slug: 'site-1',
        name: '測試網站',
        domain: '',
        permissions: ['backend_ai_assistant', 'page_management'],
        site_status: 'active',
        site_status_label: '正常運作',
        google_email: profile.email
      }],
      listSitesForAdminIdentity: async (identity) => {
        assert.equal(identity.email, 'owner@example.com');
        return [{
          site_admin_id: 11,
          site_id: 101,
          id: 101,
          slug: 'site-1',
          name: '測試網站',
          domain: '',
          permissions: ['backend_ai_assistant', 'page_management'],
          site_status: 'active',
          site_status_label: '正常運作'
        }];
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
          name: 'slimweb_auth_status',
          arguments: {}
        }
      })
    });
    const statusBody = await statusResponse.json();

    assert.equal(statusBody.result.content[0].type, 'text');
    assert.deepEqual(JSON.parse(statusBody.result.content[0].text), statusBody.result.structuredContent);
    assert.equal(statusBody.result.structuredContent.authenticated, true);
    assert.equal(statusBody.result.structuredContent.admin.email, 'owner@example.com');

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
          name: 'slimweb_sites_list',
          arguments: {}
        }
      })
    });
    const sitesBody = await sitesResponse.json();

    assert.equal(sitesBody.result.structuredContent.sites.length, 1);
    assert.equal(sitesBody.result.structuredContent.sites[0].slug, 'site-1');
    assert.equal(sitesBody.result.structuredContent.sites[0].site_admin_id, 11);
    assert.equal(sitesBody.result.structuredContent.sites[0].status, undefined);
    assert.equal(sitesBody.result.structuredContent.sites[0].site_status, 'active');
    assert.equal(sitesBody.result.structuredContent.sites[0].site_status_label, '正常運作');
  });
});

test('Google login requires at least one web admin with backend AI assistant permission', async () => {
  await withServerOptions({
    googleVerifier: {
      verify: async () => ({
        sub: 'google-sub-no-ai',
        email: 'staff@example.com',
        name: 'Staff'
      })
    },
    accountRepository: {
      listAdminSitesForGoogleProfile: async () => []
    },
    sessionSecret: 'test-secret'
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential: 'google-id-token' })
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'FORBIDDEN');
    assert.match(body.error.message, /後台 AI 助理|backend AI assistant/i);
  });
});

test('authenticated tools list and calls are filtered by web admin permissions', async () => {
  const repository = {
    listAdminSitesForGoogleProfile: async () => [{
      site_admin_id: 22,
      site_id: 101,
      id: 101,
      slug: 'site-1',
      name: '測試網站',
      permissions: ['backend_ai_assistant', 'page_management', 'page_management_pages']
    }],
    listSitesForAdminIdentity: async () => [{
      site_admin_id: 22,
      site_id: 101,
      id: 101,
      slug: 'site-1',
      name: '測試網站',
      permissions: ['backend_ai_assistant', 'page_management', 'page_management_pages']
    }],
    getHomeContent: async () => ({ content: { html: '<section>Home</section>' } }),
    listProducts: async () => {
      throw new Error('product tool should not be called without permission');
    }
  };

  await withServerOptions({
    googleVerifier: {
      verify: async () => ({
        sub: 'google-sub-page-only',
        email: 'page-admin@example.com',
        name: 'Page Admin'
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

    const toolsResponse = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31,
        method: 'tools/list'
      })
    });
    const toolsBody = await toolsResponse.json();
    const toolNames = toolsBody.result.tools.map((tool) => tool.name);

    assert.equal(toolNames.includes('slimweb_pages_get_home_content'), true);
    assert.equal(toolNames.includes('slimweb_products_list'), false);

    const deniedResponse = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 32,
        method: 'tools/call',
        params: {
          name: 'slimweb_products_list',
          arguments: { site_id: 101 }
        }
      })
    });
    const deniedBody = await deniedResponse.json();

    assert.equal(deniedBody.error.data.reason, 'FORBIDDEN');
  });
});
