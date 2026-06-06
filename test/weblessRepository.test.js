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
            site_status: 'active'
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
            site_status: 'active'
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
            site_status: 'active'
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
            site_status: 'active'
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

function seoSettingsPool() {
  const state = {
    site: {
      id: 101,
      slug: 'site-1',
      name: '測試網站',
      domain: '',
      site_status: 'active',
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
          canonical_url: params[3],
          robots_policy: params[4],
          og_title: params[5],
          og_description: params[6],
          og_image_url: params[7],
          llms_txt: params[8],
          aeo_business_summary: params[9],
          aeo_target_audience: params[10],
          aeo_products_services: params[11],
          aeo_customer_questions: params[12],
          aeo_answer_style: params[13],
          aeo_entity_facts: params[14],
          geo_citation_targets: params[15],
          geo_verifiable_claims: params[16],
          geo_trust_signals: params[17],
          geo_same_as_profiles: params[18],
          geo_comparison_positioning: params[19]
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
    product_category_depth: 3,
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
    line_login_channel_id: null,
    line_login_channel_secret: null,
    google_login_client_id: null,
    broadcast_id: null,
    use_ai_customer_service: false,
    ai_customer_service_question_limit: 500,
    ai_customer_service_retention_days: 30,
    ai_provider: 'openai_gpt',
    ai_api_key: null,
    ai_model_name: null,
    google_search_api_key: null,
    google_search_engine_id: null,
    notion_token: null,
    notion_page_id: null
  };

  return {
    async query(sql, params) {
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

      if (sql.includes('from sites') && sql.includes('where id = $1') && sql.includes('line_login_channel_id')) {
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
      line_login_channel_id: null,
      line_login_channel_secret: null,
      google_login_client_id: null,
      broadcast_id: null,
      use_ai_customer_service: false,
      ai_provider: 'openai_gpt',
      ai_api_key: null,
      ai_model_name: null,
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
          line_login_channel_id: params[6],
          line_login_channel_secret: params[7],
          google_login_client_id: params[8],
          broadcast_id: params[9],
          use_ai_customer_service: params[10],
          ai_provider: params[11],
          ai_api_key: params[12],
          ai_model_name: params[13],
          google_search_api_key: params[14],
          google_search_engine_id: params[15],
          line_bot_access_token: params[16],
          line_bot_channel_secret: params[17],
          line_bot_user_id: params[18],
          notion_token: params[19]
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
        const article = state.articles.find((item) => item.site_id === params[5] && item.id === params[6]);
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

      if (sql.includes('from members') && sql.includes('where site_id = $1 and id = $2')) {
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

      if (sql.includes('where site_id = $1 and parent_id = $2')) {
        return { rows: state.categories.filter((category) => category.site_id === params[0] && category.parent_id === params[1]).slice(0, 1) };
      }

      if (sql.includes('from site_categories') && sql.includes('name = $2') && sql.includes('limit 1')) {
        return { rows: [] };
      }

      if (sql.includes('coalesce(max(sort_order), -1) + 1')) {
        return { rows: [{ next_sort_order: 1 }] };
      }

      if (sql.includes('insert into site_categories')) {
        const category = { id: state.nextCategoryId++, site_id: params[0], parent_id: params[1], name: params[2], icon_svg: params[3], sort_order: params[4], icon_path: null, image_path: null };
        state.categories.push(category);
        return { rows: [category] };
      }

      if (sql.includes('update site_categories')) {
        const category = state.categories.find((item) => item.site_id === params[4] && item.id === params[5]);
        Object.assign(category, { parent_id: params[0], name: params[1], icon_svg: params[2], sort_order: params[3] });
        return { rows: [category] };
      }

      if (sql.includes('from site_nav_items') && sql.includes('where site_id = $1 and id = $2')) {
        return { rows: state.navItems.filter((item) => item.site_id === params[0] && item.id === params[1]) };
      }

      if (sql.includes('from site_nav_items') && sql.includes('name = $2') && sql.includes('limit 1')) {
        return { rows: [] };
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
        return { rows: [{ total: String(state.products.length) }] };
      }

      if (sql.includes('from products p') && sql.includes('left join site_categories')) {
        return { rows: state.products.map((product) => ({ ...product, category_name: '男童' })) };
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
  assert.equal(read.settings.aeo_target_audience, '25-40 歲女性上班族');
  assert.equal(read.settings.aeo_customer_questions, '如何挑選尺寸？\n夏天適合哪些材質？');
  assert.equal(read.settings.geo_verifiable_claims, '提供台灣本島快速出貨；支援七天鑑賞期。');
  assert.equal(read.settings.geo_comparison_positioning, '適合尋找上班與日常都能穿搭的女性客群。');
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
  assert.ok(report.next_actions.some((action) => action.suggested_tools.includes('slimweb_payment_logistics_update')));
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
    ai_provider: 'google_gemini',
    ai_api_key: 'gemini-key',
    ai_model_name: 'gemini-2.5-pro',
    notion_token: 'notion-secret'
  });
  const read = await repository.getIntegrationSettings(11, { site_id: 101 });

  assert.equal(updated.ok, true);
  assert.equal(read.settings.facebook_app_id, 'fb-app');
  assert.equal(read.settings.facebook_comment_on_products, true);
  assert.equal(read.settings.ai_provider, 'google_gemini');
  assert.equal(read.settings.notion_token, 'notion-secret');
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

test('repository lists and upserts articles with cover and content images', async () => {
  const pool = articlesPool();
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'slimweb-mcp-storage-'));
  const repository = new WeblessAccountRepository(pool, {
    storageRoot,
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const listed = await repository.listArticles(11, { site_id: 101 });
  const created = await repository.upsertArticle(11, {
    site_id: 101,
    title: '夏季透氣穿搭',
    content_html: '<article><h1>夏季透氣穿搭</h1></article>',
    cover_image: { media_path: 'sites/101/mcp-uploads/committed/article-cover.webp' },
    content_images: [{
      suggested_filename: 'linen-look.webp',
      alt_text: '亞麻襯衫穿搭',
      source: { media_path: 'sites/101/mcp-uploads/committed/linen-look.webp' }
    }]
  });

  assert.equal(listed.articles[0].title, '春季穿搭');
  assert.equal(created.article.title, '夏季透氣穿搭');
  assert.match(created.article.cover_url, /\/media\/sites\/101\/mcp-uploads\/committed\/article-cover\.webp/);
  assert.match(created.content_images[0].url, /linen-look\.webp/);
});

test('repository removes duplicated article title heading from content html', async () => {
  const pool = articlesPool();
  const repository = new WeblessAccountRepository(pool, {
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const created = await repository.upsertArticle(11, {
    site_id: 101,
    title: '關於 SlimWeb',
    content_html: '<article><h1>關於 SlimWeb</h1><p>SlimWeb 介紹</p></article>',
    cover_image: { media_path: 'sites/101/mcp-uploads/committed/article-cover.webp' }
  });

  assert.equal(created.article.content, '<article><p>SlimWeb 介紹</p></article>');
});

test('repository requires a cover image when creating an article', async () => {
  const pool = articlesPool();
  const repository = new WeblessAccountRepository(pool, {
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  await assert.rejects(
    () => repository.upsertArticle(11, {
      site_id: 101,
      title: '沒有主圖的文章',
      content_html: '<article><h1>沒有主圖的文章</h1></article>'
    }),
    /cover_image is required/
  );
});

test('repository inspects, validates, and commits product imports without backend AI analysis', async () => {
  const pool = productImportPool();
  const repository = new WeblessAccountRepository(pool);
  const csv = [
    '商品名稱,售價,庫存,主圖',
    '洋裝 A,1200,5,https://example.com/a.jpg',
    '上衣 B,800,3,https://example.com/b.jpg'
  ].join('\n');
  const source = {
    data_base64: Buffer.from(csv).toString('base64'),
    filename: 'products.csv'
  };
  const mapping = {
    field_mapping: {
      name: '商品名稱',
      base_price: '售價',
      stock: '庫存'
    },
    image_mapping: {
      primary_images: '主圖'
    }
  };

  const inspected = await repository.inspectProductImport(11, { site_id: 101, source });
  const validated = await repository.validateProductImport(11, { site_id: 101, source, mapping });
  const committed = await repository.commitProductImport(11, { site_id: 101, source, mapping });

  assert.equal(inspected.dataset.total_rows, 2);
  assert.match(inspected.ai_mapping_prompt.system, /Return JSON only/);
  assert.deepEqual(Object.keys(inspected.ai_mapping_prompt.expected_json_shape.field_mapping), ['name', 'sku', 'summary', 'description', 'base_price', 'sale_price', 'stock', 'youtube_url']);
  assert.match(inspected.ai_mapping_prompt.import_policy, /Ignore any source id column/);
  assert.equal(validated.convertible, true);
  assert.equal(committed.result.created_products, 2);
  assert.equal(pool.state.products[0].base_price, 1200);
  assert.equal(pool.state.products[0].site_category_id, 5);
  assert.equal(pool.state.images[0].path, 'https://example.com/a.jpg');
});

test('repository returns product import validation failures for AI to explain', async () => {
  const pool = productImportPool();
  const repository = new WeblessAccountRepository(pool);
  const source = {
    data_base64: Buffer.from('商品名稱,售價\n洋裝 A,abc').toString('base64'),
    filename: 'products.csv'
  };
  const mapping = {
    field_mapping: {
      name: '商品名稱',
      base_price: '售價'
    }
  };

  const validated = await repository.validateProductImport(11, { site_id: 101, source, mapping });

  assert.equal(validated.convertible, false);
  assert.match(validated.failure_reasons[0], /Base price is not numeric/);
  await assert.rejects(
    () => repository.commitProductImport(11, { site_id: 101, source, mapping }),
    /not convertible/
  );
  assert.equal(pool.state.products.length, 0);
});

test('repository creates categories and products with required primary images', async () => {
  const pool = productCatalogPool();
  const repository = new WeblessAccountRepository(pool, {
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const iconSvgBase64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path stroke="#9ca3af" d="M12 4v16"/></svg>').toString('base64');

  const categories = await repository.listCategories(11, { site_id: 101 });
  const category = await repository.upsertCategory(11, {
    site_id: 101,
    name: '女童',
    icon_svg_base64: iconSvgBase64
  });
  const movedCategory = await repository.upsertCategory(11, {
    site_id: 101,
    category_id: category.category.id,
    parent_id: 5,
    name: '女童',
    icon_svg_base64: iconSvgBase64
  });
  const product = await repository.upsertProduct(11, {
    site_id: 101,
    site_category_id: 6,
    name: '男童牛仔外套',
    base_price: 1680,
    sale_price: 1280,
    stock: 8,
    primary_images: [{
      source: {
        media_path: 'sites/101/mcp-uploads/committed/kids-jacket.jpg'
      },
      suggested_filename: 'kids-jacket.jpg'
    }]
  });
  const listed = await repository.listProducts(11, { site_id: 101 });
  const fetched = await repository.getProduct(11, { site_id: 101, product_id: product.product.id });

  assert.equal(categories.categories[0].name, '童裝');
  assert.equal(category.category.name, '女童');
  assert.equal(category.category.parent_id, null);
  assert.match(category.category.icon_svg, /<svg/);
  assert.equal(movedCategory.category.parent_id, 5);
  assert.equal(product.product.name, '男童牛仔外套');
  assert.equal(product.product.primary_images[0].path, 'sites/101/mcp-uploads/committed/kids-jacket.jpg');
  assert.equal(product.product.primary_images[0].url, `https://slimweb.tw/media/${product.product.primary_images[0].path}`);
  assert.equal(listed.products[0].name, '男童牛仔外套');
  assert.equal(fetched.product.base_price, 1680);

  await assert.rejects(
    () => repository.upsertProduct(11, {
      site_id: 101,
      site_category_id: 6,
      name: '缺圖商品',
      base_price: 1000
    }),
    /At least one primary image/
  );
});

test('repository manages nav items with root default and base64 svg icons', async () => {
  const pool = productCatalogPool();
  const repository = new WeblessAccountRepository(pool, {
    publicSiteBaseUrl: 'https://slimweb.tw'
  });
  const iconSvgBase64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" stroke="#9ca3af"/></svg>').toString('base64');
  const redrawnIconSvgBase64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path stroke="#9ca3af" d="M4 12h16"/></svg>').toString('base64');

  const created = await repository.upsertNavItem(11, {
    site_id: 101,
    name: '男裝',
    item_type: 'link',
    url: '/products?category=mens',
    icon_svg_base64: iconSvgBase64
  });
  const moved = await repository.upsertNavItem(11, {
    site_id: 101,
    nav_item_id: created.nav_item.id,
    parent_id: 40,
    name: '男裝',
    item_type: 'link',
    url: '/products?category=mens',
    icon_svg_base64: redrawnIconSvgBase64
  });
  const redrawn = await repository.upsertNavItem(11, {
    site_id: 101,
    nav_item_id: created.nav_item.id,
    name: '男裝',
    item_type: 'link',
    url: '/products?category=mens',
    icon_svg_base64: redrawnIconSvgBase64
  });
  const listed = await repository.listNavItems(11, { site_id: 101 });
  const deleted = await repository.deleteNavItem(11, { site_id: 101, nav_item_id: created.nav_item.id });

  assert.equal(created.nav_item.parent_id, null);
  assert.match(created.nav_item.icon_svg, /<svg/);
  assert.equal(moved.nav_item.parent_id, 40);
  assert.equal(redrawn.nav_item.parent_id, 40);
  assert.match(moved.nav_item.icon_svg, /<svg/);
  assert.equal(listed.flat_nav_items.some((item) => item.name === '男裝'), true);
  assert.deepEqual(deleted.deleted_nav_item_ids, [created.nav_item.id]);
});

test('repository requires generated base64 svg icons when creating product categories', async () => {
  const pool = productCatalogPool();
  const repository = new WeblessAccountRepository(pool);

  await assert.rejects(
    () => repository.upsertCategory(11, {
      site_id: 101,
      parent_id: null,
      name: 'AI工具'
    }),
    /icon_svg_base64 is required/
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

test('repository uses committed media paths for product images and rejects base64/url image transport', async () => {
  const pool = productCatalogPool();
  const repository = new WeblessAccountRepository(pool, {
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const product = await repository.upsertProduct(11, {
    site_id: 101,
    site_category_id: 6,
    name: '縮圖測試商品',
    base_price: 1200,
    primary_images: [{
      source: {
        media_path: 'sites/101/mcp-uploads/committed/product-main.png'
      },
      suggested_filename: 'product-main.png'
    }]
  });
  const primaryImage = product.product.primary_images[0];

  assert.equal(primaryImage.url, `https://slimweb.tw/media/${primaryImage.path}`);
  assert.equal(primaryImage.path, 'sites/101/mcp-uploads/committed/product-main.png');

  await assert.rejects(
    () => repository.upsertProduct(11, {
      site_id: 101,
      site_category_id: 6,
      name: '截斷圖片商品',
      base_price: 1000,
      primary_images: [{
        source: {
          data_base64: 'iVBORw0KGgo=',
          mime_type: 'image/png'
        },
        suggested_filename: 'base64.png'
      }]
    }),
    /media_path is required/
  );

  await assert.rejects(
    () => repository.upsertProduct(11, {
      site_id: 101,
      site_category_id: 6,
      name: '假圖商品',
      base_price: 1200,
      primary_images: ['https://slimweb.tw/wp-content/uploads/2025/placeholder-ai-kingjoo-main.png']
    }),
    /source.media_path/
  );
});

test('repository appends product images by default when updating existing products', async () => {
  const pool = productCatalogPool();
  const repository = new WeblessAccountRepository(pool, {
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const created = await repository.upsertProduct(11, {
    site_id: 101,
    site_category_id: 6,
    name: '可追加圖片商品',
    base_price: 1200,
    primary_images: [{
      source: {
        media_path: 'sites/101/mcp-uploads/committed/original-main.png'
      }
    }]
  });

  const updated = await repository.upsertProduct(11, {
    site_id: 101,
    product_id: created.product.id,
    site_category_id: 6,
    name: '可追加圖片商品',
    base_price: 1200,
    primary_images: [{
      source: {
        media_path: 'sites/101/mcp-uploads/committed/new-main.png'
      }
    }]
  });

  assert.deepEqual(updated.product.primary_images.map((image) => image.path), [
    'sites/101/mcp-uploads/committed/original-main.png',
    'sites/101/mcp-uploads/committed/new-main.png'
  ]);
  assert.deepEqual(updated.product.primary_images.map((image) => image.sort_order), [0, 1]);
});

test('repository skips existing product images when appending', async () => {
  const pool = productCatalogPool();
  const repository = new WeblessAccountRepository(pool, {
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const created = await repository.upsertProduct(11, {
    site_id: 101,
    site_category_id: 6,
    name: '可避免重複圖片商品',
    base_price: 1200,
    content_images: [{
      source: {
        media_path: 'sites/101/mcp-uploads/committed/original-content.png'
      }
    }],
    primary_images: [{
      source: {
        media_path: 'sites/101/mcp-uploads/committed/original-main.png'
      }
    }]
  });

  const updated = await repository.upsertProduct(11, {
    site_id: 101,
    product_id: created.product.id,
    site_category_id: 6,
    name: '可避免重複圖片商品',
    base_price: 1200,
    content_images: [{
      source: {
        media_path: 'sites/101/mcp-uploads/committed/original-content.png'
      }
    }, {
      source: {
        media_path: 'sites/101/mcp-uploads/committed/new-content.png'
      }
    }]
  });

  assert.deepEqual(updated.product.content_images.map((image) => image.path), [
    'sites/101/mcp-uploads/committed/original-content.png',
    'sites/101/mcp-uploads/committed/new-content.png'
  ]);
  assert.deepEqual(updated.product.content_images.map((image) => image.sort_order), [0, 1]);
});

test('repository replaces product images when update mode is replace', async () => {
  const pool = productCatalogPool();
  const repository = new WeblessAccountRepository(pool, {
    publicSiteBaseUrl: 'https://slimweb.tw'
  });

  const created = await repository.upsertProduct(11, {
    site_id: 101,
    site_category_id: 6,
    name: '可取代圖片商品',
    base_price: 1200,
    primary_images: [{
      source: {
        media_path: 'sites/101/mcp-uploads/committed/original-main.png'
      }
    }]
  });

  const updated = await repository.upsertProduct(11, {
    site_id: 101,
    product_id: created.product.id,
    site_category_id: 6,
    name: '可取代圖片商品',
    base_price: 1200,
    primary_images_mode: 'replace',
    primary_images: [{
      source: {
        media_path: 'sites/101/mcp-uploads/committed/replacement-main.png'
      }
    }]
  });

  assert.deepEqual(updated.product.primary_images.map((image) => image.path), [
    'sites/101/mcp-uploads/committed/replacement-main.png'
  ]);
  assert.deepEqual(updated.product.primary_images.map((image) => image.sort_order), [0]);
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
              summary: '旗艦智慧電鋼琴',
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
