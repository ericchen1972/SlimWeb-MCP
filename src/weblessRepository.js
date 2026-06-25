import pg from 'pg';
import { createCipheriv, createDecipheriv, createHmac, createSign, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { Agent } from 'undici';

const { Pool } = pg;
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const POSTER_REQUEST_TIMEOUT_MS = 780_000;
const POSTER_POLL_INTERVAL_MS = 5_000;
const POSTER_FETCH_DISPATCHER = new Agent({
  headersTimeout: POSTER_REQUEST_TIMEOUT_MS,
  bodyTimeout: POSTER_REQUEST_TIMEOUT_MS
});
const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GCS_TOKEN_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';
const SEO_SETTINGS_COLUMNS = [
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
];
const PAGE_LIBRARY_BLOCK_START = '<!-- slimweb:page-libraries:start -->';
const PAGE_LIBRARY_BLOCK_END = '<!-- slimweb:page-libraries:end -->';
const PAGE_SUPPORTED_LIBRARY_KEYS = ['animate_css', 'aos', 'swiper', 'gsap', 'scrolltrigger', 'scrollsmoother'];
const PAGE_LIBRARY_ASSETS = {
  animate_css: {
    css: ['https://cdn.jsdelivr.net/npm/animate.css@4.1.1/animate.min.css']
  },
  aos: {
    css: ['https://cdn.jsdelivr.net/npm/aos@2.3.4/dist/aos.css'],
    js: ['https://cdn.jsdelivr.net/npm/aos@2.3.4/dist/aos.js']
  },
  swiper: {
    css: ['https://cdn.jsdelivr.net/npm/swiper@12/swiper-bundle.min.css'],
    js: ['https://cdn.jsdelivr.net/npm/swiper@12/swiper-bundle.min.js']
  },
  gsap: {
    js: ['https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js']
  },
  scrolltrigger: {
    requires: ['gsap'],
    js: ['https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/ScrollTrigger.min.js']
  },
  scrollsmoother: {
    requires: ['gsap', 'scrolltrigger'],
    js: ['https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/ScrollSmoother.min.js']
  }
};
const INTEGRATION_SETTINGS_COLUMNS = [
  'sms_account',
  'sms_password',
  'facebook_app_id',
  'facebook_page_id',
  'facebook_comment_on_products',
  'facebook_comment_on_posts',
  'line_login_channel_id',
  'line_login_channel_secret',
  'google_login_client_id',
  'broadcast_id',
  'use_ai_customer_service',
  'ai_provider',
  'ai_api_key',
  'ai_model_name',
  'google_search_api_key',
  'google_search_engine_id',
  'line_bot_access_token',
  'line_bot_channel_secret',
  'line_bot_user_id',
  'notion_token'
];
const MAIL_TEMPLATE_EVENTS = [
  'order_created',
  'order_shipped',
  'store_arrived',
  'return_requested',
  'return_logistics',
  'registration_code',
  'password_reset'
];
const DEFAULT_MAIL_LAYOUT_HTML = `<div style="margin:0;background:#f6f7f9;padding:32px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2937;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;padding:32px 40px;">
    <div style="display:flex;align-items:center;gap:10px;">
      <img src="{logo_url}" alt="{site_name}" style="width:42px;height:42px;border-radius:50%;object-fit:cover;">
      <span style="font-size:20px;font-weight:600;color:#1677ff;">{site_name}</span>
    </div>
    <hr style="border:0;border-top:1px solid #e5e7eb;margin:26px 0;">
    <main style="font-size:15px;line-height:1.8;color:#1f2937;">{content}</main>
    <hr style="border:0;border-top:1px solid #e5e7eb;margin:32px 0 24px;">
    <footer style="text-align:center;font-size:13px;line-height:1.6;">
      <a href="{site_url}" style="color:#1677ff;text-decoration:none;">{site_url}</a>
    </footer>
  </div>
</div>`;
const BASIC_SETTINGS_COLUMNS = [
  'site_status',
  'member_verification',
  'website_type',
  'default_country_code',
  'product_load_mode',
  'return_days_allowed',
  'product_category_depth'
];
const MAIL_DELIVERY_SETTINGS_COLUMNS = [
  'notification_new_order_sms_numbers',
  'notification_sms_on_shipped',
  'notification_auto_send_reminder_sms',
  'notification_reminder_sms_content',
  'notification_smtp_host',
  'notification_smtp_username',
  'notification_smtp_password',
  'notification_smtp_port',
  'notification_smtp_from_email',
  'notification_smtp_ssl'
];
const PAYMENT_PROVIDER_DEFINITIONS = [
  { provider: 'ecpay', label: '綠界 ECPay', requires_hash_iv: true, online_card_exclusive: true, sort_order: 10 },
  { provider: 'newebpay', label: '藍新 NewebPay', requires_hash_iv: true, online_card_exclusive: true, sort_order: 20 },
  { provider: 'linepay', label: 'LINE Pay', requires_hash_iv: false, online_card_exclusive: false, sort_order: 30 }
];
const LOGISTICS_PROVIDER_DEFINITIONS = [
  {
    provider: 'ecpay',
    label: '綠界物流',
    requires_hash_iv: false,
    sort_order: 10,
    supported_store_types: ['seven', 'family', 'hilife', 'ok'],
    supports_logistics_type: true,
    follows_payment_provider: true,
    logistics_type_options: ['c2c', 'b2c'],
    note: '綠界超商物流可選 7-11、全家、萊爾富、OK。C2C 店到店與 B2C 大宗寄倉需與綠界後台申請的物流型態一致；若需建立逆物流，請使用 B2C。'
  },
  {
    provider: 'newebpay',
    label: '藍新物流',
    requires_hash_iv: false,
    sort_order: 20,
    supported_store_types: ['seven', 'family', 'hilife'],
    supports_logistics_type: false,
    follows_payment_provider: true,
    logistics_type_options: [],
    note: '藍新物流目前建議選擇 7-11、全家、萊爾富；可用通路與寄件模式以藍新後台啟用項目為準，不要把 OK 當成藍新預設可用通路。'
  },
  {
    provider: 'hct',
    label: '新竹物流',
    requires_hash_iv: false,
    sort_order: 40,
    supported_store_types: [],
    supports_logistics_type: false,
    follows_payment_provider: false,
    logistics_type_options: [],
    note: '新竹物流為宅配物流；若 collect_payment_enabled 為 true，前台可顯示貨到付款。'
  }
];
const ONLINE_CARD_PAYMENT_PROVIDERS = PAYMENT_PROVIDER_DEFINITIONS
  .filter((provider) => provider.online_card_exclusive)
  .map((provider) => provider.provider);
const ORDER_STATUS_LABELS = {
  pending: '待處理',
  confirmed: '已完成',
  returning: '退貨中',
  returned: '已完成退貨',
  cancelled: '已取消'
};
const WORKFLOW_STATUS_LABELS = {
  pending: '待處理',
  created: '已建立',
  exception: '異常',
  completed: '已完成',
  cancelled: '已取消'
};
const PAYMENT_METHOD_LABELS = {
  home_delivery_online_payment: '宅配線上付款',
  cvs_pickup_online_payment: '線上付款超商取貨',
  cvs_pickup_cod: '超商取貨付款',
  home_delivery_linepay: '宅配 LINE Pay',
  cvs_pickup_linepay: 'LINE Pay 超商取貨',
  cod_home_delivery: '宅配貨到付款',
  online_payment: '線上付款',
  linepay: 'LINE Pay'
};
const ORDER_DATE_FIELDS = [
  'payment_completed_at',
  'logistics_completed_at',
  'return_requested_at',
  'return_cancelled_at',
  'return_completed_at',
  'refund_completed_at',
  'placed_at',
  'created_at'
];
const MASKED_PROVIDER_CREDENTIAL = '••••••••••••••••';
const FIXED_TEMPLATE_PAGE_KEYS = new Set([
  'index',
  'profile',
  'order_history',
  'cart',
  'checkout',
  'checkout_complete',
  'products',
  'product_detail',
  'login',
  'register',
  'register_verify',
  'articles',
  'article_view',
  'ai_support'
]);
const ADMIN_PERMISSION_KEYS = [
  'system_admin',
  'backend_ai_assistant',
  'basic_settings',
  'seo_settings',
  'integration_settings',
  'terms',
  'mail_settings',
  'shipping_settings',
  'message_notifications',
  'payment_logistics',
  'page_management',
  'page_management_navbar',
  'page_management_templates',
  'page_management_pages',
  'page_management_external_assets',
  'product_management',
  'product_management_categories',
  'product_management_products',
  'product_management_add_ons',
  'product_management_import',
  'member_management',
  'member_list',
  'member_tiers',
  'member_coupons',
  'member_sql',
  'order_management',
  'order_list',
  'return_requests',
  'discount_management',
  'coupon_templates',
  'discount_codes',
  'threshold_gifts',
  'article_management',
  'article_list',
  'ai_management',
  'ai_customer_service',
  'ai_marketing_email',
  'customer_service_logs',
  'system_docs'
];

function normalizeSiteStatus(status) {
  return status === 'maintenance' ? 'maintenance' : 'active';
}

function siteStatusLabel(status) {
  return normalizeSiteStatus(status) === 'maintenance' ? '維護中' : '正常運作';
}

function normalizeSiteThemeMode(value) {
  return String(value ?? 'light').trim() === 'dark' ? 'dark' : 'light';
}

export function databaseConfigFromEnv(env = process.env) {
  const sslMode = String(env.DB_SSLMODE ?? '').toLowerCase();
  const config = {
    host: env.DB_HOST,
    port: env.DB_PORT ? Number.parseInt(env.DB_PORT, 10) : undefined,
    database: env.DB_DATABASE,
    user: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    max: 3
  };

  if (sslMode === 'require') {
    config.ssl = {
      rejectUnauthorized: false
    };
  }

  return config;
}

export class WeblessAccountRepository {
  constructor(pool = new Pool(databaseConfigFromEnv()), options = {}) {
    this.pool = pool;
    this.storage = options.storage ?? createStorageAdapter(options);
    this.publicSiteBaseUrl = (options.publicSiteBaseUrl ?? process.env.WEBLESS_PUBLIC_BASE_URL ?? 'https://slimweb.tw').replace(/\/+$/, '');
    this.weblessAppBaseUrl = (options.weblessAppBaseUrl ?? process.env.WEBLESS_APP_BASE_URL ?? this.publicSiteBaseUrl).replace(/\/+$/, '');
    this.clientMcpBaseUrl = (options.clientMcpBaseUrl ?? process.env.SLIMWEB_CLIENT_MCP_BASE_URL ?? '').replace(/\/+$/, '');
    this.weblessMcpSecret = options.weblessMcpSecret ?? process.env.WEBLESS_MCP_SECRET ?? '';
    this.laravelAppKey = options.laravelAppKey ?? process.env.WEBLESS_APP_KEY ?? process.env.LARAVEL_APP_KEY ?? process.env.APP_KEY ?? '';
    this.fetch = options.fetchImpl ?? fetch;
    this.logger = options.logger ?? console;
    this.posterPollIntervalMs = Number.isFinite(Number(options.posterPollIntervalMs))
      ? Math.max(0, Number(options.posterPollIntervalMs))
      : POSTER_POLL_INTERVAL_MS;
  }

  async upsertGoogleAccount(profile) {
    const result = await this.pool.query(
      `
        insert into accounts (google_id, email, name)
        values ($1, $2, $3)
        on conflict (google_id)
        do update set email = excluded.email, name = excluded.name
        returning id, google_id, email, name
      `,
      [profile.sub, profile.email, profile.name]
    );

    return result.rows[0];
  }

  async listAdminSitesForGoogleProfile(profile) {
    return this.listSitesForAdminIdentity({
      email: profile.email,
      name: profile.name,
      google_id: profile.sub
    });
  }

  async listSitesForAdminIdentity(identity) {
    const result = await this.pool.query(
      `
        select
          s.id,
          s.slug,
          s.name,
          s.domain,
          s.callback_code,
          s.site_status,
          s.theme_mode,
          s.icon_path,
          s.account_id,
          a.id as site_admin_id,
          a.google_email,
          a.google_sub,
          a.permissions,
          (
            select first_admin.id
            from site_admins first_admin
            where first_admin.site_id = s.id
            order by first_admin.id asc
            limit 1
          ) as first_admin_id
        from site_admins a
        inner join sites s on s.id = a.site_id
        where (
          ($1 <> '' and a.google_sub = $1)
          or lower(a.google_email) = lower($2)
        )
        order by s.id asc, a.id asc
      `,
      [String(identity.google_id ?? ''), String(identity.email ?? '')]
    );

    return result.rows
      .map((row) => formatAdminSite(row, this.clientMcpBaseUrl))
      .filter((site) => site.permissions.includes('backend_ai_assistant'));
  }

  async selectSiteForAdminIdentity(identity, args) {
    const actor = await this.resolveAdminSiteForIdentity(identity, args);
    const themes = await this.listThemesForSite(actor.site_id);

    return {
      selected_site: actor.site,
      site_admin_id: actor.site_admin_id,
      permissions: actor.permissions,
      themes,
      requires_site_code_for_mutations: true
    };
  }

  async resolveAdminSiteForIdentity(identity, args) {
    const siteCode = String(args.site_code ?? '').trim();
    const siteId = siteCode === '' ? requireInteger(args.site_id, 'site_id') : null;
    const siteWhere = siteCode === ''
      ? 's.id = $1'
      : 's.callback_code = $1';
    const siteLookupValue = siteCode === '' ? siteId : siteCode;
    const result = await this.pool.query(
      `
        select
          s.id,
          s.slug,
          s.name,
          s.domain,
          s.callback_code,
          s.site_status,
          s.theme_mode,
          s.icon_path,
          s.account_id,
          a.id as site_admin_id,
          a.google_email,
          a.google_sub,
          a.permissions,
          (
            select first_admin.id
            from site_admins first_admin
            where first_admin.site_id = s.id
            order by first_admin.id asc
            limit 1
          ) as first_admin_id
        from site_admins a
        inner join sites s on s.id = a.site_id
        where ${siteWhere}
          and (
            ($2 <> '' and a.google_sub = $2)
            or lower(a.google_email) = lower($3)
          )
        order by a.id asc
        limit 1
      `,
      [siteLookupValue, String(identity.google_id ?? ''), String(identity.email ?? '')]
    );
    const row = result.rows[0];

    if (!row) {
      throw codedError('NOT_FOUND', `Site not found or not accessible: ${siteLookupValue}`);
    }

    const site = formatAdminSite(row, this.clientMcpBaseUrl);

    return {
      ...identity,
      account_id: site.account_id ?? identity.account_id,
      site_admin_id: site.site_admin_id,
      site_id: site.site_id,
      permissions: site.permissions,
      site
    };
  }

  async listSitesForAccount(accountId) {
    const result = await this.pool.query(
      `
        select id, slug, name, domain, callback_code, site_status, theme_mode, icon_path
        from sites
        where account_id = $1
        order by id asc
      `,
      [accountId]
    );

    return result.rows.map((site) => ({
      id: site.id,
      slug: site.slug,
      name: site.name,
      domain: site.domain,
      callback_code: site.callback_code ?? null,
      client_mcp_url: clientMcpUrlForSite(site, this.clientMcpBaseUrl),
      site_status: normalizeSiteStatus(site.site_status),
      site_status_label: siteStatusLabel(site.site_status),
      theme_mode: normalizeSiteThemeMode(site.theme_mode)
    }));
  }

  async selectSiteForAccount(accountId, args) {
    const site = args.site_code
      ? await this.getSiteForAccountCode(accountId, String(args.site_code))
      : await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const themes = await this.listThemesForSite(site.id);

    return {
      selected_site: site,
      themes,
      requires_site_code_for_mutations: true
    };
  }

  async getSiteForAccountCode(accountId, siteCode) {
    const result = await this.pool.query(
      `
        select id, slug, name, domain, callback_code, site_status, theme_mode, icon_path
        from sites
        where account_id = $1 and callback_code = $2
        limit 1
      `,
      [accountId, siteCode]
    );
    const site = result.rows[0];

    if (!site) {
      throw codedError('NOT_FOUND', `Site not found or not accessible: ${siteCode}`);
    }

    return formatSite(site, this.clientMcpBaseUrl);
  }

  async listThemesForAccountSite(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const themes = (await this.listThemesForSite(site.id)).filter((theme) => !theme.is_default);

    return {
      site,
      site_theme_mode: site.theme_mode,
      themes
    };
  }

  async getSiteThemeMode(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));

    return {
      site,
      theme_mode: site.theme_mode,
      scope: 'site',
      applies_to: ['Default', 'custom_style_schemes']
    };
  }

  async getDesignContext(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const theme = await this.resolveThemeForSite(site.id);
    const profile = await this.findThemeStyleProfile(theme.id);

    return {
      site,
      theme,
      design_summary: profile?.summary?.trim() || '尚未設定設計摘要',
      color_mode: site.theme_mode,
      color_mode_label: site.theme_mode === 'dark' ? '黑暗' : '明亮',
      framework: 'Tailwind'
    };
  }

  async updateSiteThemeMode(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const themeMode = normalizeSiteThemeMode(args.theme_mode);

    const result = await this.pool.query(
      `
        update sites
        set theme_mode = $2, updated_at = now()
        where id = $1
        returning id, slug, name, domain, callback_code, site_status, theme_mode
      `,
      [site.id, themeMode]
    );

    const updatedSite = formatSite(result.rows[0], this.clientMcpBaseUrl);

    return {
      ok: true,
      site: updatedSite,
      theme_mode: updatedSite.theme_mode,
      scope: 'site',
      note: 'Style schemes inherit this site-level color mode. Do not store light/dark on site_pages.'
    };
  }

  async createThemeFromDefault(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const name = requireThemeName(args.name);

    await this.pool.query('BEGIN');

    try {
      const sortOrder = await this.nextThemeSortOrder(site.id);
      const result = await this.pool.query(
        `
          insert into site_pages (
            site_id,
            name,
            is_default,
            is_active,
            theme_mode,
            navbar_source_type,
            mega_menu_source_type,
            footer_source_type,
            support_source_type,
            body_template_code,
            sort_order
          )
          values ($1, $2, false, false, $3, 'default', 'default', 'default', 'default', null, $4)
          returning id, site_id, name, is_default, is_active, theme_mode
        `,
        [site.id, name, 'light', sortOrder]
      );
      const theme = formatTheme(result.rows[0]);

      await this.copyDefaultTemplateToTheme(site.id, theme.id);
      await this.pool.query('COMMIT');

      return {
        site,
        theme,
        copied_from_default: true,
        copied_scope: 'theme_shell_only',
        content_fallback: 'site_level_homepage',
        inherits_site_theme_mode: true,
        site_theme_mode: site.theme_mode,
        source_theme: 'Default',
        preview_url: this.previewUrlFor(site, 'profile', theme.id)
      };
    } catch (error) {
      await this.pool.query('ROLLBACK');
      throw error;
    }
  }

  async deleteTheme(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const theme = await this.resolveThemeForSite(site.id, requireInteger(args.theme_id, 'theme_id'));

    if (theme.is_default) {
      throw codedError('VALIDATION_FAILED', 'Default theme cannot be deleted.');
    }

    await this.pool.query('BEGIN');

    try {
      await this.pool.query('delete from site_theme_style_profiles where site_page_id = $1', [theme.id]);
      await this.pool.query('delete from site_pages where site_id = $1 and id = $2', [site.id, theme.id]);

      if (theme.is_active) {
        await this.pool.query(
          `
            update site_pages
            set is_active = true, updated_at = now()
            where site_id = $1 and is_default = true
          `,
          [site.id]
        );
      }

      await this.pool.query('COMMIT');
    } catch (error) {
      await this.pool.query('ROLLBACK');
      throw error;
    }

    await this.storage.deleteDirectory(`sites/${site.id}/templates/schemes/${theme.id}`);

    return {
      ok: true,
      site,
      deleted_theme_id: theme.id,
      themes: await this.listThemesForSite(site.id)
    };
  }

  async activateTheme(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const theme = await this.resolveThemeForSite(site.id, args.theme_id);

    await this.pool.query('BEGIN');

    try {
      await this.pool.query(
        `
          update site_pages
          set is_active = false, updated_at = now()
          where site_id = $1 and is_active = true
        `,
        [site.id]
      );

      const result = await this.pool.query(
        `
          update site_pages
          set is_active = true, updated_at = now()
          where site_id = $1 and id = $2
          returning id, site_id, name, is_default, is_active, theme_mode
        `,
        [site.id, theme.id]
      );

      await this.pool.query('COMMIT');

      const activatedTheme = formatTheme(result.rows[0]);

      return {
        ok: true,
        site,
        theme: activatedTheme,
        themes: await this.listThemesForSite(site.id),
        preview_url: this.previewUrlFor(site, 'profile', activatedTheme.id)
      };
    } catch (error) {
      await this.pool.query('ROLLBACK');
      throw error;
    }
  }

  async updateThemeRootElements(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const theme = await this.resolveThemeForSite(site.id, args.theme_id);

    const fragments = normalizeRootFragments(args.fragments);
    const updatedFragments = [];

    for (const [fragment, html] of Object.entries(fragments)) {
      await this.storage.write(rootElementStoragePath(theme, fragment), Buffer.from(html.trim() + '\n', 'utf8'), 'text/x-php; charset=utf-8');
      updatedFragments.push(fragment);
    }

    if (typeof args.css === 'string' && args.css.trim() !== '') {
      await this.storage.write(`${themeDirectory(theme)}/assets/root-elements/css/00-mcp-theme.css`, Buffer.from(args.css.trim() + '\n', 'utf8'), 'text/css; charset=utf-8');
    }

    return {
      ok: true,
      site,
      theme,
      updated_fragments: updatedFragments,
      updated_css: typeof args.css === 'string' && args.css.trim() !== '',
      preview_url: this.previewUrlFor(site, 'profile', theme.id)
    };
  }

  async getThemeShellContext(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const theme = await this.resolveThemeForSite(site.id, args.theme_id);
    const [navItems, categories, siteDetails] = await Promise.all([
      this.listSiteNavItems(site.id),
      this.listSiteCategories(site.id),
      this.getSiteDesignDetails(site.id)
    ]);
    const currentRootCss = await this.getThemeManagedRootCss(theme);

    const contactItems = contactItemsFromSiteDetails(siteDetails);

    return {
      reference_only: true,
      usage_rule: 'Use this JSON to understand real storefront data shape while designing. Do not hard-code these records into page or theme content.',
      site,
      theme,
      theme_scope: {
        root_elements: ['navbar', 'body_background', 'online_support', 'footer'],
        content_fallback: theme.is_default ? null : 'default',
        page_body_rule: 'Non-Default themes inherit Default page content unless a page-specific body is explicitly created.'
      },
      navbar: {
        counts: {
          total_items: navItems.length,
          top_level_items: navItems.filter((item) => item.parent_id === null).length,
          icon_items: navItems.filter((item) => item.icon_svg || item.icon_path).length
        },
        item_names: navItems.map((item) => item.name),
        tree: buildTree(navItems)
      },
      product_categories: {
        counts: {
          total_items: categories.length,
          top_level_items: categories.filter((category) => category.parent_id === null).length,
          image_items: categories.filter((category) => category.image_path).length,
          icon_items: categories.filter((category) => category.icon_svg || category.icon_path).length
        },
        item_names: categories.map((category) => category.name),
        tree: buildTree(categories)
      },
      storefront_actions: {
        cart_button: true,
        register_button: true,
        login_button: true,
        account_entry: true
      },
      footer: {
        counts: {
          contact_items: contactItems.length,
          social_links: contactItems.filter((item) => item.kind === 'social').length
        },
        contact_items: contactItems
      },
      root_css: {
        current_css: currentRootCss,
        update_tool: 'slimweb_themes_update_root_elements',
        update_field: 'css'
      },
      online_support: {
        enabled: Boolean(siteDetails.use_ai_customer_service)
      }
    };
  }

  async getThemeStyleProfile(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const theme = await this.resolveThemeForSite(site.id, args.theme_id);
    const profile = await this.findThemeStyleProfile(theme.id);

    return {
      site,
      theme,
      profile
    };
  }

  async upsertThemeStyleProfile(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const actorAccountId = requireActorAccountId(site.account_id ?? accountId);
    const theme = await this.resolveThemeForSite(site.id, args.theme_id);
    const userRequests = normalizeUserRequests(args.user_requests ?? (args.user_request ? [{ request: args.user_request }] : []));
    const visualKeywords = normalizeStringArray(args.visual_keywords);

    const result = await this.pool.query(
      `
        insert into site_theme_style_profiles (
          site_id,
          site_page_id,
          summary,
          target_audience,
          visual_keywords,
          color_notes,
          typography_notes,
          layout_notes,
          illustration_notes,
          avoid_notes,
          user_requests,
          ai_design_notes,
          created_by_account_id,
          updated_by_account_id
        )
        values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $13)
        on conflict (site_page_id)
        do update set
          summary = coalesce(excluded.summary, site_theme_style_profiles.summary),
          target_audience = coalesce(excluded.target_audience, site_theme_style_profiles.target_audience),
          visual_keywords = coalesce(excluded.visual_keywords, site_theme_style_profiles.visual_keywords),
          color_notes = coalesce(excluded.color_notes, site_theme_style_profiles.color_notes),
          typography_notes = coalesce(excluded.typography_notes, site_theme_style_profiles.typography_notes),
          layout_notes = coalesce(excluded.layout_notes, site_theme_style_profiles.layout_notes),
          illustration_notes = coalesce(excluded.illustration_notes, site_theme_style_profiles.illustration_notes),
          avoid_notes = coalesce(excluded.avoid_notes, site_theme_style_profiles.avoid_notes),
          user_requests = coalesce(excluded.user_requests, site_theme_style_profiles.user_requests),
          ai_design_notes = coalesce(excluded.ai_design_notes, site_theme_style_profiles.ai_design_notes),
          updated_by_account_id = excluded.updated_by_account_id,
          version = site_theme_style_profiles.version + 1,
          updated_at = now()
        returning *
      `,
      [
        site.id,
        theme.id,
        nullableString(args.summary),
        nullableString(args.target_audience),
        JSON.stringify(visualKeywords),
        nullableString(args.color_notes),
        nullableString(args.typography_notes),
        nullableString(args.layout_notes),
        nullableString(args.illustration_notes),
        nullableString(args.avoid_notes),
        JSON.stringify(userRequests),
        nullableString(args.ai_design_notes),
        actorAccountId
      ]
    );

    return {
      ok: true,
      site,
      theme,
      profile: formatStyleProfile(result.rows[0])
    };
  }

  async appendThemeStyleProfileRequest(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const actorAccountId = requireActorAccountId(site.account_id ?? accountId);
    const theme = await this.resolveThemeForSite(site.id, args.theme_id);
    const entry = normalizeUserRequestEntry({
      request: args.request,
      ai_notes: args.ai_notes,
      recorded_at: new Date().toISOString()
    });
    const existing = await this.findThemeStyleProfile(theme.id);

    if (!existing) {
      return this.upsertThemeStyleProfile(accountId, {
        site_id: site.id,
        theme_id: theme.id,
        user_requests: [entry]
      });
    }

    const nextRequests = [...normalizeUserRequests(existing.user_requests), entry];
    const result = await this.pool.query(
      `
        update site_theme_style_profiles
        set user_requests = $1::jsonb,
            updated_by_account_id = $2,
            version = version + 1,
            updated_at = now()
        where site_page_id = $3
        returning *
      `,
      [JSON.stringify(nextRequests), actorAccountId, theme.id]
    );

    return {
      ok: true,
      site,
      theme,
      profile: formatStyleProfile(result.rows[0])
    };
  }

  async getSeoSettings(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const settings = await this.findSeoSettingsForSite(site.id);

    return {
      site,
      settings
    };
  }

  async getSiteReadiness(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const includeOptional = Boolean(args.include_optional);
    const [
      basicSettings,
      seoSettings,
      integrationSettings,
      mailDeliverySettings,
      mailLayout,
      paymentProviders,
      logisticsProviders,
      counts
    ] = await Promise.all([
      this.findBasicSettingsForSite(site.id),
      this.findSeoSettingsForSite(site.id),
      this.findIntegrationSettingsForSite(site.id),
      this.findMailDeliverySettingsForSite(site.id),
      this.findMailLayoutForSite(site.id),
      this.listPaymentProvidersForSite(site.id),
      this.listLogisticsProvidersForSite(site.id),
      this.getReadinessCountsForSite(site.id)
    ]);

    return buildSiteReadinessReport({
      site,
      basicSettings,
      seoSettings,
      integrationSettings,
      mailDeliverySettings,
      mailLayout,
      paymentProviders,
      logisticsProviders,
      counts,
      includeOptional
    });
  }

  async updateSeoSettings(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const current = await this.findSeoSettingsForSite(site.id);
    const next = normalizeSeoSettings(args, current);

    const result = await this.pool.query(
      `
        update sites
        set
          seo_title = $1,
          seo_description = $2,
          seo_keywords = $3,
          canonical_url = $4,
          robots_policy = $5,
          og_title = $6,
          og_description = $7,
          og_image_url = $8,
          llms_txt = $9,
          aeo_business_summary = $10,
          aeo_target_audience = $11,
          aeo_products_services = $12,
          aeo_customer_questions = $13,
          aeo_answer_style = $14,
          aeo_entity_facts = $15,
          geo_citation_targets = $16,
          geo_verifiable_claims = $17,
          geo_trust_signals = $18,
          geo_same_as_profiles = $19,
          geo_comparison_positioning = $20,
          updated_at = now()
        where id = $21
        returning ${SEO_SETTINGS_COLUMNS.join(', ')}
      `,
      [
        next.seo_title,
        next.seo_description,
        next.seo_keywords,
        next.canonical_url,
        next.robots_policy,
        next.og_title,
        next.og_description,
        next.og_image_url,
        next.llms_txt,
        next.aeo_business_summary,
        next.aeo_target_audience,
        next.aeo_products_services,
        next.aeo_customer_questions,
        next.aeo_answer_style,
        next.aeo_entity_facts,
        next.geo_citation_targets,
        next.geo_verifiable_claims,
        next.geo_trust_signals,
        next.geo_same_as_profiles,
        next.geo_comparison_positioning,
        site.id
      ]
    );

    return {
      ok: true,
      site,
      settings: formatSeoSettings(result.rows[0] ?? next)
    };
  }

  async getIntegrationSettings(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const settings = await this.findIntegrationSettingsForSite(site.id);

    return {
      site,
      settings
    };
  }

  async getFacebookSettings(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const settings = pickFacebookSettings(await this.findIntegrationSettingsForSite(site.id));

    return {
      site,
      settings
    };
  }

  async getNotionSettings(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const settings = pickNotionSettings(await this.findIntegrationSettingsForSite(site.id));

    return {
      site,
      settings
    };
  }

  async getMailDeliverySettings(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const settings = await this.findMailDeliverySettingsForSite(site.id);

    return {
      site,
      settings
    };
  }

  async getMailTemplates(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));

    return {
      site,
      layout_rule: 'There is only one shared email layout. These templates are event-specific subjects and contents rendered into that layout.',
      templates: await this.listMailTemplatesForSite(site.id)
    };
  }

  async updateMailTemplates(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const updates = normalizeMailTemplateUpdates(args.templates);

    await this.pool.query('BEGIN');
    try {
      for (const update of updates) {
        const current = await this.pool.query(
          'select * from mail_templates where site_id = $1 and trigger_event = $2 limit 1',
          [site.id, update.trigger_event]
        );
        const row = current.rows[0] ?? {};
        const subject = Object.prototype.hasOwnProperty.call(update, 'subject') ? update.subject : (row.subject ?? defaultMailTemplate(update.trigger_event).subject);
        const content = Object.prototype.hasOwnProperty.call(update, 'content') ? update.content : (row.content ?? defaultMailTemplate(update.trigger_event).content);
        const isActive = Object.prototype.hasOwnProperty.call(update, 'is_active') ? update.is_active : (row.is_active ?? true);

        await this.pool.query(
          `
            insert into mail_templates (site_id, trigger_event, subject, content, is_active, created_at, updated_at)
            values ($1, $2, $3, $4, $5, now(), now())
            on conflict (site_id, trigger_event)
            do update set subject = excluded.subject,
                          content = excluded.content,
                          is_active = excluded.is_active,
                          updated_at = now()
          `,
          [site.id, update.trigger_event, subject, content, isActive]
        );
      }
      await this.pool.query('COMMIT');
    } catch (error) {
      await this.pool.query('ROLLBACK');
      throw error;
    }

    return {
      ok: true,
      site,
      templates: await this.listMailTemplatesForSite(site.id)
    };
  }

  async getMailLayout(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const layout = await this.findMailLayoutForSite(site.id);

    return {
      site,
      layout,
      default_layout_html: DEFAULT_MAIL_LAYOUT_HTML,
      placeholders: ['{content}', '{site_name}', '{site_url}', '{logo_url}'],
      rule: 'Only one shared layout exists per site. Event-specific mail_templates.content is inserted into {content}.'
    };
  }

  async updateMailLayout(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const html = String(args.html ?? '').trim();
    if (html === '') {
      throw codedError('VALIDATION_FAILED', 'html is required.');
    }

    const result = await this.pool.query(
      `
        insert into site_mail_layouts (site_id, html, is_active, created_at, updated_at)
        values ($1, $2, $3, now(), now())
        on conflict (site_id)
        do update set html = excluded.html,
                      is_active = excluded.is_active,
                      updated_at = now()
        returning *
      `,
      [site.id, html, Boolean(args.is_active)]
    );

    return {
      ok: true,
      site,
      layout: formatMailLayout(result.rows[0]),
      default_layout_html: DEFAULT_MAIL_LAYOUT_HTML
    };
  }

  async updateMailDeliverySettings(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const current = await this.findMailDeliverySettingsForSite(site.id);
    const next = normalizeMailDeliverySettings(args, current);

    const result = await this.pool.query(
      `
        update sites
        set
          notification_new_order_sms_numbers = $1,
          notification_sms_on_shipped = $2,
          notification_auto_send_reminder_sms = $3,
          notification_reminder_sms_content = $4,
          notification_smtp_host = $5,
          notification_smtp_username = $6,
          notification_smtp_password = $7,
          notification_smtp_port = $8,
          notification_smtp_from_email = $9,
          notification_smtp_ssl = $10,
          updated_at = now()
        where id = $11
        returning ${MAIL_DELIVERY_SETTINGS_COLUMNS.join(', ')}
      `,
      [
        next.notification_new_order_sms_numbers,
        next.notification_sms_on_shipped,
        next.notification_auto_send_reminder_sms,
        next.notification_reminder_sms_content,
        next.notification_smtp_host,
        next.notification_smtp_username,
        next.notification_smtp_password,
        next.notification_smtp_port,
        next.notification_smtp_from_email,
        next.notification_smtp_ssl,
        site.id
      ]
    );

    return {
      ok: true,
      site,
      settings: formatMailDeliverySettings(result.rows[0] ?? next)
    };
  }

  async updateFacebookSettings(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const current = await this.findIntegrationSettingsForSite(site.id);
    const next = normalizeIntegrationSettings(args, current);
    const result = await this.persistIntegrationSettings(site.id, next);

    return {
      ok: true,
      site,
      settings: pickFacebookSettings(result)
    };
  }

  async updateNotionSettings(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const current = await this.findIntegrationSettingsForSite(site.id);
    const next = normalizeIntegrationSettings(args, current);
    const result = await this.persistIntegrationSettings(site.id, next);

    return {
      ok: true,
      site,
      settings: pickNotionSettings(result)
    };
  }

  async getPaymentLogisticsSettings(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const [paymentProviders, logisticsProviders] = await Promise.all([
      this.listPaymentProvidersForSite(site.id),
      this.listLogisticsProvidersForSite(site.id)
    ]);

    return {
      site,
      supported_payment_providers: supportedPaymentProviders(),
      supported_logistics_providers: supportedLogisticsProviders(),
      online_card_exclusive_providers: ONLINE_CARD_PAYMENT_PROVIDERS,
      linepay_exempt_from_card_exclusivity: true,
      answer_policy: paymentLogisticsAnswerPolicy(),
      callback_urls: paymentLogisticsCallbackUrls(site),
      payment_providers: paymentProviders,
      logistics_providers: logisticsProviders
    };
  }

  async updatePaymentLogisticsSettings(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const paymentUpdates = normalizePaymentProviderUpdates(args.payments);
    const logisticsUpdates = normalizeLogisticsProviderUpdates(args.logistics);

    assertOnlyOneOnlineCardPaymentEnabled(paymentUpdates);
    await this.pool.query('BEGIN');

    try {
      for (const update of paymentUpdates) {
        await this.upsertPaymentProvider(site.id, update);

        if (update.is_enabled && ONLINE_CARD_PAYMENT_PROVIDERS.includes(update.provider)) {
          await this.pool.query(
            `
              update site_payment_providers
              set is_enabled = false, updated_at = now()
              where site_id = $1
                and provider = any($2::text[])
                and provider != $3
            `,
            [site.id, ONLINE_CARD_PAYMENT_PROVIDERS, update.provider]
          );
          await this.pool.query(
            `
              update site_logistics_providers
              set is_enabled = false, updated_at = now()
              where site_id = $1
                and provider = any($2::text[])
                and provider != $3
            `,
            [site.id, ONLINE_CARD_PAYMENT_PROVIDERS, update.provider]
          );
        }

        if (ONLINE_CARD_PAYMENT_PROVIDERS.includes(update.provider)) {
          await this.pool.query(
            `
              update site_logistics_providers
              set mode = $3, is_enabled = $4, updated_at = now()
              where site_id = $1 and provider = $2
            `,
            [site.id, update.provider, update.mode, update.is_enabled]
          );
        }
      }

      for (const update of logisticsUpdates) {
        await this.upsertLogisticsProvider(site.id, update);
      }

      await this.pool.query('COMMIT');
    } catch (error) {
      await this.pool.query('ROLLBACK');
      throw error;
    }

    const [paymentProviders, logisticsProviders] = await Promise.all([
      this.listPaymentProvidersForSite(site.id),
      this.listLogisticsProvidersForSite(site.id)
    ]);

    return {
      ok: true,
      site,
      supported_payment_providers: supportedPaymentProviders(),
      supported_logistics_providers: supportedLogisticsProviders(),
      online_card_exclusive_providers: ONLINE_CARD_PAYMENT_PROVIDERS,
      linepay_exempt_from_card_exclusivity: true,
      answer_policy: paymentLogisticsAnswerPolicy(),
      callback_urls: paymentLogisticsCallbackUrls(site),
      payment_providers: paymentProviders,
      logistics_providers: logisticsProviders
    };
  }

  async listOrders(accountId, args, scope = 'orders') {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const limit = Math.min(requireOptionalPositiveInteger(args.limit, 'limit') ?? 20, 20);
    const offset = requireOptionalNonNegativeInteger(args.offset, 'offset') ?? 0;
    const statuses = normalizeOrderStatuses(args.statuses);
    const [paymentProviders, logisticsProviders] = await Promise.all([
      this.listPaymentProvidersForSite(site.id),
      this.listLogisticsProvidersForSite(site.id)
    ]);

    const where = ['site_id = $1'];
    const params = [site.id];

    if (scope === 'returns') {
      where.push('return_requested_at is not null');
      where.push('return_cancelled_at is null');
    } else {
      where.push('(return_requested_at is null or return_cancelled_at is not null)');
    }

    applyOrderListFilters(where, params, args, statuses);

    const countResult = await this.pool.query(
      `
        select count(*)::int as total
        from orders
        where ${where.join(' and ')}
      `,
      params
    );
    const total = Number.parseInt(countResult.rows[0]?.total ?? '0', 10);
    const filters = normalizedOrderListFilters(args, statuses, limit, offset);

    if (total > 20) {
      return {
        site,
        scope,
        filters,
        total,
        too_many: true,
        message: 'Order search matched more than 20 orders. Ask the user to open the admin backend and narrow the search.',
        orders: []
      };
    }

    params.push(limit);
    const limitIndex = params.length;
    params.push(offset);
    const offsetIndex = params.length;

    const result = await this.pool.query(
      `
        select orders.*,
               ${orderDateDisplaySelectSql()}
        from orders
        where ${where.join(' and ')}
        order by placed_at desc nulls last, created_at desc, id desc
        limit $${limitIndex} offset $${offsetIndex}
      `,
      params
    );
    const orders = result.rows.map((order) => formatOrderForMcp(order, {
      paymentProviders,
      logisticsProviders,
      includeReturnActions: scope === 'returns'
    }));

    return {
      site,
      scope,
      filters,
      total,
      too_many: false,
      orders
    };
  }

  async calculateOrderProfitStatistics(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const dateFrom = requireOptionalDate(args.date_from, 'date_from');
    const dateTo = requireOptionalDate(args.date_to, 'date_to');
    const siteSettings = await this.pool.query(
      'select shipping_fee from sites where id = $1 limit 1',
      [site.id]
    );
    const shippingCost = Math.max(0, Number.parseInt(siteSettings.rows[0]?.shipping_fee ?? '0', 10) || 0);
    const result = await this.pool.query(
      `
        select o.id,
               o.order_no,
               o.grand_total_amount,
               o.shipping_fee_amount,
               coalesce(sum(coalesce(p.cost_price, 0) * coalesce(oi.quantity, 0)), 0)::bigint as product_cost_total,
               count(oi.id)::int as item_count,
               bool_or(oi.id is null or p.id is null or coalesce(p.cost_price, 0) <= 0) as has_missing_cost
        from orders o
        left join order_items oi on oi.order_id = o.id
        left join products p on p.id = oi.product_id
        where o.site_id = $1
          and o.payment_completed_at is not null
          and coalesce(o.status, '') <> 'cancelled'
          and ($2::date is null or coalesce(o.placed_at, o.created_at)::date >= $2::date)
          and ($3::date is null or coalesce(o.placed_at, o.created_at)::date <= $3::date)
        group by o.id, o.order_no, o.grand_total_amount, o.shipping_fee_amount
        order by o.id asc
      `,
      [site.id, dateFrom, dateTo]
    );

    let grossOrderTotal = 0;
    let productCostTotal = 0;
    let freeShippingCostTotal = 0;
    let calculatedOrderCount = 0;
    let skippedOrderCount = 0;

    for (const order of result.rows) {
      const hasMissingCost = Boolean(order.has_missing_cost) || Number.parseInt(order.item_count ?? '0', 10) <= 0;
      if (hasMissingCost) {
        skippedOrderCount += 1;
        continue;
      }

      const orderTotal = Number.parseInt(order.grand_total_amount ?? '0', 10) || 0;
      const orderProductCost = Number.parseInt(order.product_cost_total ?? '0', 10) || 0;
      const freeShippingCost = (Number.parseInt(order.shipping_fee_amount ?? '0', 10) || 0) === 0 ? shippingCost : 0;

      grossOrderTotal += orderTotal;
      productCostTotal += orderProductCost;
      freeShippingCostTotal += freeShippingCost;
      calculatedOrderCount += 1;
    }

    return {
      site,
      filters: {
        date_from: dateFrom ?? '',
        date_to: dateTo ?? ''
      },
      profit: {
        total_amount: grossOrderTotal - productCostTotal - freeShippingCostTotal,
        gross_order_total: grossOrderTotal,
        product_cost_total: productCostTotal,
        free_shipping_cost_total: freeShippingCostTotal,
        calculated_order_count: calculatedOrderCount,
        skipped_order_count: skippedOrderCount,
        formula: 'net_profit = order_grand_total - product_cost_total - free_shipping_cost. Order grand total already includes coupons, discount codes, and member tier discounts.',
        date_from: dateFrom ?? null,
        date_to: dateTo ?? null
      }
    };
  }

  async listPendingOrders(accountId, args) {
    return this.listOrders(accountId, { ...args, logistics_status: 'pending' }, 'orders');
  }

  async listPendingReturns(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const limit = Math.min(requireOptionalPositiveInteger(args.limit, 'limit') ?? 20, 100);
    const offset = requireOptionalNonNegativeInteger(args.offset, 'offset') ?? 0;
    const searchOrderNo = nullableString(args.search_order_no);
    const [paymentProviders, logisticsProviders] = await Promise.all([
      this.listPaymentProvidersForSite(site.id),
      this.listLogisticsProvidersForSite(site.id)
    ]);
    const params = [site.id];
    const where = [
      'site_id = $1',
      'return_requested_at is not null',
      'return_cancelled_at is null',
      `(return_status is null or return_status != 'completed')`
    ];

    if (searchOrderNo) {
      params.push(`%${searchOrderNo}%`);
      where.push(`order_no ilike $${params.length}`);
    }

    params.push(limit);
    const limitIndex = params.length;
    params.push(offset);
    const offsetIndex = params.length;

    const result = await this.pool.query(
      `
        select orders.*,
               ${orderDateDisplaySelectSql()}
        from orders
        where ${where.join(' and ')}
        order by return_requested_at desc nulls last, created_at desc, id desc
        limit $${limitIndex} offset $${offsetIndex}
      `,
      params
    );

    return {
      site,
      scope: 'pending_returns',
      filters: {
        search_order_no: searchOrderNo ?? '',
        limit,
        offset
      },
      orders: result.rows.map((order) => formatOrderForMcp(order, {
        paymentProviders,
        logisticsProviders,
        includeReturnActions: true
      }))
    };
  }

  async getOrder(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const order = await this.findOrderForSite(site.id, args);
    const [paymentProviders, logisticsProviders, items] = await Promise.all([
      this.listPaymentProvidersForSite(site.id),
      this.listLogisticsProvidersForSite(site.id),
      this.listOrderItems(order.id)
    ]);

    return {
      site,
      order: {
        ...formatOrderForMcp(order, { paymentProviders, logisticsProviders, includeReturnActions: true }),
        items
      }
    };
  }

  async createOrderLogistics(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const order = await this.findOrderForSite(site.id, args);
    const logisticsProviders = await this.listLogisticsProvidersForSite(site.id);
    const actions = orderLogisticsActions(order, logisticsProviders);
    const provider = requireNonEmptyString(args.provider, 'provider');
    const storeType = nullableString(args.store_type);
    const action = findAction(actions, 'create_logistics', provider, storeType);
    if (!action) {
      throw codedError('VALIDATION_FAILED', 'This order cannot create the requested logistics order. Read available_actions first.', {
        available_actions: actions
      });
    }

    const trackingNo = generateTrackingNo(provider, order.id);
    const settings = logisticsProviders.find((item) => item.provider === provider)?.settings ?? {};
    const details = {
      provider,
      status_source: 'local_create',
      raw_status: 'created',
      raw_status_label: '',
      tracking_no: trackingNo,
      store_type: action.store_type ?? '',
      temperature: nullableString(args.temperature) ?? 'normal',
      carrier: nullableString(args.carrier) ?? (provider === 'ecpay' ? 'tcat' : ''),
      print_status: 'pending',
      created_at: new Date().toISOString(),
      payload: {
        source: 'slimweb_mcp',
        order_no: order.order_no,
        sender_name: settings.senderName ?? '',
        sender_phone: settings.senderPhone ?? '',
        sender_zip: settings.senderZip ?? '',
        sender_address: settings.senderAddress ?? ''
      }
    };

    await this.pool.query(
      `
        update orders
        set logistics_completed_at = coalesce(logistics_completed_at, now()),
            logistics_details = $3::jsonb,
            updated_at = now()
        where site_id = $1 and id = $2
      `,
      [site.id, order.id, JSON.stringify(details)]
    );

    return this.getOrder(accountId, { site_id: site.id, order_id: order.id });
  }

  async markOrderShipped(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const order = await this.findOrderForSite(site.id, args);
    if (order.logistics_completed_at !== null) {
      throw codedError('VALIDATION_FAILED', 'This order already has logistics. Use provider callbacks or logistics status instead.');
    }

    const details = {
      provider: 'manual',
      status_source: 'manual',
      raw_status: 'shipped',
      raw_status_label: '已出貨',
      tracking_no: '',
      created_at: new Date().toISOString(),
      payload: {
        source: 'slimweb_mcp_mark_shipped',
        order_no: order.order_no
      }
    };

    await this.pool.query(
      `
        update orders
        set status = 'confirmed',
            confirmed_at = coalesce(confirmed_at, now()),
            logistics_completed_at = now(),
            logistics_details = $3::jsonb,
            updated_at = now()
        where site_id = $1 and id = $2
      `,
      [site.id, order.id, JSON.stringify(details)]
    );

    return this.getOrder(accountId, { site_id: site.id, order_id: order.id });
  }

  async createReturnLogistics(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const order = await this.findOrderForSite(site.id, args);
    const logisticsProviders = await this.listLogisticsProvidersForSite(site.id);
    const actions = orderReturnActions(order, logisticsProviders);
    const provider = requireNonEmptyString(args.provider, 'provider');
    const type = nullableString(args.type);
    const action = actions.find((item) => item.action === 'create_return_logistics' && item.provider === provider && (!type || item.type === type));
    if (!action) {
      throw codedError('VALIDATION_FAILED', 'This return cannot create the requested reverse logistics order. Read available_actions first.', {
        available_actions: actions
      });
    }

    const trackingNo = generateTrackingNo(provider, order.id, true);
    const details = {
      provider,
      type: action.type,
      status_source: 'local_create',
      raw_status: 'created',
      raw_status_label: '已建立',
      tracking_no: trackingNo,
      created_at: new Date().toISOString(),
      payload: {
        source: 'slimweb_mcp',
        order_no: order.order_no,
        return_name: order.recipient_name ?? '',
        return_phone: order.recipient_phone ?? '',
        return_zip: order.recipient_zip ?? '',
        return_address: order.recipient_address ?? ''
      }
    };

    await this.pool.query(
      `
        update orders
        set return_status = 'created',
            return_logistics_provider = $3,
            return_logistics_type = $4,
            return_logistics_tracking_no = $5,
            return_logistics_status = 'created',
            return_logistics_details = $6::jsonb,
            updated_at = now()
        where site_id = $1 and id = $2
      `,
      [site.id, order.id, provider, action.type, trackingNo, JSON.stringify(details)]
    );

    return this.getOrder(accountId, { site_id: site.id, order_id: order.id });
  }

  async cancelReturn(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const order = await this.findOrderForSite(site.id, args);
    if (!order.return_requested_at || order.return_cancelled_at) {
      throw codedError('VALIDATION_FAILED', 'This order is not in an active return flow.');
    }

    await this.pool.query(
      `
        update orders
        set status = 'confirmed',
            confirmed_at = coalesce(confirmed_at, now()),
            return_status = 'cancelled',
            return_cancelled_at = now(),
            updated_at = now()
        where site_id = $1 and id = $2
      `,
      [site.id, order.id]
    );

    return this.getOrder(accountId, { site_id: site.id, order_id: order.id });
  }

  async completeReturn(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const order = await this.findOrderForSite(site.id, args);
    if (!order.return_requested_at || order.return_cancelled_at || order.return_logistics_tracking_no) {
      throw codedError('VALIDATION_FAILED', 'This return cannot be manually completed. If reverse logistics exists, wait for provider status.');
    }

    await this.pool.query(
      `
        update orders
        set status = 'returned',
            returned_at = coalesce(returned_at, now()),
            return_status = 'completed',
            return_completed_at = now(),
            updated_at = now()
        where site_id = $1 and id = $2
      `,
      [site.id, order.id]
    );

    return this.getOrder(accountId, { site_id: site.id, order_id: order.id });
  }

  async completeRefund(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const order = await this.findOrderForSite(site.id, args);
    const refundStatus = orderRefundStatus(order);
    if (!order.payment_completed_at || !['pending', 'exception'].includes(refundStatus)) {
      throw codedError('VALIDATION_FAILED', 'This order cannot be manually marked as refunded.');
    }

    const amount = Math.max(0, Number.parseInt(order.grand_total_amount ?? '0', 10));
    const details = {
      provider: 'manual',
      status_source: 'manual',
      raw_status: 'completed',
      raw_status_label: '已完成退款',
      amount,
      completed_at: new Date().toISOString(),
      payload: {
        source: 'slimweb_mcp',
        order_no: order.order_no
      }
    };

    await this.pool.query(
      `
        update orders
        set refund_status = 'completed',
            refund_provider = 'manual',
            refund_amount = $3,
            refund_completed_at = now(),
            refund_details = $4::jsonb,
            updated_at = now()
        where site_id = $1 and id = $2
      `,
      [site.id, order.id, amount, JSON.stringify(details)]
    );

    return this.getOrder(accountId, { site_id: site.id, order_id: order.id });
  }

  async createRefund(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const order = await this.findOrderForSite(site.id, args);
    const paymentProviders = await this.listPaymentProvidersForSite(site.id);
    const actions = orderRefundActions(order, paymentProviders);
    const provider = requireNonEmptyString(args.provider, 'provider');
    const action = actions.find((item) => item.action === 'create_refund' && item.provider === provider);
    if (!action) {
      throw codedError('VALIDATION_FAILED', 'This order cannot create the requested payment refund. Read available_actions first.', {
        available_actions: actions
      });
    }

    const amount = Math.max(0, Number.parseInt(order.grand_total_amount ?? '0', 10));
    const details = {
      provider,
      status_source: 'local_create',
      raw_status: 'created',
      raw_status_label: '已建立',
      amount,
      created_at: new Date().toISOString(),
      payload: {
        source: 'slimweb_mcp',
        order_no: order.order_no,
        payment_method: order.payment_method ?? '',
        payment_provider: order.payment_provider ?? ''
      }
    };

    await this.pool.query(
      `
        update orders
        set refund_status = 'created',
            refund_provider = $3,
            refund_amount = $4,
            refund_completed_at = null,
            refund_details = $5::jsonb,
            updated_at = now()
        where site_id = $1 and id = $2
      `,
      [site.id, order.id, provider, amount, JSON.stringify(details)]
    );

    return this.getOrder(accountId, { site_id: site.id, order_id: order.id });
  }

  async getDashboardSummary(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const now = new Date();
    const lastThirtyDays = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const [ordersByStatus, stats, recentOrders, recentMembers, lowStockProducts] = await Promise.all([
      this.pool.query(
        `
          select status, count(*)::int as total
          from orders
          where site_id = $1
          group by status
        `,
        [site.id]
      ),
      this.pool.query(
        `
          select
            coalesce((select sum(grand_total_amount)::bigint from orders where site_id = $1 and status = 'confirmed'), 0) as total_revenue,
            (select count(*)::int from members where site_id = $1) as total_members,
            (select count(*)::int from members where site_id = $1 and created_at >= $2) as new_members_last_30_days,
            (select count(*)::int from products where site_id = $1) as total_products,
            (select count(*)::int from products where site_id = $1 and status = 'active') as active_products,
            (select count(*)::int from products where site_id = $1 and status = 'active' and stock <= 10) as low_stock_products,
            (select count(*)::int from articles where site_id = $1) as total_articles,
            (select count(*)::int from articles where site_id = $1 and created_at >= $2) as published_articles_last_30_days,
            (select count(*)::int from coupon_templates where site_id = $1 and (starts_at is null or starts_at <= $3) and (ends_at is null or ends_at >= $3)) as active_coupons,
            (select count(*)::int from site_categories where site_id = $1) as total_categories,
            (select count(*)::int from site_nav_items where site_id = $1) as total_nav_items,
            (select count(*)::int from site_pages where site_id = $1) as total_main_pages
        `,
        [site.id, lastThirtyDays, today]
      ),
      this.pool.query(
        `
          select id, order_no, recipient_name, recipient_email, status, grand_total_amount, placed_at, created_at
          from orders
          where site_id = $1
          order by placed_at desc nulls last, id desc
          limit 5
        `,
        [site.id]
      ),
      this.pool.query(
        `
          select id, name, email, mobile, created_at
          from members
          where site_id = $1
          order by created_at desc, id desc
          limit 5
        `,
        [site.id]
      ),
      this.pool.query(
        `
          select p.id, p.name, p.stock, p.status, c.name as category_name
          from products p
          left join site_categories c on c.id = p.site_category_id
          where p.site_id = $1 and p.status = 'active' and p.stock <= 10
          order by p.stock asc, p.name asc
          limit 5
        `,
        [site.id]
      )
    ]);
    const statusCounts = new Map(ordersByStatus.rows.map((row) => [row.status, Number.parseInt(row.total ?? '0', 10)]));
    const row = stats.rows[0] ?? {};

    return {
      site,
      stats: {
        totalRevenue: Number.parseInt(row.total_revenue ?? '0', 10),
        confirmedOrders: statusCounts.get('confirmed') ?? 0,
        pendingOrders: statusCounts.get('pending') ?? 0,
        returningOrders: statusCounts.get('returning') ?? 0,
        returnedOrders: statusCounts.get('returned') ?? 0,
        totalMembers: Number.parseInt(row.total_members ?? '0', 10),
        newMembersLast30Days: Number.parseInt(row.new_members_last_30_days ?? '0', 10),
        totalProducts: Number.parseInt(row.total_products ?? '0', 10),
        activeProducts: Number.parseInt(row.active_products ?? '0', 10),
        lowStockProducts: Number.parseInt(row.low_stock_products ?? '0', 10),
        totalArticles: Number.parseInt(row.total_articles ?? '0', 10),
        publishedArticlesLast30Days: Number.parseInt(row.published_articles_last_30_days ?? '0', 10),
        activeCoupons: Number.parseInt(row.active_coupons ?? '0', 10),
        totalCategories: Number.parseInt(row.total_categories ?? '0', 10),
        totalNavItems: Number.parseInt(row.total_nav_items ?? '0', 10),
        totalMainPages: Number.parseInt(row.total_main_pages ?? '0', 10)
      },
      recentOrders: recentOrders.rows.map((order) => ({
        id: order.id,
        orderNo: order.order_no,
        memberName: order.recipient_name,
        memberEmail: order.recipient_email,
        status: order.status,
        grandTotalAmount: Number.parseInt(order.grand_total_amount ?? '0', 10),
        placedAt: order.placed_at,
        createdAt: order.created_at
      })),
      recentMembers: recentMembers.rows.map((member) => ({
        id: member.id,
        name: member.name,
        email: member.email,
        mobile: member.mobile,
        createdAt: member.created_at
      })),
      lowStockProducts: lowStockProducts.rows.map((product) => ({
        id: `product-${product.id}`,
        productId: product.id,
        name: product.name,
        variantName: '',
        stock: Number.parseInt(product.stock ?? '0', 10),
        status: product.status,
        categoryPath: product.category_name ?? ''
      }))
    };
  }

  async getBasicSettings(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const settings = await this.findBasicSettingsForSite(site.id);

    return {
      site,
      settings
    };
  }

  async updateBasicSettings(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const current = await this.findBasicSettingsForSite(site.id);
    const next = normalizeBasicSettings(args, current);
    const mailDeliverySettings = next.member_verification === 'email'
      ? await this.findMailDeliverySettingsForSite(site.id)
      : null;

    if (next.member_verification === 'email' && !isSmtpConfigured(mailDeliverySettings)) {
      throw codedError(
        'VALIDATION_FAILED',
        'SMTP settings must be fully configured before member_verification can be set to email.'
      );
    }

    const result = await this.pool.query(
      `
        update sites
        set
          site_status = $1,
          member_verification = $2,
          website_type = $3,
          default_country_code = $4,
          product_load_mode = $5,
          return_days_allowed = $6,
          product_category_depth = $7,
          updated_at = now()
        where id = $8
        returning ${BASIC_SETTINGS_COLUMNS.join(', ')}
      `,
      [
        next.site_status,
        next.member_verification,
        next.website_type,
        next.default_country_code,
        next.product_load_mode,
        next.return_days_allowed,
        next.product_category_depth,
        site.id
      ]
    );

    return {
      ok: true,
      site,
      settings: formatBasicSettings(result.rows[0] ?? next)
    };
  }

  async listAdmins(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));

    return {
      site,
      admins: await this.listAdminsForSite(site.id)
    };
  }

  async upsertAdmin(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const adminId = args.admin_id === undefined || args.admin_id === null ? null : requireInteger(args.admin_id, 'admin_id');
    const googleEmail = requireGoogleEmail(args.google_email);
    let permissions = normalizeAdminPermissions(args.permissions);
    const firstAdmin = await this.firstAdminForSite(site.id);
    const existing = adminId ? await this.findAdminForSite(site.id, adminId) : null;
    const isProtectedSystemAdmin = firstAdmin && existing && String(firstAdmin.id) === String(existing.id);

    if (!existing && !firstAdmin) {
      permissions = ensureSystemAdminPermission(permissions);
    }

    if (isProtectedSystemAdmin) {
      permissions = ensureSystemAdminPermission(permissions);
    }

    await this.assertAdminGoogleEmailAvailable(site.id, googleEmail, adminId);
    const result = existing
      ? await this.pool.query(
        `
          update site_admins
          set username = $1,
              google_email = $1,
              permissions = $2::jsonb,
              updated_at = now()
          where site_id = $3 and id = $4
          returning id, site_id, username, google_email, google_sub, avatar_path, permissions, created_at, updated_at
        `,
        [googleEmail, JSON.stringify(permissions), site.id, existing.id]
      )
      : await this.pool.query(
        `
          insert into site_admins (site_id, username, google_email, password, permissions, created_at, updated_at)
          values ($1, $2, $2, null, $3::jsonb, now(), now())
          returning id, site_id, username, google_email, google_sub, avatar_path, permissions, created_at, updated_at
        `,
        [site.id, googleEmail, JSON.stringify(permissions)]
      );

    const admins = await this.listAdminsForSite(site.id);
    const admin = admins.find((item) => String(item.id) === String(result.rows[0].id)) ?? formatAdmin(result.rows[0], {
      first_admin_id: firstAdmin?.id ?? result.rows[0].id,
      publicSiteBaseUrl: this.publicSiteBaseUrl
    });

    return {
      ok: true,
      site,
      admin,
      admins
    };
  }

  async deleteAdmin(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const admin = await this.findAdminForSite(site.id, requireInteger(args.admin_id, 'admin_id'));
    const firstAdmin = await this.firstAdminForSite(site.id);

    if (firstAdmin && String(firstAdmin.id) === String(admin.id)) {
      throw codedError('VALIDATION_FAILED', 'The first system administrator cannot be deleted.');
    }

    if (admin.avatar_path) {
      await this.storage.delete(admin.avatar_path);
    }

    await this.pool.query('delete from site_admins where site_id = $1 and id = $2', [site.id, admin.id]);

    return {
      ok: true,
      site,
      deleted_admin_id: admin.id,
      admins: await this.listAdminsForSite(site.id)
    };
  }

  async listExternalAssets(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const result = await this.pool.query(
      `
        select id, site_id, site_page_id, page_key, scope, asset_type, url, placement, load_mode,
               sort_order, is_enabled, purpose, attributes, created_at, updated_at
        from site_external_assets
        where site_id = $1
        order by sort_order asc, id asc
      `,
      [site.id]
    );

    return {
      site,
      assets: result.rows.map((asset) => formatExternalAsset(asset))
    };
  }

  async upsertExternalAsset(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const assetId = args.asset_id === undefined || args.asset_id === null ? null : requireInteger(args.asset_id, 'asset_id');
    const existing = assetId ? await this.findExternalAssetForSite(site.id, assetId) : null;
    const payload = await this.normalizeExternalAssetPayload(site.id, args, existing);
    const result = existing
      ? await this.pool.query(
        `
          update site_external_assets
          set site_page_id = $1,
              page_key = $2,
              scope = $3,
              asset_type = $4,
              url = $5,
              placement = $6,
              load_mode = $7,
              sort_order = $8,
              is_enabled = $9,
              purpose = $10,
              attributes = $11::jsonb,
              updated_at = now()
          where site_id = $12 and id = $13
          returning id, site_id, site_page_id, page_key, scope, asset_type, url, placement, load_mode,
                    sort_order, is_enabled, purpose, attributes, created_at, updated_at
        `,
        [
          payload.site_page_id,
          payload.page_key,
          payload.scope,
          payload.asset_type,
          payload.url,
          payload.placement,
          payload.load_mode,
          payload.sort_order,
          payload.is_enabled,
          payload.purpose,
          JSON.stringify(payload.attributes),
          site.id,
          existing.id
        ]
      )
      : await this.pool.query(
        `
          insert into site_external_assets (
            site_id, site_page_id, page_key, scope, asset_type, url, placement, load_mode,
            sort_order, is_enabled, purpose, attributes, created_at, updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, now(), now())
          returning id, site_id, site_page_id, page_key, scope, asset_type, url, placement, load_mode,
                    sort_order, is_enabled, purpose, attributes, created_at, updated_at
        `,
        [
          site.id,
          payload.site_page_id,
          payload.page_key,
          payload.scope,
          payload.asset_type,
          payload.url,
          payload.placement,
          payload.load_mode,
          payload.sort_order,
          payload.is_enabled,
          payload.purpose,
          JSON.stringify(payload.attributes)
        ]
      );

    return {
      ok: true,
      site,
      asset: formatExternalAsset(result.rows[0]),
      assets: (await this.listExternalAssets(accountId, { site_id: site.id })).assets
    };
  }

  async deleteExternalAsset(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const asset = await this.findExternalAssetForSite(site.id, requireInteger(args.asset_id, 'asset_id'));

    await this.pool.query('delete from site_external_assets where site_id = $1 and id = $2', [site.id, asset.id]);

    return {
      ok: true,
      site,
      deleted_asset_id: asset.id,
      assets: (await this.listExternalAssets(accountId, { site_id: site.id })).assets
    };
  }

  async reorderExternalAssets(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    if (!Array.isArray(args.asset_ids) || args.asset_ids.length === 0) {
      throw codedError('VALIDATION_FAILED', 'asset_ids must be a non-empty array.');
    }

    for (const [index, assetIdValue] of args.asset_ids.entries()) {
      const assetId = requireInteger(assetIdValue, 'asset_ids');
      await this.pool.query(
        'update site_external_assets set sort_order = $1, updated_at = now() where site_id = $2 and id = $3',
        [index, site.id, assetId]
      );
    }

    return {
      ok: true,
      site,
      assets: (await this.listExternalAssets(accountId, { site_id: site.id })).assets
    };
  }

  async updateIntegrationSettings(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const current = await this.findIntegrationSettingsForSite(site.id);
    const next = normalizeIntegrationSettings(args, current);
    const settings = await this.persistIntegrationSettings(site.id, next);

    return {
      ok: true,
      site,
      settings
    };
  }

  async persistIntegrationSettings(siteId, next) {
    const result = await this.pool.query(
      `
        update sites
        set
          sms_account = $1,
          sms_password = $2,
          facebook_app_id = $3,
          facebook_page_id = $4,
          facebook_comment_on_products = $5,
          facebook_comment_on_posts = $6,
          line_login_channel_id = $7,
          line_login_channel_secret = $8,
          google_login_client_id = $9,
          broadcast_id = $10,
          use_ai_customer_service = $11,
          ai_provider = $12,
          ai_api_key = $13,
          ai_model_name = $14,
          google_search_api_key = $15,
          google_search_engine_id = $16,
          line_bot_access_token = $17,
          line_bot_channel_secret = $18,
          line_bot_user_id = $19,
          notion_token = $20,
          updated_at = now()
        where id = $21
        returning ${INTEGRATION_SETTINGS_COLUMNS.join(', ')}
      `,
      [
        next.sms_account,
        next.sms_password,
        next.facebook_app_id,
        next.facebook_page_id,
        next.facebook_comment_on_products,
        next.facebook_comment_on_posts,
        next.line_login_channel_id,
        next.line_login_channel_secret,
        next.google_login_client_id,
        next.broadcast_id,
        next.use_ai_customer_service,
        next.ai_provider,
        next.ai_api_key,
        next.ai_model_name,
        next.google_search_api_key,
        next.google_search_engine_id,
        next.line_bot_access_token,
        next.line_bot_channel_secret,
        next.line_bot_user_id,
        next.notion_token,
        siteId
      ]
    );

    return formatIntegrationSettings(result.rows[0] ?? next);
  }

  async listArticles(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const page = clampPositiveInteger(args.page, 1, 1, 1000);
    const perPage = clampPositiveInteger(args.per_page, 8, 1, 50);
    const offset = (page - 1) * perPage;
    const [countResult, articleResult] = await Promise.all([
      this.pool.query(
        `
          select count(*)::int as total
          from articles
          where site_id = $1
        `,
        [site.id]
      ),
      this.pool.query(
        `
          select id, site_id, notion_page_id, title, content, cover_path, created_at, updated_at
          from articles
          where site_id = $1
          order by created_at desc, id desc
          limit $2 offset $3
        `,
        [site.id, perPage, offset]
      )
    ]);
    const total = Number.parseInt(countResult.rows[0]?.total ?? '0', 10);

    return {
      site,
      articles: articleResult.rows.map((article) => formatArticle(article, site, this.publicSiteBaseUrl, false)),
      pagination: {
        page,
        per_page: perPage,
        last_page: Math.max(1, Math.ceil(total / perPage)),
        total
      }
    };
  }

  async checkArticleTitle(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const title = requireArticleTitle(args.title);
    const { matches } = await this.findArticleTitleMatchesForSite(site, title);

    return {
      site,
      title,
      normalized_title: normalizeTitleMatch(title),
      exists: matches.length > 0,
      matches
    };
  }

  async getArticleContent(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const articleId = requireInteger(args.article_id, 'article_id');
    const article = await this.findArticleForSite(site.id, articleId);

    return {
      site,
      article: formatArticle(article, site, this.publicSiteBaseUrl, true)
    };
  }

  async createArticle(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const title = requireArticleTitle(args.title);
    const { matches } = await this.findArticleTitleMatchesForSite(site, title);

    if (matches.length > 0) {
      throw codedError('CONFLICT', 'Article title already exists.', { matches });
    }

    if (!args.cover_image) {
      throw codedError('VALIDATION_FAILED', 'cover_image is required when creating a new article. Generate or upload a 16:9 main image first, then pass its committed media_path.');
    }

    return this.upsertArticle(accountId, {
      ...args,
      site_id: site.id,
      title,
      article_id: null
    });
  }

  async updateArticle(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const articleId = requireInteger(args.article_id, 'article_id');
    const existing = await this.findArticleForSite(site.id, articleId);
    const nextTitle = args.title === undefined || args.title === null ? existing.title : requireArticleTitle(args.title);

    if (normalizeTitleMatch(nextTitle) !== normalizeTitleMatch(existing.title)) {
      const { matches } = await this.findArticleTitleMatchesForSite(site, nextTitle);
      const conflictingMatches = matches.filter((match) => match.id !== existing.id);

      if (conflictingMatches.length > 0) {
        throw codedError('CONFLICT', 'Article title already exists.', { matches: conflictingMatches });
      }
    }

    const nextContentHtml = args.content_html === undefined || args.content_html === null
      ? (existing.content ?? '')
      : args.content_html;
    const nextNotionPageId = args.notion_page_id === undefined ? existing.notion_page_id : args.notion_page_id;

    return this.upsertArticle(accountId, {
      ...args,
      site_id: site.id,
      article_id: articleId,
      title: nextTitle,
      content_html: nextContentHtml,
      notion_page_id: nextNotionPageId
    });
  }

  async upsertArticle(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const title = requireArticleTitle(args.title);
    const content = removeDuplicateArticleTitleHeading(extractSafeHtml(args.content_html, 'content_html'), title);
    const notionPageId = nullableString(args.notion_page_id);
    const articleId = args.article_id === undefined || args.article_id === null ? null : requireInteger(args.article_id, 'article_id');
    const existing = articleId ? await this.findArticleForSite(site.id, articleId) : null;
    const normalizedContentImages = normalizeContentImages(args.content_images);
    let coverPath = existing?.cover_path ?? null;

    if (!articleId && !args.cover_image) {
      throw codedError('VALIDATION_FAILED', 'cover_image is required when creating a new article. Generate or upload a 16:9 main image first, then pass its committed media_path.');
    }

    if (args.cover_image) {
      coverPath = normalizeCommittedMediaPath(args.cover_image, site.id, 'cover_image');
    }

    const result = articleId
      ? await this.pool.query(
        `
          update articles
          set notion_page_id = $1,
              title = $2,
              content = $3,
              cover_path = $4,
              updated_at = now()
          where site_id = $5 and id = $6
          returning id, site_id, notion_page_id, title, content, cover_path, created_at, updated_at
        `,
        [notionPageId, title, content, coverPath, site.id, articleId]
      )
      : await this.pool.query(
        `
          insert into articles (site_id, notion_page_id, title, content, cover_path, created_at, updated_at)
          values ($1, $2, $3, $4, $5, now(), now())
          returning id, site_id, notion_page_id, title, content, cover_path, created_at, updated_at
        `,
        [site.id, notionPageId, title, content, coverPath]
      );
    const article = result.rows[0];

    const contentImages = await this.storeArticleContentImages(site, article.id, normalizedContentImages);

    return {
      ok: true,
      site,
      article: formatArticle(article, site, this.publicSiteBaseUrl, true),
      content_images: contentImages
    };
  }

  async createUpload(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const response = await this.fetch(`${this.weblessAppBaseUrl}/sites/${encodeURIComponent(site.slug)}/mcp-uploads`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-slimweb-mcp-secret': this.requireWeblessMcpSecret()
      },
      body: JSON.stringify({
        filename: requireNonEmptyString(args.filename, 'filename'),
        mime_type: requireImageMimeType(args.mime_type, 'mime_type'),
        size_bytes: requirePositiveAmount(args.size_bytes, 'size_bytes'),
        target_usage: requireUploadTargetUsage(args.target_usage)
      })
    });

    const payload = await parseJsonResponse(response, 'Unable to create Webless upload URL');

    return {
      ok: true,
      site,
      ...payload,
      upload_instructions: {
        runtime_check: 'Before uploading, identify your own AI client runtime and confirm it can read the source image bytes and make outbound HTTPS PUT requests.',
        supported_runtime_examples: ['Codex with local/code execution access', 'Hermes with local/code execution access'],
        unsupported_runtime_examples: ['ChatGPT Remote MCP when the only source is a conversation attachment, /mnt/data path, or hidden attachment rewrite'],
        fallback_message: 'If this runtime cannot access the image bytes or cannot PUT to upload_url, tell the user this client cannot upload the image through MCP and ask them to use Codex/Hermes or provide a directly downloadable image URL.',
        step_1: 'Read the image bytes from an accessible local file, generated image file, or directly downloadable image URL.',
        step_2: 'PUT the raw bytes to upload_url with the returned headers. Do not send base64 through MCP.',
        step_3: 'Call slimweb_uploads_commit with upload_id and upload_token, then use asset.media_path in product/article/asset tools.'
      }
    };
  }

  async commitUpload(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const uploadId = requireNonEmptyString(args.upload_id, 'upload_id');
    const response = await this.fetch(`${this.weblessAppBaseUrl}/sites/${encodeURIComponent(site.slug)}/mcp-uploads/${encodeURIComponent(uploadId)}/commit`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-slimweb-mcp-secret': this.requireWeblessMcpSecret()
      },
      body: JSON.stringify({
        upload_token: requireNonEmptyString(args.upload_token, 'upload_token')
      })
    });

    const payload = await parseJsonResponse(response, 'Unable to commit Webless upload');
    if (payload?.asset?.media_path) {
      normalizeCommittedMediaPath({ media_path: payload.asset.media_path }, site.id, 'asset.media_path');
    }

    return {
      ok: true,
      site,
      ...payload
    };
  }

  async importChatGptAttachment(accountId, args) {
    const image = normalizeOpenAiFileParam(args.image);
    const filename = requireNonEmptyString(args.filename ?? image.filename, 'filename');
    const targetUsage = requireUploadTargetUsage(args.target_usage);

    const imported = await this.importExternalImageUrl(accountId, {
      site_id: args.site_id,
      image_url: image.download_url,
      filename,
      mime_type: image.mime_type,
      target_usage: targetUsage,
      source_label: 'OpenAI file parameter'
    });

    return {
      ...imported,
      upload: {
        ...imported.upload,
        source: 'openai_file_params',
        file_id: image.file_id ?? null
      }
    };
  }

  async importExternalImageUrl(accountId, args) {
    const imageUrl = requireUrl(args.image_url ?? args.url, 'image_url');
    const filename = requireNonEmptyString(args.filename ?? filenameFromUrl(imageUrl) ?? 'external-image.webp', 'filename');
    const targetUsage = requireUploadTargetUsage(args.target_usage ?? 'reference');
    const sourceLabel = args.source_label ?? 'external image URL';

    const downloadResponse = await this.fetch(imageUrl);
    if (!downloadResponse.ok) {
      throw codedError('UPSTREAM_ERROR', `Unable to download ${sourceLabel}: HTTP ${downloadResponse.status}`, {
        status: downloadResponse.status
      });
    }

    const bytes = Buffer.from(await downloadResponse.arrayBuffer());
    if (bytes.length === 0) {
      throw codedError('VALIDATION_FAILED', `${sourceLabel} was empty.`);
    }
    if (bytes.length > MAX_ASSET_BYTES) {
      throw codedError('VALIDATION_FAILED', `${sourceLabel} is too large.`);
    }

    const responseMimeType = String(downloadResponse.headers.get('content-type') ?? '').split(';')[0].trim();
    const mimeType = requireImageMimeType(args.mime_type || responseMimeType || contentTypeForPath(filename), 'image.mime_type');
    const upload = await this.createUpload(accountId, {
      site_id: args.site_id,
      filename,
      mime_type: mimeType,
      size_bytes: bytes.length,
      target_usage: targetUsage
    });

    const putResponse = await this.fetch(requireUrl(upload.upload_url, 'upload_url'), {
      method: upload.method || 'PUT',
      headers: upload.headers && typeof upload.headers === 'object'
        ? upload.headers
        : { 'Content-Type': mimeType },
      body: bytes
    });
    if (!putResponse.ok) {
      throw codedError('UPSTREAM_ERROR', `Unable to upload ${sourceLabel} to Webless: HTTP ${putResponse.status}`, {
        status: putResponse.status
      });
    }

    const committed = await this.commitUpload(accountId, {
      site_id: args.site_id,
      upload_id: upload.upload_id,
      upload_token: upload.upload_token
    });

    return {
      ...committed,
      upload: {
        source: 'external_image_url',
        source_url: imageUrl,
        filename,
        mime_type: mimeType,
        size_bytes: bytes.length,
        upload_id: upload.upload_id
      }
    };
  }

  async listCategories(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const categories = await this.listProductImportCategories(site.id);
    const productCounts = await this.productCountsByCategory(site.id);

    return {
      site,
      categories: buildCategoryTree(categories, productCounts),
      flat_categories: categories.map((category) => ({
        ...category,
        product_count: productCounts.get(category.id) ?? 0,
        is_leaf: !categories.some((item) => item.parent_id === category.id)
      })),
      guidance: {
        product_category_rule: 'Products must be assigned to a leaf category. Ask the user to confirm category placement when a parent/child relationship is unclear.'
      }
    };
  }

  async upsertCategory(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    let categoryId = args.category_id === undefined || args.category_id === null ? null : requireInteger(args.category_id, 'category_id');
    const name = requireCategoryName(args.name);
    const currentName = args.current_name === undefined || args.current_name === null
      ? null
      : requireCategoryName(args.current_name);
    let existing = categoryId ? await this.findCategoryForSite(site.id, categoryId) : null;
    let matchedExistingByName = false;
    let matchedExistingByCurrentName = false;
    if (!categoryId && currentName) {
      existing = await this.findCategoryByNameForSite(site.id, currentName);
      if (!existing) {
        throw codedError('NOT_FOUND', `Category not found or not accessible by current_name: ${currentName}`);
      }
      categoryId = Number.parseInt(existing.id, 10);
      matchedExistingByCurrentName = true;
    }
    if (!categoryId) {
      existing = await this.findCategoryByNameForSite(site.id, name);
      categoryId = existing ? Number.parseInt(existing.id, 10) : null;
      matchedExistingByName = Boolean(existing);
    }
    const shouldPreserveExistingParent = categoryId && (
      args.parent_id === undefined
      || (matchedExistingByName && args.parent_id === null)
    );
    const parentId = shouldPreserveExistingParent ? existing.parent_id ?? null : normalizeNullableInteger(args.parent_id, 'parent_id');
    const iconSvg = normalizeGeneratedSvgIcon(args.icon_svg_base64 ?? args.generated_icon_svg, existing?.icon_svg ?? null, categoryId ? false : true);
    const imagePath = args.image === undefined
      ? existing?.image_path ?? null
      : await this.resolveCommittedImageSource(accountId, site, args.image, 'image', 'page_asset');

    if (categoryId && parentId === categoryId) {
      throw codedError('VALIDATION_FAILED', 'A category cannot be its own parent.');
    }

    if (parentId !== null) {
      await this.findCategoryForSite(site.id, parentId);
    }

    if (categoryId) {
      await this.assertCategoryParentIsNotDescendant(site.id, categoryId, parentId);
    }

    const keepsExistingName = categoryId && existing && String(existing.name ?? '').toLowerCase() === name.toLowerCase();
    if (!keepsExistingName) {
      await this.assertCategoryNameAvailable(site.id, parentId, name, categoryId);
    }
    if ((args.icon_svg_base64 !== undefined || args.generated_icon_svg !== undefined) && existing?.icon_path) {
      await this.storage.delete(existing.icon_path);
    }
    if (args.image !== undefined && existing?.image_path && existing.image_path !== imagePath) {
      await this.storage.delete(existing.image_path);
    }

    let sortOrder;
    if (categoryId && args.sort_order === undefined) {
      sortOrder = Number.parseInt(existing.sort_order ?? '0', 10);
    } else if (args.sort_order === undefined || args.sort_order === null) {
      sortOrder = await this.nextCategorySortOrder(site.id, parentId);
    } else {
      sortOrder = requireNonNegativeAmount(args.sort_order, 'sort_order');
    }

    const previousCategory = existing ? { ...existing } : null;
    const result = categoryId
      ? await this.pool.query(
        `
          update site_categories
          set parent_id = $1,
              name = $2,
              icon_svg = $3,
              icon_path = case when $3::text is null then icon_path else null end,
              image_path = $4,
              sort_order = $5,
              updated_at = now()
          where site_id = $6 and id = $7
          returning id, site_id, parent_id, name, icon_svg, icon_path, image_path, sort_order, created_at, updated_at
        `,
        [parentId, name, iconSvg, imagePath, sortOrder, site.id, categoryId]
      )
      : await this.pool.query(
        `
          insert into site_categories (site_id, parent_id, name, icon_svg, image_path, sort_order, created_at, updated_at)
          values ($1, $2, $3, $4, $5, $6, now(), now())
          returning id, site_id, parent_id, name, icon_svg, icon_path, image_path, sort_order, created_at, updated_at
        `,
        [site.id, parentId, name, iconSvg, imagePath, sortOrder]
      );
    const savedCategory = result.rows[0];
    if (!savedCategory) {
      throw codedError('UPSTREAM_ERROR', 'Category upsert did not return a saved row.');
    }

    return {
      ok: true,
      site,
      action: categoryId ? 'updated' : 'created',
      matched_by: matchedExistingByCurrentName ? 'current_name' : (matchedExistingByName ? 'name' : (args.category_id ? 'category_id' : null)),
      changed_fields: categoryChangedFields(previousCategory, savedCategory),
      category: formatCategory(savedCategory)
    };
  }

  async deleteCategory(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const category = await this.findCategoryForSite(site.id, requireInteger(args.category_id, 'category_id'));
    const descendants = await this.pool.query(
      `
        with recursive category_tree as (
          select id, icon_path, image_path
          from site_categories
          where site_id = $1 and id = $2
          union all
          select child.id, child.icon_path, child.image_path
          from site_categories child
          inner join category_tree parent on parent.id = child.parent_id
          where child.site_id = $1
        )
        select id, icon_path, image_path from category_tree
      `,
      [site.id, category.id]
    );
    const categoryIds = descendants.rows.map((row) => row.id);
    const productCount = await this.pool.query(
      `
        select count(*)::int as total
        from products
        where site_id = $1 and site_category_id = any($2::bigint[])
      `,
      [site.id, categoryIds]
    );
    const totalProducts = Number.parseInt(productCount.rows[0]?.total ?? '0', 10);

    if (totalProducts > 0) {
      throw codedError('VALIDATION_FAILED', 'Product category cannot be deleted while it or its child categories contain products.', {
        product_count: totalProducts
      });
    }

    for (const categoryRow of descendants.rows) {
      if (categoryRow.icon_path) {
        await this.storage.delete(categoryRow.icon_path);
      }

      if (categoryRow.image_path) {
        await this.storage.delete(categoryRow.image_path);
      }
    }

    await this.pool.query('delete from site_categories where site_id = $1 and id = any($2::bigint[])', [site.id, categoryIds]);

    return {
      ok: true,
      site,
      deleted_category_ids: categoryIds,
      categories: (await this.listCategories(accountId, { site_id: site.id })).categories
    };
  }

  async listNavItems(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const navItems = await this.listSiteNavItems(site.id);

    return {
      site,
      nav_items: buildTree(navItems),
      flat_nav_items: navItems
    };
  }

  async upsertNavItem(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const navItemId = args.nav_item_id === undefined || args.nav_item_id === null ? null : requireInteger(args.nav_item_id, 'nav_item_id');
    const existing = navItemId ? await this.findNavItemForSite(site.id, navItemId) : null;
    const parentId = navItemId && args.parent_id === undefined ? existing.parent_id ?? null : normalizeNullableInteger(args.parent_id, 'parent_id');
    const name = requireNavItemName(args.name);
    const itemType = normalizeNavItemType(args.item_type);
    const url = normalizeNavItemUrl(args.url, itemType);
    const iconSvg = normalizeGeneratedSvgIcon(args.icon_svg_base64 ?? args.generated_icon_svg, existing?.icon_svg ?? null, navItemId ? false : true);

    if (navItemId && parentId === navItemId) {
      throw codedError('VALIDATION_FAILED', 'A navigation item cannot be its own parent.');
    }

    if (parentId !== null) {
      const parent = await this.findNavItemForSite(site.id, parentId);
      if (parent.item_type !== 'dropdown') {
        throw codedError('VALIDATION_FAILED', 'Only dropdown navigation items can have children.');
      }
    }

    if (navItemId) {
      await this.assertNavItemParentIsNotDescendant(site.id, navItemId, parentId);
      if (existing.item_type === 'dropdown' && itemType === 'link') {
        await this.assertNavItemHasNoChildren(site.id, navItemId);
      }
    }

    await this.assertNavItemNameAvailable(site.id, parentId, name, navItemId);
    if ((args.icon_svg_base64 !== undefined || args.generated_icon_svg !== undefined) && existing?.icon_path) {
      await this.storage.delete(existing.icon_path);
    }

    let sortOrder;
    if (navItemId && args.sort_order === undefined) {
      sortOrder = Number.parseInt(existing.sort_order ?? '0', 10);
    } else if (args.sort_order === undefined || args.sort_order === null) {
      sortOrder = await this.nextNavItemSortOrder(site.id, parentId);
    } else {
      sortOrder = requireNonNegativeAmount(args.sort_order, 'sort_order');
    }

    const result = navItemId
      ? await this.pool.query(
        `
          update site_nav_items
          set parent_id = $1,
              name = $2,
              item_type = $3,
              url = $4,
              icon_svg = $5,
              icon_path = case when $5::text is null then icon_path else null end,
              sort_order = $6,
              updated_at = now()
          where site_id = $7 and id = $8
          returning id, site_id, parent_id, name, item_type, url, icon_svg, icon_path, sort_order, created_at, updated_at
        `,
        [parentId, name, itemType, url, iconSvg, sortOrder, site.id, navItemId]
      )
      : await this.pool.query(
        `
          insert into site_nav_items (site_id, parent_id, name, item_type, url, icon_svg, sort_order, created_at, updated_at)
          values ($1, $2, $3, $4, $5, $6, $7, now(), now())
          returning id, site_id, parent_id, name, item_type, url, icon_svg, icon_path, sort_order, created_at, updated_at
        `,
        [site.id, parentId, name, itemType, url, iconSvg, sortOrder]
      );

    return {
      ok: true,
      site,
      nav_item: formatNavItem(result.rows[0])
    };
  }

  async deleteNavItem(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const navItem = await this.findNavItemForSite(site.id, requireInteger(args.nav_item_id, 'nav_item_id'));
    const descendants = await this.pool.query(
      `
        with recursive nav_tree as (
          select id, icon_path
          from site_nav_items
          where site_id = $1 and id = $2
          union all
          select child.id, child.icon_path
          from site_nav_items child
          inner join nav_tree parent on parent.id = child.parent_id
          where child.site_id = $1
        )
        select id, icon_path from nav_tree
      `,
      [site.id, navItem.id]
    );
    const navItemIds = descendants.rows.map((row) => row.id);

    for (const navItemRow of descendants.rows) {
      if (navItemRow.icon_path) {
        await this.storage.delete(navItemRow.icon_path);
      }
    }

    await this.pool.query('delete from site_nav_items where site_id = $1 and id = any($2::bigint[])', [site.id, navItemIds]);

    return {
      ok: true,
      site,
      deleted_nav_item_ids: navItemIds,
      nav_items: (await this.listNavItems(accountId, { site_id: site.id })).nav_items
    };
  }

  async listProducts(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const page = clampPositiveInteger(args.page, 1, 1, 1000);
    const perPage = clampPositiveInteger(args.per_page, 8, 1, 50);
    const offset = (page - 1) * perPage;
    const filters = ['p.site_id = $1'];
    const params = [site.id];
    const categoryId = normalizeNullableInteger(args.category_id, 'category_id');
    const keyword = nullableString(args.keyword);
    const status = nullableString(args.status) ?? 'all';

    if (categoryId !== null) {
      filters.push(`p.site_category_id = $${params.length + 1}`);
      params.push(categoryId);
    }

    if (keyword) {
      filters.push(`(p.name ilike $${params.length + 1} or p.sku ilike $${params.length + 1})`);
      params.push(`%${keyword}%`);
    }

    if (status !== 'all') {
      if (!['active', 'hidden', 'sold_out'].includes(status)) {
        throw codedError('VALIDATION_FAILED', 'status must be all, active, hidden, or sold_out.');
      }
      filters.push(`p.status = $${params.length + 1}`);
      params.push(status);
    }

    if (args.max_stock !== undefined && args.max_stock !== null) {
      const stockParam = params.length + 1;
      filters.push(`(p.stock <= $${stockParam} or exists (select 1 from product_variants pv where pv.product_id = p.id and pv.stock <= $${stockParam}))`);
      params.push(requireNonNegativeAmount(args.max_stock, 'max_stock'));
    }

    const whereSql = filters.join(' and ');
    const [countResult, productResult] = await Promise.all([
      this.pool.query(`select count(*)::int as total from products p where ${whereSql}`, params),
      this.pool.query(
        `
          select p.id, p.site_id, p.site_category_id, p.sku, p.name, p.summary, p.base_price, p.sale_price, p.stock, p.status, p.sales_volume, p.created_at, p.updated_at,
                 c.name as category_name
          from products p
          left join site_categories c on c.id = p.site_category_id
          where ${whereSql}
          order by p.id desc
          limit $${params.length + 1} offset $${params.length + 2}
        `,
        [...params, perPage, offset]
      )
    ]);
    const total = Number.parseInt(countResult.rows[0]?.total ?? '0', 10);

    return {
      site,
      products: productResult.rows.map((product) => formatProductSummary(product)),
      pagination: {
        page,
        per_page: perPage,
        last_page: Math.max(1, Math.ceil(total / perPage)),
        total
      }
    };
  }

  async getProduct(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const product = await this.findProductForSite(site.id, requireInteger(args.product_id, 'product_id'));

    return {
      site,
      product: await this.formatProductWithRelations(product)
    };
  }

  async upsertProduct(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const productId = args.product_id === undefined || args.product_id === null ? null : requireInteger(args.product_id, 'product_id');
    const existing = productId ? await this.findProductForSite(site.id, productId) : null;
    const product = normalizeProductPayload(args, existing);
    const category = await this.findCategoryForSite(site.id, product.site_category_id);
    await this.assertCategoryIsLeaf(site.id, category.id);
    await this.assertProductSkuAvailable(site.id, product.sku, productId);

    if (!productId && product.primary_images.length === 0) {
      throw codedError('VALIDATION_FAILED', 'At least one primary image is required. Ask the user to provide a product main image before creating the product.');
    }

    if (productId && product.primary_images.length === 0) {
      const existingPrimaryCount = await this.countProductImages(productId, 'primary');
      if (existingPrimaryCount === 0) {
        throw codedError('VALIDATION_FAILED', 'At least one primary image is required. Ask the user to provide a product main image before updating the product.');
      }
    }

    await this.pool.query('BEGIN');

    try {
      const result = productId
        ? await this.pool.query(
          `
            update products
            set site_category_id = $1,
                variant_mode = $2,
                replace_image_by_variant = $3,
                sku = $4,
                name = $5,
                summary = $6,
                description = $7,
                base_price = $8,
                sale_price = $9,
                sale_ends_at = $10,
                cost_price = $11,
                stock = $12,
                buy_limit = $13,
                gift_coupon_template_id = $14,
                status = $15,
                is_service = $16,
                updated_at = now()
            where site_id = $17 and id = $18
            returning *
          `,
          [
            product.site_category_id,
            product.variant_mode,
            product.replace_image_by_variant,
            product.sku,
            product.name,
            product.summary,
            product.description,
            product.base_price,
            product.sale_price,
            product.sale_ends_at,
            product.cost_price,
            product.stock,
            product.buy_limit,
            product.gift_coupon_template_id,
            product.status,
            product.is_service,
            site.id,
            productId
          ]
        )
        : await this.pool.query(
          `
            insert into products (
              site_id, site_category_id, variant_mode, replace_image_by_variant, sku, name, slug, summary, description,
              base_price, sale_price, sale_ends_at, cost_price, stock, buy_limit, gift_coupon_template_id, status, is_service, created_at, updated_at
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, now(), now())
            returning *
          `,
          [
            site.id,
            product.site_category_id,
            product.variant_mode,
            product.replace_image_by_variant,
            product.sku,
            product.name,
            await this.uniqueProductSlug(site.id, product.name),
            product.summary,
            product.description,
            product.base_price,
            product.sale_price,
            product.sale_ends_at,
            product.cost_price,
            product.stock,
            product.buy_limit,
            product.gift_coupon_template_id,
            product.status,
            product.is_service
          ]
        );
      const savedProduct = result.rows[0];

      await this.syncProductChildRecords(site, savedProduct, product);
      await this.pool.query('COMMIT');

      return {
        ok: true,
        site,
        product: await this.formatProductWithRelations(savedProduct)
      };
    } catch (error) {
      await this.pool.query('ROLLBACK');
      throw error;
    }
  }

  async deleteProduct(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const product = await this.findProductForSite(site.id, requireInteger(args.product_id, 'product_id'));
    const images = await this.pool.query('select path from product_images where product_id = $1', [product.id]);

    for (const image of images.rows) {
      if (image.path && !/^https?:\/\//i.test(image.path)) {
        await this.storage.delete(image.path);
      }
    }

    await this.pool.query('delete from products where site_id = $1 and id = $2', [site.id, product.id]);

    return {
      ok: true,
      site,
      deleted_product_id: product.id,
      categories: (await this.listCategories(accountId, { site_id: site.id })).categories
    };
  }

  async inspectProductImport(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const dataset = await parseProductImportSource(args.source);
    const categories = await this.listProductImportCategories(site.id);

    return {
      site,
      dataset: productImportDatasetSummary(dataset),
      target_schema: productImportTargetSchema(),
      available_categories: categories,
      ai_mapping_prompt: productImportAiMappingPrompt(dataset, categories),
      guidance: productImportGuidance()
    };
  }

  async validateProductImport(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const dataset = await parseProductImportSource(args.source);
    const mapping = normalizeProductImportMapping(args.mapping);
    const validation = validateProductImportDataset(dataset, mapping);

    return {
      site,
      dataset: productImportDatasetSummary(dataset),
      mapping,
      validation,
      convertible: validation.convertible,
      failure_reasons: productImportFailureReasons(validation)
    };
  }

  async commitProductImport(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const dataset = await parseProductImportSource(args.source);
    const mapping = normalizeProductImportMapping(args.mapping);
    const validation = validateProductImportDataset(dataset, mapping);

    if (!validation.convertible) {
      throw codedError('VALIDATION_FAILED', 'Product import mapping is not convertible.', {
        validation,
        failure_reasons: productImportFailureReasons(validation)
      });
    }

    await this.pool.query('BEGIN');

    try {
      const importCategory = await this.ensureProductImportCategory(site.id);
      const categoryAssignments = await this.listLeafCategoryAssignments(site.id);
      const [usedSkus, usedSlugs] = await Promise.all([
        this.listExistingProductValues(site.id, 'sku'),
        this.listExistingProductValues(site.id, 'slug')
      ]);
      const preparedRows = prepareProductImportRows(dataset, mapping, site.id, importCategory.id, categoryAssignments, usedSkus, usedSlugs);
      let createdProducts = 0;

      for (const chunk of chunkArray(preparedRows, 100)) {
        createdProducts += await this.insertProductImportChunk(chunk, mapping);
      }

      await this.pool.query('COMMIT');

      return {
        ok: true,
        site,
        result: {
          created_products: createdProducts,
          matched_products: preparedRows.filter((row) => row.site_category_id !== importCategory.id).length,
          unmatched_products: preparedRows.filter((row) => row.site_category_id === importCategory.id).length,
          category: importCategory
        },
        validation
      };
    } catch (error) {
      await this.pool.query('ROLLBACK');
      throw error;
    }
  }

  async listCouponTemplates(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const page = clampPositiveInteger(args.page, 1, 1, 1000);
    const perPage = clampPositiveInteger(args.per_page, 8, 1, 50);
    const offset = (page - 1) * perPage;
    const filters = ['site_id = $1'];
    const params = [site.id];
    const issueTrigger = nullableString(args.issue_trigger);
    const keyword = nullableString(args.keyword);
    const status = nullableString(args.status) ?? 'all';

    if (issueTrigger) {
      filters.push(`issue_trigger = $${params.length + 1}`);
      params.push(normalizeCouponIssueTrigger(issueTrigger));
    }

    if (keyword) {
      filters.push(`name ilike $${params.length + 1}`);
      params.push(`%${keyword}%`);
    }

    if (status === 'active') {
      filters.push("(ends_at is null or ends_at >= current_date)");
    } else if (status === 'expired') {
      filters.push("ends_at is not null and ends_at < current_date");
    } else if (status !== 'all') {
      throw codedError('VALIDATION_FAILED', 'status must be all, active, or expired.');
    }

    const whereSql = filters.join(' and ');
    const [countResult, couponResult] = await Promise.all([
      this.pool.query(
        `
          select count(*)::int as total
          from coupon_templates
          where ${whereSql}
        `,
        params
      ),
      this.pool.query(
        `
          select id, site_id, name, discount_amount, minimum_spend, issue_trigger, trigger_amount, starts_at, ends_at, created_at, updated_at
          from coupon_templates
          where ${whereSql}
          order by updated_at desc, id desc
          limit $${params.length + 1} offset $${params.length + 2}
        `,
        [...params, perPage, offset]
      )
    ]);
    const total = Number.parseInt(countResult.rows[0]?.total ?? '0', 10);

    return {
      site,
      coupon_templates: couponResult.rows.map((couponTemplate) => formatCouponTemplate(couponTemplate)),
      guidance: couponToolGuidance(),
      pagination: {
        page,
        per_page: perPage,
        last_page: Math.max(1, Math.ceil(total / perPage)),
        total
      }
    };
  }

  async upsertCouponTemplate(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const couponTemplateId = args.coupon_template_id === undefined || args.coupon_template_id === null
      ? null
      : requireInteger(args.coupon_template_id, 'coupon_template_id');
    const existing = couponTemplateId ? await this.findCouponTemplateForSite(site.id, couponTemplateId) : null;
    const couponTemplate = normalizeCouponTemplate(args, existing);
    const result = couponTemplateId
      ? await this.pool.query(
        `
          update coupon_templates
          set name = $1,
              discount_amount = $2,
              minimum_spend = $3,
              issue_trigger = $4,
              trigger_amount = $5,
              starts_at = $6,
              ends_at = $7,
              updated_at = now()
          where site_id = $8 and id = $9
          returning id, site_id, name, discount_amount, minimum_spend, issue_trigger, trigger_amount, starts_at, ends_at, created_at, updated_at
        `,
        [
          couponTemplate.name,
          couponTemplate.discount_amount,
          couponTemplate.minimum_spend,
          couponTemplate.issue_trigger,
          couponTemplate.trigger_amount,
          couponTemplate.starts_at,
          couponTemplate.ends_at,
          site.id,
          couponTemplateId
        ]
      )
      : await this.pool.query(
        `
          insert into coupon_templates (site_id, name, discount_amount, minimum_spend, issue_trigger, trigger_amount, starts_at, ends_at, created_at, updated_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
          returning id, site_id, name, discount_amount, minimum_spend, issue_trigger, trigger_amount, starts_at, ends_at, created_at, updated_at
        `,
        [
          site.id,
          couponTemplate.name,
          couponTemplate.discount_amount,
          couponTemplate.minimum_spend,
          couponTemplate.issue_trigger,
          couponTemplate.trigger_amount,
          couponTemplate.starts_at,
          couponTemplate.ends_at
        ]
      );

    return {
      ok: true,
      site,
      coupon_template: formatCouponTemplate(result.rows[0]),
      guidance: couponToolGuidance()
    };
  }

	  async issueMemberCoupon(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const memberId = requireInteger(args.member_id, 'member_id');
    const couponTemplateId = requireInteger(args.coupon_template_id, 'coupon_template_id');
    const [member, couponTemplate] = await Promise.all([
      this.findMemberForSite(site.id, memberId),
      this.findCouponTemplateForSite(site.id, couponTemplateId)
    ]);

    if ((couponTemplate.issue_trigger ?? 'manual') !== 'manual') {
      throw codedError('VALIDATION_FAILED', 'slimweb_members_coupons_issue can only assign manual coupon templates. Use coupon_templates.upsert for all_members, order_threshold, birthday, or product_bundle rules.');
    }

    if (!couponDateRangeIsActive(couponTemplate)) {
      throw codedError('VALIDATION_FAILED', 'Manual coupon template is not active today.');
    }

    const duplicateResult = await this.pool.query(
      `
        select id
        from member_coupons
        where site_id = $1
          and member_id = $2
          and coupon_template_id = $3
          and status = 'issued'
          and revoked_at is null
          and (expires_at is null or expires_at >= current_date)
        limit 1
      `,
      [site.id, member.id, couponTemplate.id]
    );

    if (duplicateResult.rows.length > 0) {
      throw codedError('VALIDATION_FAILED', 'This member already has an active copy of this manual coupon.');
    }

    const result = await this.pool.query(
      `
        insert into member_coupons (site_id, member_id, coupon_template_id, status, issued_reason, issued_at, starts_at, expires_at, created_at, updated_at)
        values ($1, $2, $3, 'issued', 'manual', now(), $4, $5, now(), now())
        returning id, site_id, member_id, coupon_template_id, status, issued_reason, issued_at, starts_at, expires_at, revoked_at
      `,
      [site.id, member.id, couponTemplate.id, couponTemplate.starts_at, couponTemplate.ends_at]
    );

    return {
      ok: true,
      site,
      member: formatMemberSummary(member),
      coupon_template: formatCouponTemplate(couponTemplate),
      member_coupon: formatMemberCoupon(result.rows[0]),
	      guidance: couponToolGuidance()
	    };
	  }

	  async listMembers(accountId, args) {
	    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
	    const page = clampPositiveInteger(args.page, 1, 1, 1000);
	    const perPage = clampPositiveInteger(args.per_page, 20, 1, 100);
	    const offset = (page - 1) * perPage;
	    const filters = ['site_id = $1'];
	    const params = [site.id];
	    const keyword = nullableString(args.keyword);
	    const status = nullableString(args.status) ?? 'all';

	    if (keyword) {
	      filters.push(`(name ilike $${params.length + 1} or email ilike $${params.length + 1} or mobile ilike $${params.length + 1})`);
	      params.push(`%${keyword}%`);
	    }
	    if (status !== 'all') {
	      filters.push(`status = $${params.length + 1}`);
	      params.push(status);
	    }
	    if (args.min_spent !== undefined && args.min_spent !== null) {
	      filters.push(`total_spent_amount >= $${params.length + 1}`);
	      params.push(requireNonNegativeAmount(args.min_spent, 'min_spent'));
	    }
	    if (args.max_spent !== undefined && args.max_spent !== null) {
	      filters.push(`total_spent_amount <= $${params.length + 1}`);
	      params.push(requireNonNegativeAmount(args.max_spent, 'max_spent'));
	    }

	    const whereSql = filters.join(' and ');
	    const [countResult, membersResult] = await Promise.all([
	      this.pool.query(`select count(*)::int as total from members where ${whereSql}`, params),
	      this.pool.query(
	        `
	          select id, site_id, email, name, birthday, gender, mobile, status, country, zip, address,
	                 total_spent_amount, last_login_at, created_at, updated_at
	          from members
	          where ${whereSql}
	          order by updated_at desc, id desc
	          limit $${params.length + 1} offset $${params.length + 2}
	        `,
	        [...params, perPage, offset]
	      )
	    ]);
	    const total = Number.parseInt(countResult.rows[0]?.total ?? '0', 10);

	    return {
	      site,
	      members: membersResult.rows.map((member) => formatMemberDetail(member)),
	      pagination: {
	        page,
	        per_page: perPage,
	        last_page: Math.max(1, Math.ceil(total / perPage)),
	        total
	      }
	    };
	  }

	  async getMember(accountId, args) {
	    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
	    const member = await this.findMemberForSite(site.id, requireInteger(args.member_id, 'member_id'));
	    const [ordersResult, couponsResult, templatesResult] = await Promise.all([
	      this.pool.query(
	        `
	          select id, order_no, status, grand_total_amount, item_count, placed_at, created_at
	          from orders
	          where site_id = $1 and member_id = $2
	          order by placed_at desc nulls last, created_at desc
	          limit 10
	        `,
	        [site.id, member.id]
	      ),
	      this.pool.query(
	        `
	          select id, site_id, member_id, coupon_template_id, status, issued_reason, issued_at, starts_at, expires_at, revoked_at
	          from member_coupons
	          where site_id = $1 and member_id = $2
	          order by issued_at desc nulls last, id desc
	          limit 20
	        `,
	        [site.id, member.id]
	      ),
	      this.pool.query(
	        `
	          select id, site_id, name, discount_amount, minimum_spend, issue_trigger, trigger_amount, starts_at, ends_at, created_at, updated_at
	          from coupon_templates
	          where site_id = $1 and issue_trigger = 'manual'
	            and (starts_at is null or starts_at <= current_date)
	            and (ends_at is null or ends_at >= current_date)
	          order by name asc
	        `,
	        [site.id]
	      )
	    ]);

	    return {
	      site,
	      member: formatMemberDetail(member),
	      orders: ordersResult.rows.map((order) => ({
	        id: order.id,
	        order_no: order.order_no,
	        status: order.status,
	        grand_total_amount: Number.parseInt(order.grand_total_amount ?? '0', 10),
	        item_count: Number.parseInt(order.item_count ?? '0', 10),
	        placed_at: dateString(order.placed_at),
	        created_at: dateString(order.created_at)
	      })),
	      member_coupons: couponsResult.rows.map((coupon) => formatMemberCoupon(coupon)),
	      coupon_templates: templatesResult.rows.map((template) => formatCouponTemplate(template))
	    };
	  }

  async createNewsletter(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const recipientScope = normalizeNewsletterRecipientScope(args.recipient_scope);
    const memberNames = Array.isArray(args.member_names)
      ? Array.from(new Set(args.member_names.map((value) => String(value ?? '').trim()).filter(Boolean)))
      : [];
    const memberEmails = Array.isArray(args.member_emails)
      ? Array.from(new Set(args.member_emails.map((value, index) => {
          const email = normalizeEmailAddress(value);
          if (!email) {
            throw codedError('VALIDATION_FAILED', `member_emails[${index}] must be a valid email address.`);
          }
          return email;
        })))
      : [];
    const title = normalizeNewsletterTitle(args.title);
    const htmlContent = sanitizeEmailHtml(args.html_content);
    const scheduledAt = normalizeNewsletterScheduledAt(args.scheduled_at);

    if (recipientScope === 'members' && memberNames.length === 0 && memberEmails.length === 0) {
      throw codedError('VALIDATION_FAILED', 'member_names is required when recipient_scope is members unless member_emails are also provided.');
    }
    if (recipientScope === 'members' && memberEmails.length > 0 && memberNames.length === 0) {
      throw codedError('VALIDATION_FAILED', 'member_names is required when member_emails are provided.');
    }
    if (recipientScope === 'all' && (memberNames.length > 0 || memberEmails.length > 0)) {
      throw codedError('VALIDATION_FAILED', 'member_names and member_emails must be omitted when recipient_scope is all_members.');
    }

    if (recipientScope === 'members' && memberNames.length > 0 && memberEmails.length > 0 && memberNames.length !== memberEmails.length) {
      throw codedError('VALIDATION_FAILED', 'member_names and member_emails must have the same number of entries.');
    }

    let recipients = [];
    let resolvedMembers = [];

    if (recipientScope === 'members') {
      if (memberNames.length > 0 && memberEmails.length > 0) {
        recipients = memberNames.map((memberName, index) => ({
          member_id: null,
          member_name: memberName,
          member_email: memberEmails[index]
        }));
      } else {
        for (const memberName of memberNames) {
          const result = await this.pool.query(
            `
              select id, site_id, email, name, birthday, gender, mobile, status, country, zip, address,
                     total_spent_amount, last_login_at, created_at, updated_at
              from members
              where site_id = $1 and lower(name) = lower($2)
              order by id asc
            `,
            [site.id, memberName]
          );

          if (result.rows.length === 0) {
            throw codedError('VALIDATION_FAILED', `Member not found: ${memberName}`);
          }

          if (result.rows.length > 1) {
            return {
              requiresRecipientSelection: true,
              message: `Multiple members matched "${memberName}". Please choose one of the candidate email addresses.`,
              recipientName: memberName,
              candidateEmails: result.rows.map((member) => member.email).filter(Boolean),
              candidates: result.rows.map((member) => formatMemberSummary(member))
            };
          }

          const member = result.rows[0];
          resolvedMembers.push(member);
          recipients.push({
            member_id: member.id,
            member_name: member.name,
            member_email: member.email
          });
        }
      }
    }

    const now = new Date();
    const result = await this.pool.query(
      `
        insert into site_newsletters (site_id, title, recipient_scope, html_content, status, scheduled_at, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning id, site_id, title, recipient_scope, html_content, status, scheduled_at, sent_at, created_at, updated_at
      `,
      [site.id, title, recipientScope, htmlContent, 'pending', scheduledAt, now, now]
    );
    const newsletter = result.rows[0];

    if (recipientScope === 'members' && recipients.length > 0) {
      for (const recipient of recipients) {
        await this.pool.query(
          `
            insert into site_newsletter_recipients (site_newsletter_id, member_id, member_name, member_email, created_at, updated_at)
            values ($1, $2, $3, $4, now(), now())
          `,
          [newsletter.id, recipient.member_id, recipient.member_name, recipient.member_email]
        );
      }
    }

    return {
      ok: true,
      site,
      newsletter: formatNewsletter(newsletter),
      recipient_summary: {
        scope: recipientScope,
        count: recipientScope === 'members' ? recipients.length : null,
        member_names: recipients.map((recipient) => recipient.member_name),
        member_emails: recipients.map((recipient) => recipient.member_email),
        members: resolvedMembers.map((member) => formatMemberSummary(member)),
        all_members: recipientScope === 'all'
      },
      delivery: {
        action: 'created_newsletter',
        sends_immediately: false,
        scheduled_at: dateString(newsletter.scheduled_at)
      }
    };
  }

  async createPoster(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const productNames = normalizePosterProductNames(args.product_names);
    const aspectRatio = normalizePosterAspectRatio(args.aspect_ratio);
    const drawingPrompt = requireNonEmptyString(args.drawing_prompt, 'drawing_prompt');
    const products = [];

    for (const productName of productNames) {
      const matches = await this.findProductsForPoster(site, productName);
      if (matches.length === 0) {
        throw codedError('NOT_FOUND', `Product not found: ${productName}`);
      }
      if (matches.length > 1) {
        return {
          requiresProductSelection: true,
          message: `Multiple products matched "${productName}". Please choose the intended product.`,
          productName,
          matches
        };
      }

      products.push(matches[0]);
    }

    const url = `${this.weblessAppBaseUrl}/sites/${encodeURIComponent(site.slug)}/mcp-posters`;
    const startedAt = Date.now();
    const logContext = {
      url,
      site_id: site.id,
      site_slug: site.slug,
      aspect_ratio: aspectRatio,
      product_count: products.length,
      timeout_ms: POSTER_REQUEST_TIMEOUT_MS
    };
    this.logInfo('Webless poster request started', logContext);

    let payload;
    try {
      const response = await this.fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-slimweb-mcp-secret': this.requireWeblessMcpSecret()
        },
        dispatcher: POSTER_FETCH_DISPATCHER,
        signal: createTimeoutSignal(POSTER_REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          site_admin_id: accountId && typeof accountId === 'object' ? accountId.site_admin_id ?? site.site_admin_id ?? null : null,
          aspect_ratio: aspectRatio,
          drawing_prompt: drawingPrompt,
          products
        })
      });
      payload = await parseJsonResponse(response, 'Unable to create Webless poster');
      this.logInfo('Webless poster request finished', {
        ...logContext,
        status: response.status,
        duration_ms: Date.now() - startedAt
      });
      payload = await this.pollPosterJobIfQueued(payload, logContext, startedAt);
    } catch (error) {
      this.logError('Webless poster request failed', {
        ...logContext,
        duration_ms: Date.now() - startedAt,
        error_name: error?.name ?? 'Error',
        error_message: error?.message ?? String(error)
      });
      throw error;
    }

    return {
      ok: true,
      site,
      aspect_ratio: aspectRatio,
      drawing_prompt: drawingPrompt,
      products,
      ...payload
    };
  }

  async pollPosterJobIfQueued(payload, logContext, startedAt) {
    if (!payload?.queued || typeof payload.status_url !== 'string' || payload.status_url.trim() === '') {
      return payload;
    }

    const statusUrl = new URL(payload.status_url, this.weblessAppBaseUrl).toString();
    const deadlineAt = startedAt + POSTER_REQUEST_TIMEOUT_MS;
    this.logInfo('Webless poster job polling started', {
      ...logContext,
      job_id: payload.job_id ?? null,
      status_url: statusUrl
    });

    while (Date.now() < deadlineAt) {
      if (this.posterPollIntervalMs > 0) {
        await delay(Math.min(this.posterPollIntervalMs, Math.max(0, deadlineAt - Date.now())));
      }

      const response = await this.fetch(statusUrl, {
        method: 'GET',
        headers: {
          'x-slimweb-mcp-secret': this.requireWeblessMcpSecret()
        },
        dispatcher: POSTER_FETCH_DISPATCHER,
        signal: createTimeoutSignal(Math.max(1_000, Math.min(60_000, deadlineAt - Date.now())))
      });
      const statusPayload = await parseJsonResponse(response, 'Unable to read Webless poster status');
      const status = String(statusPayload?.status ?? '').toLowerCase();

      this.logInfo('Webless poster job poll received', {
        ...logContext,
        job_id: statusPayload?.job_id ?? payload.job_id ?? null,
        status,
        duration_ms: Date.now() - startedAt
      });

      if (status === 'completed') {
        return statusPayload;
      }

      if (status === 'failed') {
        const message = String(statusPayload?.message ?? statusPayload?.error?.message ?? 'Poster generation failed.').trim();
        throw codedError('UPSTREAM_ERROR', message || 'Poster generation failed.', {
          job_id: statusPayload?.job_id ?? payload.job_id ?? null,
          status
        });
      }
    }

    throw codedError('UPSTREAM_TIMEOUT', 'Poster generation did not finish before the MCP timeout.', {
      job_id: payload.job_id ?? null,
      timeout_ms: POSTER_REQUEST_TIMEOUT_MS
    });
  }

  logInfo(message, context) {
    try {
      this.logger?.info?.(message, context);
    } catch {
      // Logging should never change MCP tool behavior.
    }
  }

  logError(message, context) {
    try {
      this.logger?.error?.(message, context);
    } catch {
      // Logging should never change MCP tool behavior.
    }
  }

  async findProductsForPoster(site, productName) {
    const result = await this.pool.query(
      `
        select p.id, p.site_id, p.name, p.summary, p.description, p.status,
               (
                 select path
                 from product_images
                 where product_id = p.id and image_type = 'primary'
                 order by sort_order asc, id asc
                 limit 1
               ) as primary_image_path
        from products p
        where p.site_id = $1
          and lower(p.name) like lower($2) escape '\\'
        order by
          case when lower(p.name) = lower($3) then 0 else 1 end,
          p.id asc
        limit 10
      `,
      [site.id, `%${escapeLikePattern(productName)}%`, productName]
    );

    return result.rows.map((product) => ({
      id: product.id,
      name: product.name,
      summary: htmlToPlainText(product.summary ?? ''),
      description: htmlToPlainText(product.description ?? ''),
      status: product.status ?? null,
      primary_image_url: product.primary_image_path ? mediaUrlFor(this.publicSiteBaseUrl, product.primary_image_path) : null
    }));
  }

  async previewMemberEmail(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const recipientScope = normalizeEmailRecipientScope(args.recipient_scope);
    const memberIds = normalizeIntegerListWithAlias(args.member_ids, args.member_id, 'member_ids', 'member_id');
    const productIds = normalizeIntegerListWithAlias(args.product_ids, args.product_id, 'product_ids', 'product_id');
    const subject = normalizeEmailSubject(args.subject);
    const sanitizedContent = sanitizeEmailHtml(args.html_content);

    if (recipientScope === 'members' && memberIds.length === 0) {
      throw codedError('VALIDATION_FAILED', 'member_ids is required when recipient_scope is members.');
    }
    if (recipientScope === 'all_members' && memberIds.length > 0) {
      throw codedError('VALIDATION_FAILED', 'member_ids must be omitted when recipient_scope is all_members.');
    }

    const [members, products, layout, contactEmail] = await Promise.all([
      recipientScope === 'members' ? this.findMembersForEmail(site.id, memberIds) : Promise.resolve([]),
      productIds.length > 0 ? this.findProductsForEmail(site, productIds) : Promise.resolve([]),
      this.findMailLayoutForSite(site.id),
      this.findSiteContactEmail(site.id)
    ]);

    const productCardsHtml = renderEmailProductCards(products);
    const bodyHtml = `${sanitizedContent}${productCardsHtml}`;
    const previewHtml = renderEmailLayout(layout, site, this.publicSiteBaseUrl, bodyHtml);
    const confirmationToken = `confirm_${randomBytes(12).toString('hex')}`;
    const draftPayload = {
      version: 1,
      site_id: site.id,
      site_slug: site.slug,
      recipient_scope: recipientScope,
      member_ids: memberIds,
      product_ids: productIds,
      subject,
      html_content: sanitizedContent,
      rendered_html: previewHtml,
      bcc_contact_email: contactEmail,
      confirmation_token: confirmationToken,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60
    };

    return {
      ok: true,
      site,
      subject,
      recipient_summary: {
        scope: recipientScope,
        count: recipientScope === 'members' ? members.length : null,
        members: members.map((member) => formatMemberSummary(member)),
        all_members: recipientScope === 'all_members'
      },
      products,
      bcc_contact_email: contactEmail,
      sanitized_html_content: sanitizedContent,
      preview_html: previewHtml,
      email_draft_token: this.signMemberEmailDraft(draftPayload),
      confirmation_token: confirmationToken,
      guidance: {
        final_confirmation_required: true,
        send_tool: 'slimweb_member_email_send',
        send_rule: 'Only call slimweb_member_email_send after the user confirms this preview. Pass email_draft_token and confirmation_token unchanged.'
      }
    };
  }

  async sendMemberEmail(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const payload = this.verifyMemberEmailDraft(requireNonEmptyString(args.email_draft_token, 'email_draft_token'));
    const confirmationToken = requireNonEmptyString(args.confirmation_token, 'confirmation_token');

    if (Number.parseInt(payload.site_id, 10) !== Number.parseInt(site.id, 10)) {
      throw codedError('VALIDATION_FAILED', 'email_draft_token site does not match site_id.');
    }
    if (payload.confirmation_token !== confirmationToken) {
      throw codedError('VALIDATION_FAILED', 'confirmation_token does not match email_draft_token.');
    }

    const response = await this.fetch(`${this.weblessAppBaseUrl}/sites/${encodeURIComponent(site.slug)}/mcp-member-emails/send`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-slimweb-mcp-secret': this.requireWeblessMcpSecret()
      },
      body: JSON.stringify({
        recipient_scope: payload.recipient_scope,
        member_ids: payload.member_ids,
        product_ids: payload.product_ids,
        subject: payload.subject,
        html_content: payload.html_content,
        rendered_html: payload.rendered_html,
        bcc_contact_email: payload.bcc_contact_email
      })
    });

    const result = await parseJsonResponse(response, 'Unable to send Webless member email');
    return {
      ok: true,
      site,
      ...result
    };
  }

	  async listDiscountCodes(accountId, args) {
	    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
	    const page = clampPositiveInteger(args.page, 1, 1, 1000);
	    const perPage = clampPositiveInteger(args.per_page, 20, 1, 100);
	    const offset = (page - 1) * perPage;
	    const filters = ['site_id = $1'];
	    const params = [site.id];
	    const keyword = nullableString(args.keyword);
	    const platform = nullableString(args.platform);

	    if (keyword) {
	      filters.push(`code ilike $${params.length + 1}`);
	      params.push(`%${keyword}%`);
	    }
	    if (platform) {
	      filters.push(`platform = $${params.length + 1}`);
	      params.push(platform);
	    }

	    const whereSql = filters.join(' and ');
	    const [countResult, result] = await Promise.all([
	      this.pool.query(`select count(*)::int as total from discount_codes where ${whereSql}`, params),
	      this.pool.query(
	        `
	          select id, site_id, code, discount_percent, platform, order_count, order_total_amount, created_at, updated_at
	          from discount_codes
	          where ${whereSql}
	          order by updated_at desc, id desc
	          limit $${params.length + 1} offset $${params.length + 2}
	        `,
	        [...params, perPage, offset]
	      )
	    ]);
	    const total = Number.parseInt(countResult.rows[0]?.total ?? '0', 10);

	    return {
	      site,
	      discount_codes: result.rows.map((row) => formatDiscountCode(row)),
	      pagination: {
	        page,
	        per_page: perPage,
	        last_page: Math.max(1, Math.ceil(total / perPage)),
	        total
	      }
	    };
	  }

	  async upsertDiscountCode(accountId, args) {
	    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
	    const discountCodeId = args.discount_code_id === undefined || args.discount_code_id === null ? null : requireInteger(args.discount_code_id, 'discount_code_id');
	    const code = requireNonEmptyString(args.code, 'code').toUpperCase();
	    const discountPercent = requireRatio(args.discount_percent, 'discount_percent');
	    const platform = nullableString(args.platform);

	    if (!/^[A-Z0-9]{1,10}$/.test(code)) {
	      throw codedError('VALIDATION_FAILED', 'code must contain only letters and numbers and be at most 10 characters.');
	    }

	    const duplicate = await this.pool.query(
	      `
	        select id
	        from discount_codes
	        where site_id = $1 and code = $2 and ($3::bigint is null or id != $3::bigint)
	        limit 1
	      `,
	      [site.id, code, discountCodeId]
	    );
	    if (duplicate.rows.length > 0) {
	      throw codedError('VALIDATION_FAILED', 'This discount code already exists.');
	    }

	    const result = discountCodeId
	      ? await this.pool.query(
	        `
	          update discount_codes
	          set code = $1, discount_percent = $2, platform = $3, updated_at = now()
	          where site_id = $4 and id = $5
	          returning id, site_id, code, discount_percent, platform, order_count, order_total_amount, created_at, updated_at
	        `,
	        [code, discountPercent, platform, site.id, discountCodeId]
	      )
	      : await this.pool.query(
	        `
	          insert into discount_codes (site_id, code, discount_percent, platform, created_at, updated_at)
	          values ($1, $2, $3, $4, now(), now())
	          returning id, site_id, code, discount_percent, platform, order_count, order_total_amount, created_at, updated_at
	        `,
	        [site.id, code, discountPercent, platform]
	      );

	    return { ok: true, site, discount_code: formatDiscountCode(result.rows[0]) };
	  }

	  async listMemberTiers(accountId, args) {
	    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
	    const result = await this.pool.query(
	      `
	        select id, site_id, name, min_spend, discount_percent, created_at, updated_at
	        from member_tiers
	        where site_id = $1
	        order by min_spend desc, id asc
	      `,
	      [site.id]
	    );

	    return {
	      site,
	      member_tiers: result.rows.map((tier) => formatMemberTier(tier))
	    };
	  }

	  async upsertMemberTier(accountId, args) {
	    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
	    const memberTierId = args.member_tier_id === undefined || args.member_tier_id === null ? null : requireInteger(args.member_tier_id, 'member_tier_id');
	    const name = requireNonEmptyString(args.name, 'name');
	    const minSpend = requireNonNegativeAmount(args.min_spend ?? args.threshold_amount ?? 0, 'min_spend');
	    const discountPercent = args.discount_percent === undefined || args.discount_percent === null ? 1 : requireRatio(args.discount_percent, 'discount_percent', true);

	    const duplicate = await this.pool.query(
	      `
	        select id
	        from member_tiers
	        where site_id = $1 and (name = $2 or min_spend = $3) and ($4::bigint is null or id != $4::bigint)
	        limit 1
	      `,
	      [site.id, name, minSpend, memberTierId]
	    );
	    if (duplicate.rows.length > 0) {
	      throw codedError('VALIDATION_FAILED', 'Member tier name or min_spend already exists.');
	    }

	    const result = memberTierId
	      ? await this.pool.query(
	        `
	          update member_tiers
	          set name = $1, min_spend = $2, discount_percent = $3, updated_at = now()
	          where site_id = $4 and id = $5
	          returning id, site_id, name, min_spend, discount_percent, created_at, updated_at
	        `,
	        [name, minSpend, discountPercent, site.id, memberTierId]
	      )
	      : await this.pool.query(
	        `
	          insert into member_tiers (site_id, name, min_spend, discount_percent, created_at, updated_at)
	          values ($1, $2, $3, $4, now(), now())
	          returning id, site_id, name, min_spend, discount_percent, created_at, updated_at
	        `,
	        [site.id, name, minSpend, discountPercent]
	      );

	    return { ok: true, site, member_tier: formatMemberTier(result.rows[0]) };
	  }

	  async listThresholdGifts(accountId, args) {
	    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
	    const filters = ['tg.site_id = $1'];
	    const params = [site.id];
	    if (args.is_active !== undefined && args.is_active !== null) {
	      filters.push(`tg.is_active = $${params.length + 1}`);
	      params.push(Boolean(args.is_active));
	    }
	    const result = await this.pool.query(
	      `
	        select tg.id, tg.site_id, tg.threshold_amount, tg.product_id, p.name as product_name,
	               tg.sort_order, tg.is_active, tg.created_at, tg.updated_at
	        from threshold_gifts tg
	        left join products p on p.id = tg.product_id and p.site_id = tg.site_id
	        where ${filters.join(' and ')}
	        order by tg.is_active desc, tg.sort_order asc, tg.threshold_amount asc, tg.id asc
	      `,
	      params
	    );

	    return {
	      site,
	      threshold_gifts: result.rows.map((gift) => formatThresholdGift(gift))
	    };
	  }

	  async upsertThresholdGift(accountId, args) {
	    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
	    const thresholdGiftId = args.threshold_gift_id === undefined || args.threshold_gift_id === null ? null : requireInteger(args.threshold_gift_id, 'threshold_gift_id');
	    const existing = thresholdGiftId ? await this.findThresholdGiftForSite(site.id, thresholdGiftId) : null;
	    const thresholdAmount = requirePositiveAmount(args.threshold_amount ?? existing?.threshold_amount, 'threshold_amount');
	    const productId = args.product_id === undefined || args.product_id === null
	      ? (existing ? existing.product_id : null)
	      : requireInteger(args.product_id, 'product_id');
	    if (!productId) {
	      throw codedError('VALIDATION_FAILED', 'product_id is required when creating a threshold gift.');
	    }
	    await this.findProductForSite(site.id, productId);
	    const sortOrder = args.sort_order === undefined || args.sort_order === null ? Number.parseInt(existing?.sort_order ?? '0', 10) : requireNonNegativeAmount(args.sort_order, 'sort_order');
	    const isActive = args.is_active === undefined || args.is_active === null ? Boolean(existing?.is_active ?? true) : Boolean(args.is_active);

	    const result = thresholdGiftId
	      ? await this.pool.query(
	        `
	          update threshold_gifts
	          set threshold_amount = $1, product_id = $2, sort_order = $3, is_active = $4, updated_at = now()
	          where site_id = $5 and id = $6
	          returning id, site_id, threshold_amount, product_id, sort_order, is_active, created_at, updated_at
	        `,
	        [thresholdAmount, productId, sortOrder, isActive, site.id, thresholdGiftId]
	      )
	      : await this.pool.query(
	        `
	          insert into threshold_gifts (site_id, threshold_amount, product_id, sort_order, is_active, created_at, updated_at)
	          values ($1, $2, $3, $4, $5, now(), now())
	          returning id, site_id, threshold_amount, product_id, sort_order, is_active, created_at, updated_at
	        `,
	        [site.id, thresholdAmount, productId, sortOrder, isActive]
	      );

	    return { ok: true, site, threshold_gift: formatThresholdGift(result.rows[0]) };
	  }

	  async listProductAddOns(accountId, args) {
	    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
	    const filters = ['pao.site_id = $1'];
	    const params = [site.id];
	    if (args.product_id !== undefined && args.product_id !== null) {
	      filters.push(`pao.product_id = $${params.length + 1}`);
	      params.push(requireInteger(args.product_id, 'product_id'));
	    }
	    if (args.is_active !== undefined && args.is_active !== null) {
	      filters.push(`pao.is_active = $${params.length + 1}`);
	      params.push(Boolean(args.is_active));
	    }
	    const result = await this.pool.query(
	      `
	        select pao.id, pao.site_id, pao.product_id, p.name as product_name,
	               pao.add_on_product_id, ap.name as add_on_product_name,
	               pao.add_on_price, pao.max_quantity, pao.sort_order, pao.is_active,
	               pao.created_at, pao.updated_at
	        from product_add_ons pao
	        left join products p on p.id = pao.product_id and p.site_id = pao.site_id
	        left join products ap on ap.id = pao.add_on_product_id and ap.site_id = pao.site_id
	        where ${filters.join(' and ')}
	        order by pao.product_id asc, pao.sort_order asc, pao.id asc
	      `,
	      params
	    );

	    return {
	      site,
	      product_add_ons: result.rows.map((addOn) => formatProductAddOn(addOn))
	    };
	  }

	  async upsertProductAddOn(accountId, args) {
	    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
	    const addOnId = args.product_add_on_id === undefined || args.product_add_on_id === null ? null : requireInteger(args.product_add_on_id, 'product_add_on_id');
	    const existing = addOnId ? await this.findProductAddOnForSite(site.id, addOnId) : null;
	    const productId = args.product_id === undefined || args.product_id === null ? existing?.product_id : requireInteger(args.product_id, 'product_id');
	    const addOnProductId = args.add_on_product_id === undefined || args.add_on_product_id === null ? existing?.add_on_product_id : requireInteger(args.add_on_product_id, 'add_on_product_id');
	    if (!productId || !addOnProductId) {
	      throw codedError('VALIDATION_FAILED', 'product_id and add_on_product_id are required.');
	    }
	    if (String(productId) === String(addOnProductId)) {
	      throw codedError('VALIDATION_FAILED', 'add_on_product_id cannot be the same product as product_id.');
	    }
	    await Promise.all([this.findProductForSite(site.id, productId), this.findProductForSite(site.id, addOnProductId)]);
	    const addOnPrice = args.add_on_price === undefined || args.add_on_price === null ? Number.parseInt(existing?.add_on_price ?? '0', 10) : requireNonNegativeAmount(args.add_on_price, 'add_on_price');
	    const maxQuantity = args.max_quantity === undefined || args.max_quantity === null ? Number.parseInt(existing?.max_quantity ?? '1', 10) : requirePositiveAmount(args.max_quantity, 'max_quantity');
	    const sortOrder = args.sort_order === undefined || args.sort_order === null ? Number.parseInt(existing?.sort_order ?? '0', 10) : requireNonNegativeAmount(args.sort_order, 'sort_order');
	    const isActive = args.is_active === undefined || args.is_active === null ? Boolean(existing?.is_active ?? true) : Boolean(args.is_active);

	    const duplicate = await this.pool.query(
	      `
	        select id
	        from product_add_ons
	        where site_id = $1 and product_id = $2 and add_on_product_id = $3 and ($4::bigint is null or id != $4::bigint)
	        limit 1
	      `,
	      [site.id, productId, addOnProductId, addOnId]
	    );
	    if (duplicate.rows.length > 0) {
	      throw codedError('VALIDATION_FAILED', 'This product add-on rule already exists.');
	    }

	    const result = addOnId
	      ? await this.pool.query(
	        `
	          update product_add_ons
	          set product_id = $1, add_on_product_id = $2, add_on_price = $3, max_quantity = $4,
	              sort_order = $5, is_active = $6, updated_at = now()
	          where site_id = $7 and id = $8
	          returning id, site_id, product_id, add_on_product_id, add_on_price, max_quantity, sort_order, is_active, created_at, updated_at
	        `,
	        [productId, addOnProductId, addOnPrice, maxQuantity, sortOrder, isActive, site.id, addOnId]
	      )
	      : await this.pool.query(
	        `
	          insert into product_add_ons (site_id, product_id, add_on_product_id, add_on_price, max_quantity, sort_order, is_active, created_at, updated_at)
	          values ($1, $2, $3, $4, $5, $6, $7, now(), now())
	          returning id, site_id, product_id, add_on_product_id, add_on_price, max_quantity, sort_order, is_active, created_at, updated_at
	        `,
	        [site.id, productId, addOnProductId, addOnPrice, maxQuantity, sortOrder, isActive]
	      );

	    return { ok: true, site, product_add_on: formatProductAddOn(result.rows[0]) };
	  }

	  async listCustomerServiceLogs(accountId, args) {
	    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
	    const page = clampPositiveInteger(args.page, 1, 1, 1000);
	    const perPage = clampPositiveInteger(args.per_page, 20, 1, 100);
	    const offset = (page - 1) * perPage;
	    const filters = ['csl.site_id = $1'];
	    const params = [site.id];
	    const keyword = nullableString(args.keyword);
	    if (args.member_id !== undefined && args.member_id !== null) {
	      filters.push(`csl.member_id = $${params.length + 1}`);
	      params.push(requireInteger(args.member_id, 'member_id'));
	    }
	    if (keyword) {
	      filters.push(`(csl.visitor_name ilike $${params.length + 1} or csl.ip_address ilike $${params.length + 1} or csl.messages::text ilike $${params.length + 1})`);
	      params.push(`%${keyword}%`);
	    }

	    const whereSql = filters.join(' and ');
	    const [countResult, result] = await Promise.all([
	      this.pool.query(`select count(*)::int as total from customer_service_logs csl where ${whereSql}`, params),
	      this.pool.query(
	        `
	          select csl.id, csl.site_id, csl.member_id, csl.session_key, csl.ip_address, csl.visitor_name,
	                 csl.messages, csl.created_at, csl.updated_at,
	                 m.name as member_name, m.email as member_email
	          from customer_service_logs csl
	          left join members m on m.id = csl.member_id and m.site_id = csl.site_id
	          where ${whereSql}
	          order by csl.updated_at desc, csl.id desc
	          limit $${params.length + 1} offset $${params.length + 2}
	        `,
	        [...params, perPage, offset]
	      )
	    ]);
	    const total = Number.parseInt(countResult.rows[0]?.total ?? '0', 10);

	    return {
	      site,
	      logs: result.rows.map((log) => formatCustomerServiceLog(log)),
	      pagination: {
	        page,
	        per_page: perPage,
	        last_page: Math.max(1, Math.ceil(total / perPage)),
	        total
	      }
	    };
	  }

	  async getCustomerServiceSettings(accountId, args) {
	    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
	    const result = await this.pool.query(
	      `
	        select use_ai_customer_service, ai_customer_service_question_limit,
	               ai_customer_service_retention_days, ai_customer_service_prompt,
	               ai_customer_service_avatar_path
	        from sites
	        where id = $1
	        limit 1
	      `,
	      [site.id]
	    );

	    return {
	      site,
	      settings: formatCustomerServiceSettings(result.rows[0] ?? {})
	    };
	  }

	  async updateCustomerServiceSettings(accountId, args) {
	    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
	    const current = (await this.getCustomerServiceSettings(accountId, { site_id: site.id })).settings;
	    const next = {
	      use_ai_customer_service: Object.prototype.hasOwnProperty.call(args, 'use_ai_customer_service') ? Boolean(args.use_ai_customer_service) : current.use_ai_customer_service,
	      ai_customer_service_question_limit: Object.prototype.hasOwnProperty.call(args, 'ai_customer_service_question_limit') ? requirePositiveAmount(args.ai_customer_service_question_limit, 'ai_customer_service_question_limit') : current.ai_customer_service_question_limit,
	      ai_customer_service_retention_days: Object.prototype.hasOwnProperty.call(args, 'ai_customer_service_retention_days') ? requirePositiveAmount(args.ai_customer_service_retention_days, 'ai_customer_service_retention_days') : current.ai_customer_service_retention_days,
	      ai_customer_service_prompt: Object.prototype.hasOwnProperty.call(args, 'ai_customer_service_prompt') ? nullableString(args.ai_customer_service_prompt) : current.ai_customer_service_prompt
	    };
	    const result = await this.pool.query(
	      `
	        update sites
	        set use_ai_customer_service = $1,
	            ai_customer_service_question_limit = $2,
	            ai_customer_service_retention_days = $3,
	            ai_customer_service_prompt = $4,
	            updated_at = now()
	        where id = $5
	        returning use_ai_customer_service, ai_customer_service_question_limit,
	                  ai_customer_service_retention_days, ai_customer_service_prompt,
	                  ai_customer_service_avatar_path
	      `,
	      [
	        next.use_ai_customer_service,
	        next.ai_customer_service_question_limit,
	        next.ai_customer_service_retention_days,
	        next.ai_customer_service_prompt,
	        site.id
	      ]
	    );

	    return {
	      ok: true,
	      site,
	      settings: formatCustomerServiceSettings(result.rows[0] ?? next)
	    };
	  }

	  async createExport(accountId, args) {
	    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
	    const exportType = String(args.export_type ?? '').trim();
	    const format = String(args.format ?? 'json').trim().toLowerCase();
	    const limit = clampPositiveInteger(args.limit, 100, 1, 1000);
	    if (!['members', 'orders', 'returns'].includes(exportType)) {
	      throw codedError('VALIDATION_FAILED', 'export_type must be members, orders, or returns.');
	    }
	    if (!['json', 'csv'].includes(format)) {
	      throw codedError('VALIDATION_FAILED', 'format must be json or csv.');
	    }

	    const rows = await this.exportRows(site.id, exportType, limit);
	    return {
	      ok: true,
	      site,
	      export: {
	        type: exportType,
	        format,
	        row_count: rows.length,
	        generated_at: new Date().toISOString(),
	        rows,
	        csv: format === 'csv' ? toCsv(rows) : null,
	        contains_personal_data: ['members', 'orders', 'returns'].includes(exportType)
	      }
	    };
	  }

	  async listAuditLogs(accountId, args) {
	    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
	    const limit = clampPositiveInteger(args.limit, 50, 1, 200);
	    const tableName = await this.firstExistingTable(['mcp_tool_executions', 'mcp_tool_execution_logs']);
	    if (!tableName) {
	      return {
	        site,
	        audit_logs: [],
	        audit_available: false,
	        note: 'No MCP audit table exists in the connected Webless database.'
	      };
	    }

	    const params = [site.id];
	    const filters = ['site_id = $1'];
	    const toolName = nullableString(args.tool_name);
	    if (toolName) {
	      filters.push(`tool_name = $${params.length + 1}`);
	      params.push(toolName);
	    }
	    const result = await this.pool.query(
	      `
	        select *
	        from ${tableName}
	        where ${filters.join(' and ')}
	        order by created_at desc, id desc
	        limit $${params.length + 1}
	      `,
	      [...params, limit]
	    );

	    return {
	      site,
	      audit_available: true,
	      audit_logs: result.rows.map((row) => ({
	        id: row.id,
	        tool_name: row.tool_name ?? row.name ?? '',
	        result: row.result ?? row.status ?? '',
	        actor: row.actor_email ?? row.email ?? null,
	        created_at: dateString(row.created_at),
	        metadata: parseJsonObject(row.metadata ?? row.payload ?? row.data)
	      }))
	    };
	  }
	
  async getPagePreviewUrl(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const pageKey = normalizePageKey(args.page_key ?? 'index');
    const theme = pageKey === 'index'
      ? siteLevelHomepageTheme(site)
      : await this.resolveThemeForSite(site.id, args.theme_id);
    const url = new URL(this.previewUrlFor(site, pageKey, theme.id));

    return {
      site,
      page_key: pageKey,
      theme,
      url: url.toString(),
      mode: args.mode === 'published' ? 'published' : 'preview',
      supports_theme_parameter: pageKey !== 'index'
    };
  }

  async deletePage(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const pageKey = normalizePageKey(args.page_key);

    if (FIXED_TEMPLATE_PAGE_KEYS.has(pageKey)) {
      throw codedError('VALIDATION_FAILED', 'Fixed template pages cannot be deleted.');
    }

    await this.storage.deleteDirectory(`sites/${site.id}/templates/default/pages/${pageKey}`);

    const schemes = await this.pool.query(
      `
        select id
        from site_pages
        where site_id = $1 and is_default = false
      `,
      [site.id]
    );

    for (const scheme of schemes.rows) {
      await this.storage.deleteDirectory(`sites/${site.id}/templates/schemes/${scheme.id}/pages/${pageKey}`);
    }

    return {
      ok: true,
      site,
      deleted_page_key: pageKey
    };
  }

  async getHomeContent(accountId, args) {
    return this.getPageContent(accountId, {
      site_id: args.site_id,
      page_name: 'index'
    });
  }

  async listPages(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const previewTheme = args.theme_id === undefined || args.theme_id === null || String(args.theme_id).trim() === ''
      ? null
      : await this.resolveThemeForSite(site.id, args.theme_id);
    const previewThemeId = previewTheme?.id ?? 'default';
    const customPages = await this.listCustomPagesForSite(site, {
      includeHtml: false,
      previewThemeId
    });
    const fixedPages = fixedTemplatePages().map((page) => ({
      ...page,
      type: 'fixed',
      is_fixed: true,
      can_edit: isEditableFixedPageKey(page.page_key),
      can_delete: false,
      public_url: this.previewUrlFor(site, page.page_key, previewThemeId),
      preview_url: this.previewUrlFor(site, page.page_key, previewThemeId)
    }));
    const pages = [...fixedPages, ...customPages];

    pages.sort((left, right) => left.title.localeCompare(right.title, 'zh-Hant'));

    return {
      site,
      pages
    };
  }

  async getPageContent(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const pageName = requireNonEmptyString(args.page_name, 'page_name');
    const pageRecord = await this.findPageForSite(site, pageName, { includeHtml: true });
    if (!pageRecord || (pageRecord.is_fixed && !isEditableFixedPageKey(pageRecord.page_key))) {
      throw codedError('NOT_FOUND', `Page not found or not accessible: ${pageName}`);
    }

    return {
      site,
      page_name: pageName,
      ...pageRecord
    };
  }

  async checkPageTitle(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const title = requireNonEmptyString(args.title, 'title');
    const { matches } = await this.findPageTitleMatchesForSite(site, title);

    return {
      site,
      title,
      normalized_title: normalizeTitleMatch(title),
      exists: matches.length > 0,
      matches
    };
  }

  async createPage(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const title = requireNonEmptyString(args.title, 'title');
    const html = extractHtmlContent(args.content);
    const enabledLibraries = normalizePageEnabledLibraries(args.enabled_libraries ?? args.content?.enabled_libraries);
    const storedHtml = pageHtmlWithManagedLibraries(html, enabledLibraries);
    const { matches } = await this.findPageTitleMatchesForSite(site, title);
    if (matches.length > 0) {
      throw codedError('CONFLICT', 'Page title already exists.', { matches });
    }

    const existingKeys = new Set([
      ...FIXED_TEMPLATE_PAGE_KEYS,
      ...(await this.listCustomPagesForSite(site, { includeHtml: false })).map((page) => page.page_key)
    ]);
    const requestedPageKey = nullableString(args.page_key);
    const pageKeyBase = requestedPageKey
      ? normalizePageKey(requestedPageKey)
      : safeGeneratedPageKey(title, `page-${site.id}`);
    const pageKey = uniqueValue(pageKeyBase, existingKeys, 120);
    const theme = siteLevelHomepageTheme(site);
    const storagePath = pageContentStoragePath(site.id, theme, pageKey);
    const metadataPath = customPageMetadataStoragePath(site.id, pageKey);
    const metadata = {
      key: pageKey,
      name: title,
      enabled_libraries: enabledLibraries,
      updated_at: new Date().toISOString()
    };

    await this.storage.write(storagePath, Buffer.from(storedHtml.trim() + '\n', 'utf8'), 'text/x-php; charset=utf-8');
    await this.storage.write(metadataPath, Buffer.from(JSON.stringify(metadata, null, 2) + '\n', 'utf8'), 'application/json; charset=utf-8');

    return {
      ok: true,
      site,
      page_key: pageKey,
      title,
      theme,
      storage_path: storagePath,
      metadata_path: metadataPath,
      enabled_libraries: enabledLibraries,
      public_url: this.customPagePublicUrlFor(site, pageKey),
      preview_url: this.previewUrlFor(site, pageKey, theme.id),
      bytes_written: Buffer.byteLength(storedHtml.trim() + '\n')
    };
  }

  async updatePage(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const pageName = requireNonEmptyString(args.page_name, 'page_name');
    const html = extractHtmlContent(args.content);
    const enabledLibraries = normalizePageEnabledLibraries(args.enabled_libraries ?? args.content?.enabled_libraries);
    const storedHtml = pageHtmlWithManagedLibraries(html, enabledLibraries);
    const pageRecord = await this.findPageForSite(site, pageName, { includeHtml: true });

    if (!pageRecord) {
      throw codedError('NOT_FOUND', `Page not found or not accessible: ${pageName}`);
    }

    if (pageRecord.is_fixed && !isEditableFixedPageKey(pageRecord.page_key)) {
      throw codedError('VALIDATION_FAILED', 'Fixed template pages cannot be modified.');
    }

    if (isEditableFixedPageKey(pageRecord.page_key)) {
      const theme = siteLevelHomepageTheme(site);
      const storagePath = pageRecord.storage_path ?? homeContentStoragePath(site.id);

      await this.storage.write(storagePath, Buffer.from(storedHtml.trim() + '\n', 'utf8'), 'text/x-php; charset=utf-8');

      return {
        ok: true,
        site,
        page_key: pageRecord.page_key,
        title: pageRecord.title,
        theme,
        storage_path: storagePath,
        metadata_path: null,
        enabled_libraries: enabledLibraries,
        public_url: pageRecord.public_url,
        preview_url: pageRecord.preview_url,
        bytes_written: Buffer.byteLength(storedHtml.trim() + '\n')
      };
    }

    const currentTitle = pageRecord.title;
    const nextTitle = nullableString(args.title) ?? currentTitle;
    if (normalizeTitleMatch(nextTitle) !== normalizeTitleMatch(currentTitle)) {
      const { matches } = await this.findPageTitleMatchesForSite(site, nextTitle);
      const conflictingMatches = matches.filter((match) => match.page_key !== pageRecord.page_key);
      if (conflictingMatches.length > 0) {
        throw codedError('CONFLICT', 'Page title already exists.', { matches: conflictingMatches });
      }
    }

    const theme = siteLevelHomepageTheme(site);
    const storagePath = pageContentStoragePath(site.id, theme, pageRecord.page_key);
    const metadataPath = customPageMetadataStoragePath(site.id, pageRecord.page_key);
    const existingMetadata = parseJsonObject(await this.storage.readText(metadataPath));
    const metadata = {
      ...existingMetadata,
      key: pageRecord.page_key,
      name: nextTitle,
      enabled_libraries: enabledLibraries,
      updated_at: new Date().toISOString()
    };

    await this.storage.write(storagePath, Buffer.from(storedHtml.trim() + '\n', 'utf8'), 'text/x-php; charset=utf-8');
    await this.storage.write(metadataPath, Buffer.from(JSON.stringify(metadata, null, 2) + '\n', 'utf8'), 'application/json; charset=utf-8');

    return {
      ok: true,
      site,
      page_key: pageRecord.page_key,
      title: nextTitle,
      theme,
      storage_path: storagePath,
      metadata_path: metadataPath,
      enabled_libraries: enabledLibraries,
      public_url: this.customPagePublicUrlFor(site, pageRecord.page_key),
      preview_url: this.previewUrlFor(site, pageRecord.page_key, theme.id),
      bytes_written: Buffer.byteLength(storedHtml.trim() + '\n')
    };
  }

  async updateContentSeo(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const workflowContext = requireContentSeoWorkflowContext(args.workflow_context);
    const contentType = requireContentSeoType(args.content_type);
    validateContentSeoWorkflow(contentType, workflowContext);
    const seo = normalizeContentSeoPayload(args);

    if (contentType === 'page') {
      const pageName = requireNonEmptyString(args.page_name ?? args.page_key, 'page_name');
      const pageRecord = await this.getPageContent(accountId, {
        site_id: site.id,
        page_name: pageName
      });
      const metadataPath = customPageMetadataStoragePath(site.id, pageRecord.page_key);
      const metadata = {
        ...parseJsonObject(await this.storage.readText(metadataPath)),
        key: pageRecord.page_key,
        name: pageRecord.title,
        seo,
        seo_updated_at: new Date().toISOString()
      };

      await this.storage.write(metadataPath, Buffer.from(JSON.stringify(metadata, null, 2) + '\n', 'utf8'), 'application/json; charset=utf-8');

      return {
        ok: true,
        site,
        content_type: contentType,
        workflow_context: workflowContext,
        page: {
          page_key: pageRecord.page_key,
          title: pageRecord.title,
          public_url: pageRecord.public_url,
          preview_url: pageRecord.preview_url
        },
        seo,
        metadata_path: metadataPath
      };
    }

    const articleId = requireInteger(args.article_id, 'article_id');
    const article = await this.findArticleForSite(site.id, articleId);
    const metadataPath = articleSeoMetadataStoragePath(site.id, articleId);
    const metadata = {
      article_id: articleId,
      title: article.title,
      seo,
      seo_updated_at: new Date().toISOString()
    };

    await this.storage.write(metadataPath, Buffer.from(JSON.stringify(metadata, null, 2) + '\n', 'utf8'), 'application/json; charset=utf-8');

    return {
      ok: true,
      site,
      content_type: contentType,
      workflow_context: workflowContext,
      article: formatArticle(article, site, this.publicSiteBaseUrl, false),
      seo,
      metadata_path: metadataPath
    };
  }

  async listCustomPagesForSite(site, { includeHtml = false, previewThemeId = 'default' } = {}) {
    const directory = `sites/${site.id}/templates/default/pages`;
    const files = await this.storage.listFiles(directory);
    const keys = [...new Set(files
      .map((file) => file.slice(directory.length + 1).split('/')[0])
      .filter((key) => key && !FIXED_TEMPLATE_PAGE_KEYS.has(key) && /^[a-z0-9][a-z0-9_-]{1,99}$/.test(key)))];

    const pages = [];
    for (const key of keys) {
      const metadataPath = customPageMetadataStoragePath(site.id, key);
      const contentPath = pageContentStoragePath(site.id, siteLevelHomepageTheme(site), key);
      const bodyPath = `${directory}/${key}/body.blade.php`;
      const metadata = parseJsonObject(await this.storage.readText(metadataPath));
      const storedHtml = await this.storage.readText(contentPath) ?? await this.storage.readText(bodyPath) ?? '';
      const html = stripManagedPageLibraryBlock(storedHtml);
      const enabledLibraries = normalizePageEnabledLibraries(metadata.enabled_libraries ?? extractManagedPageLibraries(storedHtml));
      const title = nullableString(metadata.name) || headlineFromPageKey(key);

      pages.push({
        page_key: key,
        title,
        type: 'custom',
        is_fixed: false,
        can_edit: true,
        can_delete: true,
        public_url: previewThemeId === 'default'
          ? this.customPagePublicUrlFor(site, key)
          : this.previewUrlFor(site, key, previewThemeId),
        preview_url: this.previewUrlFor(site, key, previewThemeId),
        storage_path: html !== '' ? contentPath : null,
        metadata_path: metadataPath,
        enabled_libraries: enabledLibraries,
        ...(includeHtml ? { html } : {})
      });
    }

    pages.sort((left, right) => left.title.localeCompare(right.title, 'zh-Hant'));

    return pages;
  }

  async findPageForSite(site, pageName, { includeHtml = false } = {}) {
    const lookup = normalizeTitleMatch(pageName);
    const customPages = await this.listCustomPagesForSite(site, { includeHtml });
    const fixedPages = fixedTemplatePages().map((page) => ({
      ...page,
      type: 'fixed',
      is_fixed: true,
      can_edit: isEditableFixedPageKey(page.page_key),
      can_delete: false,
      public_url: this.previewUrlFor(site, page.page_key, 'default'),
      preview_url: this.previewUrlFor(site, page.page_key, 'default'),
      content: null,
      storage_path: null,
      metadata_path: null
    }));

    const fixedMatch = fixedPages.find((page) => pageLookupCandidates(page).some((candidate) => normalizeTitleMatch(candidate) === lookup));
    if (fixedMatch) {
      if (fixedMatch.page_key === 'index') {
        const { storagePath, html } = await this.readHomepageHtml(site);
        return {
          ...fixedMatch,
          storage_path: storagePath,
          enabled_libraries: normalizePageEnabledLibraries(extractManagedPageLibraries(html ?? '')),
          content: { html: stripManagedPageLibraryBlock(html ?? '') },
          exists: true
        };
      }

      return {
        ...fixedMatch,
        exists: true
      };
    }

    const customMatch = customPages.find((page) => pageLookupCandidates(page).some((candidate) => normalizeTitleMatch(candidate) === lookup));
    if (customMatch) {
      return {
        ...customMatch,
        exists: true,
        content: includeHtml ? { html: customMatch.html ?? '' } : null
      };
    }

    return null;
  }

  async readHomepageHtml(site) {
    const storagePath = homeContentStoragePath(site.id);
    const html = await this.storage.readText(storagePath);
    if (html !== null && html.trim() !== '') {
      return { storagePath, html };
    }

    const defaultTheme = await this.resolveThemeForSite(site.id, 'default').catch(() => null);
    if (defaultTheme?.id) {
      const legacyStoragePath = legacyHomepageContentStoragePath(site.id, defaultTheme.id);
      const legacyHtml = await this.storage.readText(legacyStoragePath);
      if (legacyHtml !== null && legacyHtml.trim() !== '') {
        return { storagePath: legacyStoragePath, html: legacyHtml };
      }
    }

    return { storagePath, html: html ?? '' };
  }

  async findPageTitleMatchesForSite(site, title) {
    const lookup = normalizeTitleMatch(title);
    const customPages = await this.listCustomPagesForSite(site, { includeHtml: false });
    const matches = [];

    for (const page of fixedTemplatePages()) {
      const candidates = fixedTemplatePageTitleCandidates(page);
      const matchedTitle = candidates.find((candidate) => normalizeTitleMatch(candidate) === lookup);

      if (matchedTitle) {
        matches.push({
          page_key: page.page_key,
          title: page.title,
          matched_title: matchedTitle,
          type: 'fixed',
          is_fixed: true,
          can_edit: isEditableFixedPageKey(page.page_key),
          can_delete: false,
          public_url: this.previewUrlFor(site, page.page_key, 'default')
        });
      }
    }

    for (const page of customPages) {
      const candidates = pageLookupCandidates(page);
      const matchedTitle = candidates.find((candidate) => normalizeTitleMatch(candidate) === lookup);

      if (matchedTitle) {
        matches.push({
          page_key: page.page_key,
          title: page.title,
          matched_title: matchedTitle,
          type: 'custom',
          is_fixed: false,
          can_edit: true,
          can_delete: true,
          public_url: page.public_url,
          preview_url: page.preview_url
        });
      }
    }

    return {
      lookup,
      matches
    };
  }

  async uploadAsset(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const theme = await this.resolveThemeForSite(site.id, args.theme_id);
    const storagePath = await this.resolveCommittedImageSource(accountId, site, args.source, 'source', args.target_usage ?? 'reference');

    return {
      ok: true,
      site,
      theme,
      target_usage: args.target_usage,
      asset_scope: args.asset_scope,
      target_id: args.target_id ?? null,
      alt_text: args.alt_text ?? '',
      mime_type: contentTypeForPath(storagePath),
      storage_path: storagePath,
      public_url: mediaUrlFor(this.publicSiteBaseUrl, storagePath),
      asset: {
        media_path: storagePath,
        public_url: mediaUrlFor(this.publicSiteBaseUrl, storagePath)
      }
    };
  }

  async resolveCommittedImageSource(accountId, site, source, fieldName, targetUsage = 'reference') {
    if (source === null) {
      return null;
    }

    const raw = typeof source === 'string'
      ? source
      : String(source?.media_path ?? source?.public_url ?? source?.url ?? source?.image_url ?? source?.file_url ?? '').trim();

    if (looksLikeUrl(raw)) {
      const path = tryCommittedMediaPathFromUrl(raw, site.id);
      if (path) {
        return normalizeCommittedMediaPath({ media_path: path }, site.id, fieldName);
      }

      const imported = await this.importExternalImageUrl(accountId, {
        site_id: site.id,
        image_url: raw,
        filename: typeof source === 'object' ? source.filename ?? source.original_name : undefined,
        mime_type: typeof source === 'object' ? source.mime_type : undefined,
        target_usage: targetUsage,
        source_label: fieldName
      });

      return normalizeCommittedMediaPath({ media_path: imported.asset.media_path }, site.id, fieldName);
    }

    return normalizeNullableCommittedMediaPath(source, site.id, fieldName);
  }

  requireWeblessMcpSecret() {
    if (!this.weblessMcpSecret) {
      throw codedError('UPSTREAM_NOT_CONFIGURED', 'WEBLESS_MCP_SECRET is required for signed Webless uploads.', {
        env: 'WEBLESS_MCP_SECRET'
      });
    }

    return this.weblessMcpSecret;
  }

  async getSiteForAccount(accountId, siteId) {
    if (accountId && typeof accountId === 'object') {
      const actor = await this.resolveAdminSiteForIdentity(accountId, { site_id: siteId });
      return actor.site;
    }

    const result = await this.pool.query(
      `
        select id, slug, name, domain, callback_code, site_status, theme_mode
        from sites
        where account_id = $1 and id = $2
        limit 1
      `,
      [accountId, siteId]
    );
    const site = result.rows[0];

    if (!site) {
      throw codedError('NOT_FOUND', `Site not found or not accessible: ${siteId}`);
    }

    return {
      id: site.id,
      slug: site.slug,
      name: site.name,
      domain: site.domain,
      callback_code: site.callback_code ?? null,
      icon_path: site.icon_path ?? null,
      site_status: normalizeSiteStatus(site.site_status),
      site_status_label: siteStatusLabel(site.site_status),
      theme_mode: normalizeSiteThemeMode(site.theme_mode)
    };
  }

  async findOrderForSite(siteId, args) {
    const orderId = args.order_id === undefined || args.order_id === null ? null : requireInteger(args.order_id, 'order_id');
    const orderNo = nullableString(args.order_no);
    if (!orderId && !orderNo) {
      throw codedError('VALIDATION_FAILED', 'order_id or order_no is required.');
    }

    const result = await this.pool.query(
      `
        select orders.*,
               ${orderDateDisplaySelectSql()}
        from orders
        where site_id = $1
          and ($2::bigint is null or id = $2::bigint)
          and ($3::text is null or order_no = $3::text)
        limit 1
      `,
      [siteId, orderId, orderNo]
    );
    const order = result.rows[0];
    if (!order) {
      throw codedError('NOT_FOUND', 'Order not found or not accessible.');
    }

    return order;
  }

  async listOrderItems(orderId) {
    const result = await this.pool.query(
      `
        select id, product_id, product_variant_id, product_name, product_sku, variant_name,
               quantity, unit_price_amount, original_unit_price_amount, line_subtotal_amount,
               line_discount_amount, line_total_amount, product_image_path, snapshot_image_path, spec_signature
        from order_items
        where order_id = $1
        order by id asc
      `,
      [orderId]
    );

    return result.rows.map((item) => ({
      id: item.id,
      product_id: item.product_id,
      product_variant_id: item.product_variant_id,
      product_name: item.product_name ?? '',
      product_sku: item.product_sku ?? '',
      variant_name: item.variant_name ?? '',
      quantity: Number.parseInt(item.quantity ?? '0', 10),
      unit_price_amount: Number.parseInt(item.unit_price_amount ?? '0', 10),
      original_unit_price_amount: item.original_unit_price_amount === null ? null : Number.parseInt(item.original_unit_price_amount ?? '0', 10),
      line_subtotal_amount: Number.parseInt(item.line_subtotal_amount ?? '0', 10),
      line_discount_amount: Number.parseInt(item.line_discount_amount ?? '0', 10),
      line_total_amount: Number.parseInt(item.line_total_amount ?? '0', 10),
      product_image_path: item.product_image_path ?? '',
      snapshot_image_path: item.snapshot_image_path ?? '',
      spec_signature: item.spec_signature ?? ''
    }));
  }

  async listThemesForSite(siteId) {
    const result = await this.pool.query(
      `
        select id, name, is_default, is_active, theme_mode
        from site_pages
        where site_id = $1
        order by is_default desc, sort_order asc, id asc
      `,
      [siteId]
    );

    return result.rows.map((theme) => formatTheme(theme));
  }

  async nextThemeSortOrder(siteId) {
    const result = await this.pool.query(
      `
        select coalesce(max(sort_order), 0) + 1 as next_sort_order
        from site_pages
        where site_id = $1
      `,
      [siteId]
    );

    return Number.parseInt(result.rows[0]?.next_sort_order ?? '1', 10);
  }

  async resolveThemeForSite(siteId, themeId) {
    const params = [siteId];
    let where = 'site_id = $1 and is_active = true';

    if (themeId !== undefined && themeId !== null && String(themeId).trim() !== '') {
      if (String(themeId).toLowerCase() === 'default') {
        where = 'site_id = $1 and is_default = true';
      } else {
        where = 'site_id = $1 and id = $2';
        params.push(requireInteger(themeId, 'theme_id'));
      }
    }

    const result = await this.pool.query(
      `
        select id, site_id, name, is_default, is_active, theme_mode
        from site_pages
        where ${where}
        order by is_default desc, id asc
        limit 1
      `,
      params
    );
    const theme = result.rows[0];

    if (!theme) {
      throw codedError('NOT_FOUND', 'Theme/page scheme not found for this site.');
    }

    return formatTheme(theme);
  }

  async copyDefaultTemplateToTheme(siteId, themeId) {
    const sourceDirectory = `sites/${siteId}/templates/default`;
    const targetDirectory = `sites/${siteId}/templates/schemes/${themeId}`;
    const files = await this.storage.listFiles(sourceDirectory);

    for (const sourcePath of files) {
      const relativePath = sourcePath.slice(sourceDirectory.length + 1);
      if (relativePath.startsWith('pages/')) {
        continue;
      }

      const bytes = await this.storage.readBytes(sourcePath);
      if (bytes !== null) {
        const targetPath = `${targetDirectory}/${relativePath}`;
        await this.storage.write(targetPath, bytes, contentTypeForPath(targetPath));
      }
    }
  }

  async listSiteNavItems(siteId) {
    const result = await this.pool.query(
      `
        select id, parent_id, name, item_type, url, icon_svg, icon_path, sort_order
        from site_nav_items
        where site_id = $1
        order by parent_id nulls first, sort_order asc, id asc
      `,
      [siteId]
    );

    return result.rows.map((item) => ({
      id: item.id,
      parent_id: item.parent_id,
      name: item.name,
      item_type: item.item_type,
      url: item.url,
      has_icon: Boolean(item.icon_svg || item.icon_path),
      icon_svg: item.icon_svg ? '[svg-present]' : null,
      icon_path: item.icon_path,
      sort_order: item.sort_order
    }));
  }

  async listSiteCategories(siteId) {
    const result = await this.pool.query(
      `
        select id, parent_id, name, icon_svg, icon_path, image_path, sort_order
        from site_categories
        where site_id = $1
        order by parent_id nulls first, sort_order asc, id asc
      `,
      [siteId]
    );

    return result.rows.map((category) => ({
      id: category.id,
      parent_id: category.parent_id,
      name: category.name,
      has_icon: Boolean(category.icon_svg || category.icon_path),
      icon_svg: category.icon_svg ? '[svg-present]' : null,
      icon_path: category.icon_path,
      image_path: category.image_path,
      sort_order: category.sort_order
    }));
  }

  async listProductImportCategories(siteId) {
    const result = await this.pool.query(
      `
        select id, parent_id, name, icon_svg, icon_path, image_path, sort_order
        from site_categories
        where site_id = $1
        order by parent_id nulls first, sort_order asc, id asc
      `,
      [siteId]
    );

    return result.rows.map((category) => ({
      id: category.id,
      parent_id: category.parent_id,
      name: category.name,
      has_icon: Boolean(category.icon_svg || category.icon_path),
      icon_svg: category.icon_svg ? '[svg-present]' : null,
      icon_path: category.icon_path ?? null,
      image_path: category.image_path ?? null,
      sort_order: category.sort_order,
      path: categoryPathLabel(category, result.rows)
    }));
  }

  async productCountsByCategory(siteId) {
    const result = await this.pool.query(
      `
        select site_category_id, count(*)::int as total
        from products
        where site_id = $1
        group by site_category_id
      `,
      [siteId]
    );

    return new Map(result.rows.map((row) => [row.site_category_id, Number.parseInt(row.total ?? '0', 10)]));
  }

  async findCategoryForSite(siteId, categoryId) {
    const result = await this.pool.query(
      `
        select id, site_id, parent_id, name, icon_svg, icon_path, image_path, sort_order, created_at, updated_at
        from site_categories
        where site_id = $1 and id = $2
        limit 1
      `,
      [siteId, categoryId]
    );

    if (!result.rows[0]) {
      throw codedError('NOT_FOUND', `Category not found or not accessible: ${categoryId}`);
    }

    return result.rows[0];
  }

  async findCategoryByNameForSite(siteId, name) {
    const result = await this.pool.query(
      `
        select id, site_id, parent_id, name, icon_svg, icon_path, image_path, sort_order, created_at, updated_at
        from site_categories
        where site_id = $1 and lower(name) = lower($2)
        order by id asc
        limit 1
      `,
      [siteId, name]
    );

    return result.rows[0] ?? null;
  }

  async assertCategoryIsLeaf(siteId, categoryId) {
    const result = await this.pool.query(
      `
        select id
        from site_categories
        where site_id = $1 and parent_id = $2
        limit 1
      `,
      [siteId, categoryId]
    );

    if (result.rows.length > 0) {
      throw codedError('VALIDATION_FAILED', 'Product category must be a leaf category. Ask the user to choose or create a child category.');
    }
  }

  async assertCategoryNameAvailable(siteId, parentId, name, ignoreCategoryId = null) {
    const result = await this.pool.query(
      `
        select id
        from site_categories
        where site_id = $1
          and lower(name) = lower($2)
          and ($3::bigint is null or id != $3::bigint)
        limit 1
      `,
      [siteId, name, ignoreCategoryId]
    );

    if (result.rows.length > 0) {
      throw codedError('VALIDATION_FAILED', `Category name already exists: ${name}. Choose the existing category instead of creating a duplicate.`);
    }
  }

  async assertCategoryParentIsNotDescendant(siteId, categoryId, parentId) {
    let currentParentId = parentId;

    while (currentParentId !== null) {
      if (currentParentId === categoryId) {
        throw codedError('VALIDATION_FAILED', 'A category cannot be moved under one of its descendants.');
      }

      const parent = await this.findCategoryForSite(siteId, currentParentId);
      currentParentId = parent.parent_id === null ? null : Number.parseInt(parent.parent_id, 10);
    }
  }

  async nextCategorySortOrder(siteId, parentId) {
    const result = await this.pool.query(
      `
        select coalesce(max(sort_order), -1) + 1 as next_sort_order
        from site_categories
        where site_id = $1
          and (($2::bigint is null and parent_id is null) or parent_id = $2::bigint)
      `,
      [siteId, parentId]
    );

    return Number.parseInt(result.rows[0]?.next_sort_order ?? '0', 10);
  }

  async findNavItemForSite(siteId, navItemId) {
    const result = await this.pool.query(
      `
        select id, site_id, parent_id, name, item_type, url, icon_svg, icon_path, sort_order, created_at, updated_at
        from site_nav_items
        where site_id = $1 and id = $2
        limit 1
      `,
      [siteId, navItemId]
    );

    if (!result.rows[0]) {
      throw codedError('NOT_FOUND', `Navigation item not found or not accessible: ${navItemId}`);
    }

    return result.rows[0];
  }

  async assertNavItemNameAvailable(siteId, parentId, name, ignoreNavItemId = null) {
    const result = await this.pool.query(
      `
        select id
        from site_nav_items
        where site_id = $1
          and name = $2
          and (($3::bigint is null and parent_id is null) or parent_id = $3::bigint)
          and ($4::bigint is null or id != $4::bigint)
        limit 1
      `,
      [siteId, name, parentId, ignoreNavItemId]
    );

    if (result.rows.length > 0) {
      throw codedError('VALIDATION_FAILED', 'A navigation item with this name already exists under the same parent.');
    }
  }

  async assertNavItemParentIsNotDescendant(siteId, navItemId, parentId) {
    let currentParentId = parentId;

    while (currentParentId !== null) {
      if (currentParentId === navItemId) {
        throw codedError('VALIDATION_FAILED', 'A navigation item cannot be moved under one of its descendants.');
      }

      const parent = await this.findNavItemForSite(siteId, currentParentId);
      currentParentId = parent.parent_id === null ? null : Number.parseInt(parent.parent_id, 10);
    }
  }

  async assertNavItemHasNoChildren(siteId, navItemId) {
    const result = await this.pool.query(
      `
        select id
        from site_nav_items
        where site_id = $1 and parent_id = $2
        limit 1
      `,
      [siteId, navItemId]
    );

    if (result.rows.length > 0) {
      throw codedError('VALIDATION_FAILED', 'Changing this dropdown to a link requires deleting or moving its child navigation items first.');
    }
  }

  async nextNavItemSortOrder(siteId, parentId) {
    const result = await this.pool.query(
      `
        select coalesce(max(sort_order), -1) + 1 as next_sort_order
        from site_nav_items
        where site_id = $1
          and (($2::bigint is null and parent_id is null) or parent_id = $2::bigint)
      `,
      [siteId, parentId]
    );

    return Number.parseInt(result.rows[0]?.next_sort_order ?? '0', 10);
  }

  async assertProductSkuAvailable(siteId, sku, ignoreProductId = null) {
    const result = await this.pool.query(
      `
        select id
        from products
        where site_id = $1
          and sku = $2
          and ($3::bigint is null or id != $3::bigint)
        limit 1
      `,
      [siteId, sku, ignoreProductId]
    );

    if (result.rows.length > 0) {
      throw codedError('VALIDATION_FAILED', 'This SKU has already been used.');
    }
  }

  async findProductForSite(siteId, productId) {
    const result = await this.pool.query(
      `
        select *
        from products
        where site_id = $1 and id = $2
        limit 1
      `,
      [siteId, productId]
    );

    if (!result.rows[0]) {
      throw codedError('NOT_FOUND', `Product not found or not accessible: ${productId}`);
    }

    return result.rows[0];
  }

  async countProductImages(productId, type) {
    const result = await this.pool.query(
      `
        select count(*)::int as total
        from product_images
        where product_id = $1 and image_type = $2
      `,
      [productId, type]
    );

    return Number.parseInt(result.rows[0]?.total ?? '0', 10);
  }

  async uniqueProductSlug(siteId, name, ignoreProductId = null) {
    const base = slugify(name) || 'product';
    let slug = base;
    let suffix = 2;

    while (await this.productSlugExists(siteId, slug, ignoreProductId)) {
      slug = `${base}-${suffix}`;
      suffix += 1;
    }

    return slug;
  }

  async productSlugExists(siteId, slug, ignoreProductId = null) {
    const result = await this.pool.query(
      `
        select id
        from products
        where site_id = $1
          and slug = $2
          and ($3::bigint is null or id != $3::bigint)
        limit 1
      `,
      [siteId, slug, ignoreProductId]
    );

    return result.rows.length > 0;
  }

  async syncProductChildRecords(site, product, payload) {
    await this.syncProductImages(site, product, 'primary', payload.primary_images, payload.primary_images_mode);
    await this.syncProductImages(site, product, 'content', payload.content_images, payload.content_images_mode);
    await this.syncProductVideos(product.id, payload.videos);
    await this.syncProductVariants(product.id, payload.variant_mode, payload);
    await this.syncProductQuantityDiscounts(product.id, payload.variant_mode, payload.quantity_discounts);
  }

  async syncProductImages(site, product, type, images, mode = 'replace') {
    if (!Array.isArray(images) || images.length === 0) {
      return;
    }

    let sortOrderOffset = 0;
    const existingPaths = new Set();

    if (mode === 'replace') {
      await this.pool.query('delete from product_images where product_id = $1 and image_type = $2', [product.id, type]);
    } else {
      const existingResult = await this.pool.query(
        'select path from product_images where product_id = $1 and image_type = $2',
        [product.id, type]
      );
      for (const row of existingResult.rows) {
        existingPaths.add(String(row.path ?? ''));
      }

      const result = await this.pool.query(
        `
          select coalesce(max(sort_order), -1) + 1 as next_sort_order
          from product_images
          where product_id = $1 and image_type = $2
        `,
        [product.id, type]
      );
      sortOrderOffset = Number.parseInt(result.rows[0]?.next_sort_order ?? '0', 10);
    }

    let insertedCount = 0;
    for (let index = 0; index < images.length; index += 1) {
      const pathOrUrl = await this.resolveProductImagePath(site, product, type, images[index], index);
      if (mode === 'append' && existingPaths.has(pathOrUrl)) {
        continue;
      }
      await this.pool.query(
        `
          insert into product_images (product_id, image_type, path, sort_order, alt_text, created_at, updated_at)
          values ($1, $2, $3, $4, $5, now(), now())
        `,
        [product.id, type, pathOrUrl, sortOrderOffset + insertedCount, product.name]
      );
      existingPaths.add(pathOrUrl);
      insertedCount += 1;
    }
  }

  async resolveProductImagePath(site, product, type, image, index) {
    if (typeof image === 'string') {
      throw codedError('VALIDATION_FAILED', 'Product images must use source.media_path returned by slimweb_uploads_commit. Do not pass base64, URLs, local paths, or attachment references.');
    }

    const source = image?.source && typeof image.source === 'object' ? image.source : image;
    return normalizeCommittedMediaPath(source, site.id, `product ${type} image ${index + 1}`);
  }

  async syncProductVideos(productId, videos) {
    if (!Array.isArray(videos)) {
      return;
    }

    await this.pool.query('delete from product_videos where product_id = $1', [productId]);

    for (let index = 0; index < videos.length; index += 1) {
      const url = normalizeYoutubeUrl(videos[index]);
      await this.pool.query(
        `
          insert into product_videos (product_id, url, sort_order, created_at, updated_at)
          values ($1, $2, $3, now(), now())
        `,
        [productId, url, index]
      );
    }
  }

  async syncProductVariants(productId, variantMode, payload) {
    if (variantMode !== 'different_price') {
      return;
    }

    await this.pool.query('delete from product_variants where product_id = $1', [productId]);
    const rows = normalizeDifferentPriceVariants(payload.variants);

    for (let index = 0; index < rows.length; index += 1) {
      await this.pool.query(
        `
          insert into product_variants (product_id, sku, name, price, sale_price, stock, sort_order, is_default, created_at, updated_at)
          values ($1, null, $2, $3, $4, $5, $6, $7, now(), now())
        `,
        [productId, rows[index].name, rows[index].price, rows[index].sale_price, rows[index].stock, index, index === 0]
      );
    }
  }

  async syncProductQuantityDiscounts(productId, variantMode, quantityDiscounts) {
    if (variantMode !== 'different_price' || !Array.isArray(quantityDiscounts)) {
      return;
    }

    await this.pool.query('delete from product_quantity_discounts where product_id = $1', [productId]);
    const rows = normalizeQuantityDiscounts(quantityDiscounts);

    for (let index = 0; index < rows.length; index += 1) {
      await this.pool.query(
        `
          insert into product_quantity_discounts (product_id, quantity, discount_percent, sort_order, created_at, updated_at)
          values ($1, $2, $3, $4, now(), now())
        `,
        [productId, rows[index].quantity, rows[index].discount_percent, index]
      );
    }
  }

  async formatProductWithRelations(product) {
    const [images, videos, variants, quantityDiscounts] = await Promise.all([
      this.pool.query('select id, product_id, image_type, path, sort_order, alt_text from product_images where product_id = $1 order by sort_order asc, id asc', [product.id]),
      this.pool.query('select id, product_id, url, sort_order from product_videos where product_id = $1 order by sort_order asc, id asc', [product.id]),
      this.pool.query('select id, product_id, name, price, sale_price, stock, sort_order, is_default from product_variants where product_id = $1 order by sort_order asc, id asc', [product.id]),
      this.pool.query('select id, product_id, quantity, discount_percent, sort_order from product_quantity_discounts where product_id = $1 order by sort_order asc, id asc', [product.id])
    ]);

    return formatProduct(product, images.rows, videos.rows, variants.rows, quantityDiscounts.rows, this.publicSiteBaseUrl);
  }

  async ensureProductImportCategory(siteId) {
    const existing = await this.pool.query(
      `
        select id, name
        from site_categories
        where site_id = $1 and parent_id is null and name = '轉入商品'
        limit 1
      `,
      [siteId]
    );

    if (existing.rows[0]) {
      return { id: existing.rows[0].id, name: existing.rows[0].name };
    }

    const sortOrder = await this.pool.query(
      `
        select coalesce(max(sort_order), -1) + 1 as next_sort_order
        from site_categories
        where site_id = $1 and parent_id is null
      `,
      [siteId]
    );
    const result = await this.pool.query(
      `
        insert into site_categories (site_id, parent_id, name, sort_order, created_at, updated_at)
        values ($1, null, '轉入商品', $2, now(), now())
        returning id, name
      `,
      [siteId, Number.parseInt(sortOrder.rows[0]?.next_sort_order ?? '0', 10)]
    );

    return { id: result.rows[0].id, name: result.rows[0].name };
  }

  async listLeafCategoryAssignments(siteId) {
    const result = await this.pool.query(
      `
        select c.id, c.name
        from site_categories c
        where c.site_id = $1
          and not exists (
            select 1 from site_categories child
            where child.parent_id = c.id
          )
        order by length(c.name) desc, c.id asc
      `,
      [siteId]
    );

    return result.rows
      .map((category) => ({
        id: category.id,
        name: String(category.name ?? '').trim()
      }))
      .filter((category) => category.name !== '');
  }

  async listExistingProductValues(siteId, column) {
    if (!['sku', 'slug'].includes(column)) {
      throw codedError('VALIDATION_FAILED', 'Unsupported product uniqueness column.');
    }

    const result = await this.pool.query(
      `
        select ${column}
        from products
        where site_id = $1
      `,
      [siteId]
    );

    return new Set(result.rows.map((row) => String(row[column] ?? '')).filter((value) => value !== ''));
  }

  async insertProductImportChunk(chunk, mapping) {
    const columns = [
      'site_id',
      'site_category_id',
      'sku',
      'name',
      'slug',
      'summary',
      'description',
      'base_price',
      'sale_price',
      'cost_price',
      'stock',
      'status',
      'youtube_url',
      'created_at',
      'updated_at'
    ];
    const bindings = [];
    const valueSql = chunk.map((row, rowIndex) => {
      const startIndex = rowIndex * columns.length;
      for (const column of columns) {
        bindings.push(column === 'created_at' || column === 'updated_at' ? new Date() : row[column]);
      }

      return `(${columns.map((_, columnIndex) => `$${startIndex + columnIndex + 1}`).join(', ')})`;
    });
    const inserted = await this.pool.query(
      `
        insert into products (${columns.join(', ')})
        values ${valueSql.join(', ')}
        returning id, name
      `,
      bindings
    );
    const imageRows = [];

    for (let index = 0; index < inserted.rows.length; index += 1) {
      imageRows.push(...buildProductImageRows(inserted.rows[index].id, inserted.rows[index].name, chunk[index]._source_row, mapping));
    }

    if (imageRows.length > 0) {
      await this.insertProductImageRows(imageRows);
    }

    return inserted.rows.length;
  }

  async insertProductImageRows(imageRows) {
    const columns = ['product_id', 'image_type', 'path', 'sort_order', 'alt_text', 'created_at', 'updated_at'];
    const bindings = [];
    const valueSql = imageRows.map((row, rowIndex) => {
      const startIndex = rowIndex * columns.length;
      for (const column of columns) {
        bindings.push(column === 'created_at' || column === 'updated_at' ? new Date() : row[column]);
      }

      return `(${columns.map((_, columnIndex) => `$${startIndex + columnIndex + 1}`).join(', ')})`;
    });

    await this.pool.query(
      `
        insert into product_images (${columns.join(', ')})
        values ${valueSql.join(', ')}
      `,
      bindings
    );
  }

  async getSiteDesignDetails(siteId) {
    const result = await this.pool.query(
      `
        select
          contact_email,
          contact_line,
          contact_wechat,
          contact_telegram,
          contact_twitter,
          contact_instagram,
          contact_facebook_page,
          contact_store_address,
          contact_phone,
          contact_mobile,
          contact_tax_id,
          contact_copyright,
          use_ai_customer_service
        from sites
        where id = $1
        limit 1
      `,
      [siteId]
    );

    return result.rows[0] ?? {};
  }

  async getThemeManagedRootCss(theme) {
    return await this.storage.readText(`${themeDirectory(theme)}/assets/root-elements/css/00-mcp-theme.css`) ?? '';
  }

  async findSeoSettingsForSite(siteId) {
    const result = await this.pool.query(
      `
        select ${SEO_SETTINGS_COLUMNS.join(', ')}
        from sites
        where id = $1
        limit 1
      `,
      [siteId]
    );

    return formatSeoSettings(result.rows[0] ?? {});
  }

  async findIntegrationSettingsForSite(siteId) {
    const result = await this.pool.query(
      `
        select ${INTEGRATION_SETTINGS_COLUMNS.join(', ')}
        from sites
        where id = $1
        limit 1
      `,
      [siteId]
    );

    return formatIntegrationSettings(result.rows[0] ?? {});
  }

  async listMailTemplatesForSite(siteId) {
    const existing = await this.pool.query(
      `
        select id, site_id, trigger_event, subject, content, is_active, created_at, updated_at
        from mail_templates
        where site_id = $1
        order by array_position($2::text[], trigger_event), id
      `,
      [siteId, MAIL_TEMPLATE_EVENTS]
    );
    const byEvent = new Map(existing.rows.map((row) => [row.trigger_event, row]));

    return MAIL_TEMPLATE_EVENTS.map((event) => formatMailTemplate(byEvent.get(event) ?? {
      id: null,
      site_id: siteId,
      trigger_event: event,
      ...defaultMailTemplate(event),
      is_active: true,
      created_at: null,
      updated_at: null
    }));
  }

  async findMailLayoutForSite(siteId) {
    const result = await this.pool.query(
      `
        select id, site_id, html, is_active, created_at, updated_at
        from site_mail_layouts
        where site_id = $1
        limit 1
      `,
      [siteId]
    );

    return result.rows[0]
      ? formatMailLayout(result.rows[0])
      : {
          id: null,
          site_id: siteId,
          html: null,
          is_active: false,
          uses_default_layout: true,
          created_at: null,
          updated_at: null
        };
  }

  async findBasicSettingsForSite(siteId) {
    const result = await this.pool.query(
      `
        select ${BASIC_SETTINGS_COLUMNS.join(', ')}
        from sites
        where id = $1
        limit 1
      `,
      [siteId]
    );

    return formatBasicSettings(result.rows[0] ?? {});
  }

  async findMailDeliverySettingsForSite(siteId) {
    const result = await this.pool.query(
      `
        select ${MAIL_DELIVERY_SETTINGS_COLUMNS.join(', ')}
        from sites
        where id = $1
        limit 1
      `,
      [siteId]
    );

    return formatMailDeliverySettings(result.rows[0] ?? {});
  }

  async getReadinessCountsForSite(siteId) {
    const result = await this.pool.query(
      `
        select
          (select count(*) from site_categories where site_id = $1) as category_count,
          (select count(*) from products where site_id = $1) as product_count,
          (select count(*) from products where site_id = $1 and status = 'active') as active_product_count,
          (select count(*) from products where site_id = $1 and site_category_id is null) as uncategorized_product_count,
          (select count(*) from site_nav_items where site_id = $1) as nav_item_count,
          (select count(*) from articles where site_id = $1) as article_count,
          (select count(*) from site_admins where site_id = $1) as admin_count,
          (select count(*) from site_admins where site_id = $1 and permissions::text like '%backend_ai_assistant%') as backend_ai_admin_count,
          (select count(*) from coupon_templates where site_id = $1) as coupon_template_count,
          (select count(*) from discount_codes where site_id = $1) as discount_code_count
      `,
      [siteId]
    );

    return normalizeReadinessCounts(result.rows[0] ?? {});
  }

  async listPaymentProvidersForSite(siteId) {
    const result = await this.pool.query(
      `
        select id, site_id, provider, mode, is_enabled, settings, sort_order, created_at, updated_at
        from site_payment_providers
        where site_id = $1
        order by sort_order asc, id asc
      `,
      [siteId]
    );
    const rowsByProvider = new Map(result.rows.map((row) => [row.provider, row]));

    return PAYMENT_PROVIDER_DEFINITIONS.map((definition) => formatPaymentProvider(
      rowsByProvider.get(definition.provider) ?? defaultProviderRow(siteId, definition),
      definition,
      this.laravelAppKey
    ));
  }

  async listLogisticsProvidersForSite(siteId) {
    const result = await this.pool.query(
      `
        select id, site_id, provider, mode, is_enabled, settings, sort_order, created_at, updated_at
        from site_logistics_providers
        where site_id = $1
        order by sort_order asc, id asc
      `,
      [siteId]
    );
    const rowsByProvider = new Map(result.rows.map((row) => [row.provider, row]));

    return LOGISTICS_PROVIDER_DEFINITIONS.map((definition) => formatLogisticsProvider(
      rowsByProvider.get(definition.provider) ?? defaultProviderRow(siteId, definition),
      definition,
      this.laravelAppKey
    ));
  }

  async upsertPaymentProvider(siteId, update) {
    const definition = paymentProviderDefinition(update.provider);
    const existing = await this.findProviderRow('site_payment_providers', siteId, update.provider);
    const currentSettings = readProviderSettings(existing?.settings, this.laravelAppKey);
    const settings = normalizePaymentProviderSettings(update, currentSettings, definition);

    validateProviderCredentials(update.is_enabled, settings, definition.requires_hash_iv);
    const encryptedSettings = writeProviderSettings(settings, this.laravelAppKey);

    return this.pool.query(
      `
        insert into site_payment_providers (site_id, provider, mode, is_enabled, settings, sort_order, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, now(), now())
        on conflict (site_id, provider)
        do update set
          mode = excluded.mode,
          is_enabled = excluded.is_enabled,
          settings = excluded.settings,
          sort_order = excluded.sort_order,
          updated_at = now()
        returning id, site_id, provider, mode, is_enabled, settings, sort_order, created_at, updated_at
      `,
      [siteId, update.provider, update.mode, update.is_enabled, encryptedSettings, definition.sort_order]
    );
  }

  async upsertLogisticsProvider(siteId, update) {
    const definition = logisticsProviderDefinition(update.provider);
    const existing = await this.findProviderRow('site_logistics_providers', siteId, update.provider);
    const currentSettings = readProviderSettings(existing?.settings, this.laravelAppKey);
    const paymentProvider = ['ecpay', 'newebpay'].includes(update.provider)
      ? await this.findProviderRow('site_payment_providers', siteId, update.provider)
      : null;
    const paymentSettings = readProviderSettings(paymentProvider?.settings, this.laravelAppKey);
    const settings = normalizeLogisticsProviderSettings(update, currentSettings, definition, paymentSettings);
    const effectiveEnabled = definition.follows_payment_provider
      ? Boolean(paymentProvider?.is_enabled)
      : update.is_enabled;

    validateLogisticsProviderSettings(effectiveEnabled, settings, definition);
    const encryptedSettings = writeProviderSettings(settings, this.laravelAppKey);

    return this.pool.query(
      `
        insert into site_logistics_providers (site_id, provider, mode, is_enabled, settings, sort_order, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, now(), now())
        on conflict (site_id, provider)
        do update set
          mode = excluded.mode,
          is_enabled = excluded.is_enabled,
          settings = excluded.settings,
          sort_order = excluded.sort_order,
          updated_at = now()
        returning id, site_id, provider, mode, is_enabled, settings, sort_order, created_at, updated_at
      `,
      [siteId, update.provider, definition.provider === 'hct' ? update.mode : (paymentProvider?.mode ?? 'test'), effectiveEnabled, encryptedSettings, definition.sort_order]
    );
  }

  async findProviderRow(tableName, siteId, provider) {
    const result = await this.pool.query(
      `
        select id, site_id, provider, mode, is_enabled, settings, sort_order, created_at, updated_at
        from ${tableName}
        where site_id = $1 and provider = $2
        limit 1
      `,
      [siteId, provider]
    );

    return result.rows[0] ?? null;
  }

  async listAdminsForSite(siteId) {
    const result = await this.pool.query(
      `
        select id, site_id, username, google_email, google_sub, avatar_path, permissions, created_at, updated_at
        from site_admins
        where site_id = $1
        order by id asc
      `,
      [siteId]
    );
    const firstAdminId = result.rows[0]?.id ?? null;

    return result.rows.map((admin) => formatAdmin(admin, {
      first_admin_id: firstAdminId,
      publicSiteBaseUrl: this.publicSiteBaseUrl
    }));
  }

  async firstAdminForSite(siteId) {
    const result = await this.pool.query(
      `
        select id, site_id, username, google_email, google_sub, avatar_path, permissions, created_at, updated_at
        from site_admins
        where site_id = $1
        order by id asc
        limit 1
      `,
      [siteId]
    );

    return result.rows[0] ?? null;
  }

  async findAdminForSite(siteId, adminId) {
    const result = await this.pool.query(
      `
        select id, site_id, username, google_email, google_sub, avatar_path, permissions, created_at, updated_at
        from site_admins
        where site_id = $1 and id = $2
        limit 1
      `,
      [siteId, adminId]
    );

    if (!result.rows[0]) {
      throw codedError('NOT_FOUND', `Admin not found or not accessible: ${adminId}`);
    }

    return result.rows[0];
  }

  async assertAdminGoogleEmailAvailable(siteId, googleEmail, ignoreAdminId = null) {
    const result = await this.pool.query(
      `
        select id
        from site_admins
        where site_id = $1
          and google_email = $2
          and ($3::bigint is null or id != $3::bigint)
        limit 1
      `,
      [siteId, googleEmail, ignoreAdminId]
    );

    if (result.rows.length > 0) {
      throw codedError('VALIDATION_FAILED', 'This admin Google email has already been used.');
    }
  }

  async findExternalAssetForSite(siteId, assetId) {
    const result = await this.pool.query(
      `
        select id, site_id, site_page_id, page_key, scope, asset_type, url, placement, load_mode,
               sort_order, is_enabled, purpose, attributes, created_at, updated_at
        from site_external_assets
        where site_id = $1 and id = $2
        limit 1
      `,
      [siteId, assetId]
    );

    if (!result.rows[0]) {
      throw codedError('NOT_FOUND', `External asset not found or not accessible: ${assetId}`);
    }

    return result.rows[0];
  }

  async normalizeExternalAssetPayload(siteId, args, existing = null) {
    const scope = normalizeExternalAssetScope(args.scope ?? existing?.scope);
    const assetType = normalizeExternalAssetType(args.asset_type ?? existing?.asset_type);
    const sitePageId = scope === 'site' ? null : normalizeNullableInteger(args.site_page_id ?? existing?.site_page_id, 'site_page_id');
    const pageKey = scope === 'page' ? (nullableString(args.page_key ?? existing?.page_key) ?? 'index') : null;

    if (scope === 'theme' && !sitePageId) {
      throw codedError('VALIDATION_FAILED', 'site_page_id is required for theme scoped assets.');
    }

    if (sitePageId) {
      await this.resolveThemeForSite(siteId, sitePageId);
    }

    return {
      site_page_id: sitePageId,
      page_key: pageKey,
      scope,
      asset_type: assetType,
      url: requireUrl(args.url ?? existing?.url, 'url'),
      placement: normalizeExternalAssetPlacement(args.placement ?? existing?.placement),
      load_mode: assetType === 'css' ? 'normal' : normalizeExternalAssetLoadMode(args.load_mode ?? existing?.load_mode),
      sort_order: normalizeNonNegativeInteger(args.sort_order ?? existing?.sort_order ?? 0, 'sort_order'),
      is_enabled: normalizeBoolean(args.is_enabled ?? existing?.is_enabled ?? true),
      purpose: nullableString(args.purpose ?? existing?.purpose),
      attributes: normalizeJsonObject(args.attributes ?? existing?.attributes ?? {})
    };
  }

  async findArticleForSite(siteId, articleId) {
    const result = await this.pool.query(
      `
        select id, site_id, notion_page_id, title, content, cover_path, created_at, updated_at
        from articles
        where site_id = $1 and id = $2
        limit 1
      `,
      [siteId, articleId]
    );

    if (!result.rows[0]) {
      throw codedError('NOT_FOUND', `Article not found or not accessible: ${articleId}`);
    }

    return result.rows[0];
  }

  async findArticleTitleMatchesForSite(site, title) {
    const result = await this.pool.query(
      `
        select id, site_id, notion_page_id, title, content, cover_path, created_at, updated_at
        from articles
        where site_id = $1 and lower(trim(title)) = $2
        order by created_at desc, id desc
      `,
      [site.id, normalizeTitleMatch(title)]
    );

    return {
      matches: result.rows.map((article) => formatArticle(article, site, this.publicSiteBaseUrl, false))
    };
  }

  async findCouponTemplateForSite(siteId, couponTemplateId) {
    const result = await this.pool.query(
      `
        select id, site_id, name, discount_amount, minimum_spend, issue_trigger, trigger_amount, starts_at, ends_at, created_at, updated_at
        from coupon_templates
        where site_id = $1 and id = $2
        limit 1
      `,
      [siteId, couponTemplateId]
    );

    if (!result.rows[0]) {
      throw codedError('NOT_FOUND', `Coupon template not found or not accessible: ${couponTemplateId}`);
    }

    return result.rows[0];
  }

	  async findMemberForSite(siteId, memberId) {
	    const result = await this.pool.query(
	      `
	        select id, site_id, email, name, birthday, gender, mobile, status, country, zip, address,
	               total_spent_amount, last_login_at, created_at, updated_at
	        from members
	        where site_id = $1 and id = $2
	        limit 1
	      `,
      [siteId, memberId]
    );

    if (!result.rows[0]) {
      throw codedError('NOT_FOUND', `Member not found or not accessible: ${memberId}`);
    }
	
	    return result.rows[0];
	  }

  async findMembersForEmail(siteId, memberIds) {
    const result = await this.pool.query(
      `
        select id, site_id, email, name, birthday, gender, mobile, status, country, zip, address,
               total_spent_amount, last_login_at, created_at, updated_at
        from members
        where site_id = $1 and id = any($2::bigint[])
        order by id asc
      `,
      [siteId, memberIds]
    );
    const foundIds = new Set(result.rows.map((member) => Number.parseInt(member.id, 10)));
    const missing = memberIds.filter((id) => !foundIds.has(id));

    if (missing.length > 0) {
      throw codedError('NOT_FOUND', `Member not found or not accessible: ${missing.join(', ')}`);
    }

    return result.rows;
  }

  async findProductsForEmail(site, productIds) {
    const result = await this.pool.query(
      `
        select p.id, p.site_id, p.site_category_id, p.sku, p.name, p.summary, p.base_price, p.sale_price,
               p.stock, p.status, p.sales_volume, p.created_at, p.updated_at,
               (select path from product_images where product_id = p.id and image_type = 'primary' order by sort_order asc, id asc limit 1) as primary_image_path
        from products p
        where p.site_id = $1 and p.id = any($2::bigint[])
        order by array_position($2::bigint[], p.id)
      `,
      [site.id, productIds]
    );
    const foundIds = new Set(result.rows.map((product) => Number.parseInt(product.id, 10)));
    const missing = productIds.filter((id) => !foundIds.has(id));

    if (missing.length > 0) {
      throw codedError('NOT_FOUND', `Product not found or not accessible: ${missing.join(', ')}`);
    }

    return result.rows.map((product) => formatEmailProduct(product, this.publicSiteBaseUrl, site.slug));
  }

  async findSiteContactEmail(siteId) {
    const result = await this.pool.query(
      'select contact_email from sites where id = $1 limit 1',
      [siteId]
    );

    return normalizeEmailAddress(result.rows[0]?.contact_email) ?? null;
  }

  signMemberEmailDraft(payload) {
    const body = base64UrlEncode(JSON.stringify(payload));
    const signature = createHmac('sha256', this.requireWeblessMcpSecret()).update(body).digest('base64url');

    return `${body}.${signature}`;
  }

  verifyMemberEmailDraft(token) {
    const [body, signature] = token.split('.', 2);
    if (!body || !signature) {
      throw codedError('VALIDATION_FAILED', 'email_draft_token is invalid.');
    }

    const expected = createHmac('sha256', this.requireWeblessMcpSecret()).update(body).digest('base64url');
    if (!timingSafeStringEqual(signature, expected)) {
      throw codedError('VALIDATION_FAILED', 'email_draft_token signature is invalid.');
    }

    let payload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      throw codedError('VALIDATION_FAILED', 'email_draft_token payload is invalid.');
    }

    if (!payload || typeof payload !== 'object') {
      throw codedError('VALIDATION_FAILED', 'email_draft_token payload is invalid.');
    }
    if (Number.parseInt(payload.expires_at ?? '0', 10) < Math.floor(Date.now() / 1000)) {
      throw codedError('VALIDATION_FAILED', 'email_draft_token has expired. Preview the email again.');
    }

    return payload;
  }

	  async findThresholdGiftForSite(siteId, thresholdGiftId) {
	    const result = await this.pool.query(
	      `
	        select id, site_id, threshold_amount, product_id, sort_order, is_active, created_at, updated_at
	        from threshold_gifts
	        where site_id = $1 and id = $2
	        limit 1
	      `,
	      [siteId, thresholdGiftId]
	    );

	    if (!result.rows[0]) {
	      throw codedError('NOT_FOUND', `Threshold gift not found or not accessible: ${thresholdGiftId}`);
	    }

	    return result.rows[0];
	  }

	  async findProductAddOnForSite(siteId, productAddOnId) {
	    const result = await this.pool.query(
	      `
	        select id, site_id, product_id, add_on_product_id, add_on_price, max_quantity,
	               sort_order, is_active, created_at, updated_at
	        from product_add_ons
	        where site_id = $1 and id = $2
	        limit 1
	      `,
	      [siteId, productAddOnId]
	    );

	    if (!result.rows[0]) {
	      throw codedError('NOT_FOUND', `Product add-on not found or not accessible: ${productAddOnId}`);
	    }

	    return result.rows[0];
	  }

	  async exportRows(siteId, exportType, limit) {
	    if (exportType === 'members') {
	      const result = await this.pool.query(
	        `
	          select id, email, name, mobile, status, total_spent_amount, last_login_at, created_at, updated_at
	          from members
	          where site_id = $1
	          order by id asc
	          limit $2
	        `,
	        [siteId, limit]
	      );
	      return result.rows.map((member) => formatMemberDetail(member));
	    }

	    const returnFilter = exportType === 'returns' ? 'and return_requested_at is not null' : '';
	    const result = await this.pool.query(
	      `
	        select id, order_no, status, buyer_name, buyer_email, grand_total_amount,
	               payment_method, payment_provider, return_status, refund_status,
	               placed_at, created_at, updated_at
	        from orders
	        where site_id = $1 ${returnFilter}
	        order by placed_at desc nulls last, created_at desc
	        limit $2
	      `,
	      [siteId, limit]
	    );

	    return result.rows.map((order) => ({
	      id: order.id,
	      order_no: order.order_no,
	      status: order.status,
	      buyer_name: order.buyer_name ?? '',
	      buyer_email: order.buyer_email ?? '',
	      grand_total_amount: Number.parseInt(order.grand_total_amount ?? '0', 10),
	      payment_method: order.payment_method ?? '',
	      payment_provider: order.payment_provider ?? '',
	      return_status: order.return_status ?? '',
	      refund_status: order.refund_status ?? '',
	      placed_at: dateString(order.placed_at),
	      created_at: dateString(order.created_at),
	      updated_at: dateString(order.updated_at)
	    }));
	  }

	  async firstExistingTable(tableNames) {
	    const result = await this.pool.query(
	      `
	        select table_name
	        from information_schema.tables
	        where table_schema = current_schema()
	          and table_name = any($1::text[])
	        order by array_position($1::text[], table_name)
	        limit 1
	      `,
	      [tableNames]
	    );

	    return result.rows[0]?.table_name ?? null;
	  }

  async storeArticleContentImages(site, articleId, images) {
    const uploaded = [];

    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      const storagePath = normalizeCommittedMediaPath(image.source, site.id, `content_images[${index}].source`);
      uploaded.push({
        storage_path: storagePath,
        url: mediaUrlFor(this.publicSiteBaseUrl, storagePath),
        alt_text: image.alt_text ?? '',
        mime_type: contentTypeForPath(storagePath)
      });
    }

    return uploaded;
  }

  async findThemeStyleProfile(themeId) {
    const result = await this.pool.query(
      `
        select *
        from site_theme_style_profiles
        where site_page_id = $1
        limit 1
      `,
      [themeId]
    );

    return result.rows[0] ? formatStyleProfile(result.rows[0]) : null;
  }

  previewUrlFor(site, pageKey, themeId) {
    const url = new URL(`${this.publicSiteBaseUrl}/sites/${encodeURIComponent(site.slug)}/default-preview`);

    url.searchParams.set('mcp_site_id', String(site.id));
    url.searchParams.set('mcp_page_key', pageKey);
    url.searchParams.set('preview_page', pageKey);
    if (pageKey !== 'index') {
      url.searchParams.set('mcp_theme_id', String(themeId));
      url.searchParams.set('preview_style_scheme', String(themeId));
    }

    return url.toString();
  }

  customPagePublicUrlFor(site, pageKey) {
    return `${this.publicSiteBaseUrl}/sites/${encodeURIComponent(site.slug)}/default-preview/pages/${encodeURIComponent(pageKey)}`;
  }

}

export function createStorageAdapter(options = {}) {
  const driver = storageDriverFromOptions(options);

  if (driver === 'gcs') {
    return new GcsStorageAdapter({
      bucket: options.gcsBucket ?? process.env.GCS_BUCKET,
      fetchImpl: options.fetchImpl,
      credentialsPath: options.googleApplicationCredentials ?? process.env.GOOGLE_APPLICATION_CREDENTIALS
    });
  }

  return new LocalStorageAdapter({
    root: options.storageRoot ?? process.env.WEBLESS_STORAGE_ROOT ?? ''
  });
}

function storageDriverFromOptions(options = {}) {
  const explicitDriver = options.storageDriver ?? process.env.WEBLESS_STORAGE_DRIVER;
  if (explicitDriver) {
    return String(explicitDriver).toLowerCase();
  }

  const filesystemDisk = String(process.env.FILESYSTEM_DISK ?? '').toLowerCase();
  if (filesystemDisk === 'local') {
    return 'local';
  }

  return options.gcsBucket || process.env.GCS_BUCKET ? 'gcs' : 'local';
}

export class LocalStorageAdapter {
  constructor({ root }) {
    this.root = root;
  }

  async readText(storagePath) {
    const absolutePath = this.absoluteStoragePath(storagePath);

    return readFile(absolutePath, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') {
        return null;
      }

      throw error;
    });
  }

  async readBytes(storagePath) {
    const absolutePath = this.absoluteStoragePath(storagePath);

    return readFile(absolutePath).catch((error) => {
      if (error.code === 'ENOENT') {
        return null;
      }

      throw error;
    });
  }

  async write(storagePath, bytes) {
    const absolutePath = this.absoluteStoragePath(storagePath);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);
  }

  async delete(storagePath) {
    const absolutePath = this.absoluteStoragePath(storagePath);

    await rm(absolutePath, { force: true });
  }

  async deleteDirectory(storagePath) {
    const absolutePath = this.absoluteStoragePath(storagePath);

    await rm(absolutePath, { recursive: true, force: true });
  }

  async listFiles(prefix) {
    const absolutePrefix = this.absoluteStoragePath(prefix);

    return listLocalFiles(absolutePrefix)
      .then((files) => files.map((file) => path.relative(path.resolve(this.root), file).split(path.sep).join('/')))
      .catch((error) => {
        if (error.code === 'ENOENT') {
          return [];
        }

        throw error;
      });
  }

  absoluteStoragePath(storagePath) {
    if (!this.root) {
      throw codedError('UPSTREAM_NOT_CONFIGURED', 'WEBLESS_STORAGE_ROOT is required when WEBLESS_STORAGE_DRIVER=local.', {
        env: 'WEBLESS_STORAGE_ROOT'
      });
    }

    const absoluteRoot = path.resolve(this.root);
    const absolutePath = path.resolve(absoluteRoot, storagePath);

    if (!absolutePath.startsWith(absoluteRoot + path.sep)) {
      throw codedError('VALIDATION_FAILED', 'Invalid storage path.');
    }

    return absolutePath;
  }
}

export class GcsStorageAdapter {
  constructor({ bucket, fetchImpl = fetch, credentialsPath = '' }) {
    this.bucket = bucket;
    this.fetch = fetchImpl;
    this.credentialsPath = credentialsPath;
    this.cachedCredentials = null;
    this.cachedAccessToken = null;
    this.cachedAccessTokenExpiresAt = 0;
  }

  async readText(storagePath) {
    const response = await this.fetch(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.requireBucket())}/o/${encodeURIComponent(storagePath)}?alt=media`,
      {
        headers: {
          authorization: `Bearer ${await this.accessToken()}`
        }
      }
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw codedError('UPSTREAM_ERROR', `Unable to read object from Cloud Storage: HTTP ${response.status}`);
    }

    return response.text();
  }

  async readBytes(storagePath) {
    const response = await this.fetch(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.requireBucket())}/o/${encodeURIComponent(storagePath)}?alt=media`,
      {
        headers: {
          authorization: `Bearer ${await this.accessToken()}`
        }
      }
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw codedError('UPSTREAM_ERROR', `Unable to read object from Cloud Storage: HTTP ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  async write(storagePath, bytes, contentType = 'application/octet-stream') {
    const response = await this.fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.requireBucket())}/o?uploadType=media&name=${encodeURIComponent(storagePath)}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.accessToken()}`,
          'content-type': contentType
        },
        body: bytes
      }
    );

    if (!response.ok) {
      throw codedError('UPSTREAM_ERROR', `Unable to write object to Cloud Storage: HTTP ${response.status}`);
    }
  }

  async listFiles(prefix) {
    const normalizedPrefix = prefix.replace(/\/+$/, '') + '/';
    const response = await this.fetch(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.requireBucket())}/o?prefix=${encodeURIComponent(normalizedPrefix)}`,
      {
        headers: {
          authorization: `Bearer ${await this.accessToken()}`
        }
      }
    );

    if (!response.ok) {
      throw codedError('UPSTREAM_ERROR', `Unable to list objects from Cloud Storage: HTTP ${response.status}`);
    }

    const payload = await response.json();
    const items = Array.isArray(payload.items) ? payload.items : [];

    return items
      .map((item) => String(item.name ?? ''))
      .filter((name) => name.startsWith(normalizedPrefix) && name.length > normalizedPrefix.length);
  }

  async delete(storagePath) {
    const response = await this.fetch(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.requireBucket())}/o/${encodeURIComponent(storagePath)}`,
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${await this.accessToken()}`
        }
      }
    );

    if (response.status === 404) {
      return;
    }

    if (!response.ok) {
      throw codedError('UPSTREAM_ERROR', `Unable to delete object from Cloud Storage: HTTP ${response.status}`);
    }
  }

  async deleteDirectory(prefix) {
    const files = await this.listFiles(prefix);

    for (const file of files) {
      await this.delete(file);
    }
  }

  requireBucket() {
    if (!this.bucket) {
      throw codedError('UPSTREAM_NOT_CONFIGURED', 'GCS_BUCKET is required when WEBLESS_STORAGE_DRIVER=gcs.', {
        env: 'GCS_BUCKET'
      });
    }

    return this.bucket;
  }

  async accessToken() {
    const now = Date.now();
    if (this.cachedAccessToken && this.cachedAccessTokenExpiresAt > now + 60_000) {
      return this.cachedAccessToken;
    }

    if (this.credentialsPath) {
      return this.serviceAccountAccessToken(now);
    }

    const response = await this.fetch(METADATA_TOKEN_URL, {
      headers: {
        'metadata-flavor': 'Google'
      }
    });

    if (!response.ok) {
      throw codedError('UPSTREAM_ERROR', `Unable to obtain Cloud Run metadata token: HTTP ${response.status}`);
    }

    const payload = await response.json();
    const accessToken = String(payload.access_token ?? '');

    if (!accessToken) {
      throw codedError('UPSTREAM_ERROR', 'Cloud Run metadata token response did not include access_token.');
    }

    this.cachedAccessToken = accessToken;
    this.cachedAccessTokenExpiresAt = now + Math.max(0, Number(payload.expires_in ?? 0) - 60) * 1000;

    return accessToken;
  }

  async serviceAccountAccessToken(now = Date.now()) {
    const credentials = await this.readServiceAccountCredentials();
    const clientEmail = String(credentials.client_email ?? '');
    const privateKey = String(credentials.private_key ?? '');

    if (!clientEmail || !privateKey) {
      throw codedError('UPSTREAM_NOT_CONFIGURED', 'Google application credentials must include client_email and private_key.', {
        env: 'GOOGLE_APPLICATION_CREDENTIALS'
      });
    }

    const iat = Math.floor(now / 1000);
    const assertion = signServiceAccountJwt({
      iss: clientEmail,
      scope: GCS_TOKEN_SCOPE,
      aud: GOOGLE_OAUTH_TOKEN_URL,
      iat,
      exp: iat + 3600
    }, privateKey);
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    });
    const response = await this.fetch(GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body
    });

    if (!response.ok) {
      throw codedError('UPSTREAM_ERROR', `Unable to obtain Google OAuth token: HTTP ${response.status}`);
    }

    const payload = await response.json();
    const accessToken = String(payload.access_token ?? '');

    if (!accessToken) {
      throw codedError('UPSTREAM_ERROR', 'Google OAuth token response did not include access_token.');
    }

    this.cachedAccessToken = accessToken;
    this.cachedAccessTokenExpiresAt = now + Math.max(0, Number(payload.expires_in ?? 0) - 60) * 1000;

    return accessToken;
  }

  async readServiceAccountCredentials() {
    if (this.cachedCredentials) {
      return this.cachedCredentials;
    }

    try {
      this.cachedCredentials = JSON.parse(await readFile(this.credentialsPath, 'utf8'));
      return this.cachedCredentials;
    } catch (error) {
      throw codedError('UPSTREAM_NOT_CONFIGURED', `Unable to read Google application credentials: ${error.message}`, {
        env: 'GOOGLE_APPLICATION_CREDENTIALS'
      });
    }
  }
}

function signServiceAccountJwt(claims, privateKey) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256').update(input).end().sign(privateKey, 'base64url');

  return `${input}.${signature}`;
}

function codedError(code, message, data = undefined) {
  const error = new Error(message);
  error.code = code;
  if (data) {
    error.data = data;
  }

  return error;
}

function requireInteger(value, name) {
  const normalizedValue = modelIntegerValue(value);
  const parsed = Number.parseInt(normalizedValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(normalizedValue).trim() === '') {
    throw codedError('VALIDATION_FAILED', `${name} must be a positive integer.`);
  }

  return parsed;
}

function requireActorAccountId(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return requireInteger(value.account_id ?? value.site?.account_id ?? value.id, 'account_id');
  }

  return requireInteger(value, 'account_id');
}

function modelIntegerValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of ['id', 'theme_id', 'site_page_id', 'site_id', 'member_id', 'product_id', 'value']) {
      if (value[key] !== undefined && value[key] !== null && value[key] !== '') {
        return value[key];
      }
    }
  }

  return value;
}

function requireOptionalPositiveInteger(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  return requireInteger(value, name);
}

function requireOptionalNonNegativeInteger(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(value).trim() === '') {
    throw codedError('VALIDATION_FAILED', `${name} must be a non-negative integer.`);
  }

  return parsed;
}

function requireOptionalDate(value, name) {
  const text = nullableString(value);
  if (!text) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw codedError('VALIDATION_FAILED', `${name} must use YYYY-MM-DD format.`);
  }

  return text;
}

function requireNonEmptyString(value, name) {
  const text = String(value ?? '').trim();
  if (text === '') {
    throw codedError('VALIDATION_FAILED', `${name} is required.`);
  }

  return text;
}

function requireGoogleEmail(value) {
  const email = requireNonEmptyString(value, 'google_email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw codedError('VALIDATION_FAILED', 'google_email must be a valid email address.');
  }

  return email;
}

function requireUrl(value, name) {
  const url = requireNonEmptyString(value, name);
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Unsupported protocol');
    }
  } catch {
    throw codedError('VALIDATION_FAILED', `${name} must be a valid http or https URL.`);
  }

  return url;
}

function requireImageMimeType(value, name) {
  const mimeType = String(value ?? '').trim().toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(mimeType)) {
    throw codedError('VALIDATION_FAILED', `${name} must be image/png, image/jpeg, image/jpg, or image/webp.`);
  }

  return mimeType;
}

function requireUploadTargetUsage(value) {
  const usage = String(value ?? '').trim();
  if (!['product_image', 'article_image', 'page_asset', 'theme_asset', 'brand_asset', 'reference'].includes(usage)) {
    throw codedError('VALIDATION_FAILED', 'target_usage must be product_image, article_image, page_asset, theme_asset, brand_asset, or reference.');
  }

  return usage;
}

function normalizeOpenAiFileParam(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.openaiFileIdRefs)) {
    value = value.openaiFileIdRefs[0];
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw codedError('VALIDATION_FAILED', 'image must be an OpenAI fileParams object with a download_url or download_link.');
  }

  const downloadUrl = value.download_url ?? value.downloadUrl ?? value.download_link ?? value.downloadLink ?? value.url;
  if (typeof downloadUrl !== 'string' || downloadUrl.trim() === '' || downloadUrl.startsWith('chat_upload')) {
    throw codedError('VALIDATION_FAILED', 'image.download_url or image.download_link is required. ChatGPT did not provide a downloadable OpenAI file parameter.');
  }

  const filename = String(value.name ?? value.file_name ?? value.filename ?? value.fileName ?? 'chatgpt-upload.png').trim();
  return {
    download_url: requireUrl(downloadUrl, 'image.download_url'),
    file_id: typeof value.file_id === 'string' ? value.file_id : (typeof value.fileId === 'string' ? value.fileId : (typeof value.id === 'string' ? value.id : null)),
    filename: filename || 'chatgpt-upload.png',
    mime_type: String(value.mime_type ?? value.mimeType ?? '').split(';')[0].trim().toLowerCase()
  };
}

async function parseJsonResponse(response, action) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = typeof payload?.message === 'string' && payload.message.trim() !== ''
      ? payload.message
      : `${action}: HTTP ${response.status}`;
    throw codedError('UPSTREAM_ERROR', message, { status: response.status });
  }

  return payload ?? {};
}

function createTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal?.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  return controller.signal;
}

function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function requireThemeName(value) {
  const name = String(value ?? '').trim();

  if (name.length < 2 || name.length > 80) {
    throw codedError('VALIDATION_FAILED', 'name must be between 2 and 80 characters.');
  }

  return name;
}

function normalizeRootFragments(value) {
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw codedError('VALIDATION_FAILED', 'fragments must be an object keyed by navbar, footer, or online_support.');
  }

  const allowed = new Set(['navbar', 'footer', 'online_support']);
  const normalized = {};

  for (const [key, html] of Object.entries(value)) {
    if (!allowed.has(key)) {
      throw codedError('VALIDATION_FAILED', `Unsupported root element fragment: ${key}`);
    }

    normalized[key] = extractSafeHtml(html, `fragments.${key}`);
  }

  return normalized;
}

function normalizePageKey(value) {
  const pageKey = String(value || 'index').trim();

  if (pageKey === 'home') {
    return 'index';
  }

  if (!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(pageKey)) {
    throw codedError('VALIDATION_FAILED', 'page_key must be a safe page identifier.');
  }

  return pageKey;
}

function safeGeneratedPageKey(value, fallbackPrefix = 'page') {
  const candidate = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

  return /[a-z]/.test(candidate) ? candidate : fallbackPrefix;
}

function normalizeSeoSettings(args, current = {}) {
  const normalized = {};

  for (const column of SEO_SETTINGS_COLUMNS) {
    normalized[column] = Object.prototype.hasOwnProperty.call(args, column)
      ? nullableString(args[column])
      : (current[column] ?? null);
  }

  normalized.robots_policy = normalizeRobotsPolicy(normalized.robots_policy);

  return normalized;
}

function normalizeContentSeoPayload(args) {
  const normalized = {};

  for (const column of SEO_SETTINGS_COLUMNS) {
    normalized[column] = Object.prototype.hasOwnProperty.call(args, column)
      ? nullableString(args[column])
      : null;
  }

  normalized.robots_policy = normalizeRobotsPolicy(normalized.robots_policy);

  return normalized;
}

function requireContentSeoType(value) {
  const contentType = requireNonEmptyString(value, 'content_type').toLowerCase();
  if (!['page', 'article'].includes(contentType)) {
    throw codedError('VALIDATION_FAILED', 'content_type must be page or article.');
  }

  return contentType;
}

function requireContentSeoWorkflowContext(value) {
  const workflowContext = String(value ?? '').trim().toLowerCase();
  if (!['page_create', 'page_update', 'article_create', 'article_update'].includes(workflowContext)) {
    throw codedError('VALIDATION_FAILED', 'workflow_context must be page_create, page_update, article_create, or article_update.');
  }

  return workflowContext;
}

function validateContentSeoWorkflow(contentType, workflowContext) {
  if (contentType === 'page' && !['page_create', 'page_update'].includes(workflowContext)) {
    throw codedError('VALIDATION_FAILED', 'Page SEO updates require workflow_context page_create or page_update.');
  }
  if (contentType === 'article' && !['article_create', 'article_update'].includes(workflowContext)) {
    throw codedError('VALIDATION_FAILED', 'Article SEO updates require workflow_context article_create or article_update.');
  }
}

function normalizeRobotsPolicy(value) {
  const policy = String(value ?? 'index,follow').trim().toLowerCase();

  if (!['index,follow', 'noindex,follow', 'noindex,nofollow'].includes(policy)) {
    throw codedError('VALIDATION_FAILED', 'robots_policy must be index,follow, noindex,follow, or noindex,nofollow.');
  }

  return policy;
}

function formatSeoSettings(row) {
  const settings = {};

  for (const column of SEO_SETTINGS_COLUMNS) {
    settings[column] = row[column] ?? null;
  }

  settings.robots_policy = settings.robots_policy ?? 'index,follow';

  return settings;
}

function normalizeReadinessCounts(row) {
  const counts = {};

  for (const [key, value] of Object.entries(row)) {
    counts[key] = Number.parseInt(value ?? '0', 10) || 0;
  }

  return counts;
}

function buildSiteReadinessReport({
  site,
  basicSettings,
  seoSettings,
  integrationSettings,
  mailDeliverySettings,
  mailLayout,
  paymentProviders,
  logisticsProviders,
  counts,
  includeOptional
}) {
  const categories = [
    paymentLogisticsReadiness(paymentProviders, logisticsProviders),
    catalogReadiness(counts),
    thirdPartyLoginReadiness(integrationSettings),
    emailReadiness(mailDeliverySettings, mailLayout),
    publicInformationReadiness(seoSettings),
    navigationReadiness(counts),
    customerSupportReadiness(integrationSettings, counts),
    adminAccessReadiness(counts),
    contentReadiness(counts)
  ];

  if (includeOptional) {
    categories.push(promotionReadiness(counts));
  }

  const requiredCategories = categories.filter((category) => category.severity !== 'optional');
  const issueCount = categories.reduce((total, category) => total + category.issues.length, 0);
  const requiredIssueCount = requiredCategories.reduce((total, category) => total + category.issues.length, 0);
  const readyRequiredCount = requiredCategories.filter((category) => category.status === 'ready').length;
  const readinessScore = requiredCategories.length === 0
    ? 100
    : Math.round((readyRequiredCount / requiredCategories.length) * 100);

  return {
    site,
    summary: {
      status: requiredIssueCount === 0 ? 'ready' : 'needs_setup',
      readiness_score: readinessScore,
      required_categories_ready: readyRequiredCount,
      required_categories_total: requiredCategories.length,
      issue_count: issueCount,
      required_issue_count: requiredIssueCount,
      optional_issue_count: issueCount - requiredIssueCount
    },
    categories,
    missing_categories: categories
      .filter((category) => category.issues.length > 0)
      .map((category) => ({
        key: category.key,
        label: category.label,
        status: category.status,
        severity: category.severity,
        issues: category.issues
      })),
    next_actions: categories
      .flatMap((category) => category.issues.map((issue) => ({
        category: category.key,
        key: issue.key,
        label: issue.label,
        suggested_tools: issue.suggested_tools
      })))
      .slice(0, 12),
    evidence: {
      basic_settings: {
        site_status: basicSettings.site_status,
        website_type: basicSettings.website_type
      },
      counts
    }
  };
}

function paymentLogisticsReadiness(paymentProviders, logisticsProviders) {
  const enabledPayments = paymentProviders.filter((provider) => provider.is_enabled);
  const enabledLogistics = logisticsProviders.filter((provider) => provider.is_enabled);
  const issues = [];

  if (enabledPayments.length === 0) {
    issues.push(readinessIssue(
      'payment_not_enabled',
      '尚未啟用金流',
      '沒有任何金流供應商啟用，前台無法完整收款。',
      ['slimweb_payment_logistics_get', 'slimweb_payment_logistics_update']
    ));
  }

  if (enabledPayments.some((provider) => provider.status !== 'enabled')) {
    issues.push(readinessIssue(
      'payment_credentials_incomplete',
      '金流憑證不完整',
      '至少一個已啟用金流仍缺少必要憑證或設定。',
      ['slimweb_payment_logistics_get', 'slimweb_payment_logistics_update']
    ));
  }

  if (enabledPayments.length > 0 && enabledPayments.every((provider) => provider.mode === 'test')) {
    issues.push(readinessIssue(
      'payment_test_mode_only',
      '金流仍在測試環境',
      '所有已啟用金流都是 test mode，正式收款前需要切換並填入正式參數。',
      ['slimweb_payment_logistics_get', 'slimweb_payment_logistics_update']
    ));
  }

  if (enabledLogistics.length === 0) {
    issues.push(readinessIssue(
      'logistics_not_enabled',
      '尚未啟用物流',
      '沒有任何物流供應商啟用，出貨與超商取貨流程不完整。',
      ['slimweb_payment_logistics_get', 'slimweb_payment_logistics_update']
    ));
  }

  if (enabledLogistics.some((provider) => provider.status !== 'enabled')) {
    issues.push(readinessIssue(
      'logistics_credentials_incomplete',
      '物流設定不完整',
      '至少一個已啟用物流仍缺少寄件資訊、門市類型或必要憑證。',
      ['slimweb_payment_logistics_get', 'slimweb_payment_logistics_update']
    ));
  }

  if (enabledLogistics.length > 0 && enabledLogistics.every((provider) => provider.mode === 'test')) {
    issues.push(readinessIssue(
      'logistics_test_mode_only',
      '物流仍在測試環境',
      '所有已啟用物流都是 test mode，正式出貨前需要切換正式參數。',
      ['slimweb_payment_logistics_get', 'slimweb_payment_logistics_update']
    ));
  }

  return readinessCategory('payment_logistics', '金物流設定', 'required', issues, {
    enabled_payment_providers: enabledPayments.map((provider) => provider.provider),
    enabled_logistics_providers: enabledLogistics.map((provider) => provider.provider)
  });
}

function catalogReadiness(counts) {
  const issues = [];

  if (counts.category_count === 0) {
    issues.push(readinessIssue('product_categories_missing', '沒有商品類別', '商品尚未建立分類，使用者與 AI 都難以理解商品結構。', ['slimweb_categories_upsert']));
  }

  if (counts.product_count === 0) {
    issues.push(readinessIssue('products_missing', '沒有商品', '站台尚未建立商品資料。', ['slimweb_products_upsert', 'slimweb_products_import_commit']));
  } else if (counts.active_product_count === 0) {
    issues.push(readinessIssue('active_products_missing', '沒有上架商品', '商品存在但沒有 active 狀態商品，前台商品內容不完整。', ['slimweb_products_list', 'slimweb_products_upsert']));
  }

  if (counts.product_count > 0 && counts.uncategorized_product_count > 0) {
    issues.push(readinessIssue('products_uncategorized', '部分商品未分類', '有商品沒有指定商品類別，商品瀏覽與推薦會變弱。', ['slimweb_products_list', 'slimweb_products_upsert']));
  }

  return readinessCategory('catalog', '商品資料', 'required', issues, counts);
}

function thirdPartyLoginReadiness(settings) {
  const issues = [];
  const hasGoogle = !isBlank(settings.google_login_client_id);
  const hasLine = !isBlank(settings.line_login_channel_id) && !isBlank(settings.line_login_channel_secret);

  if (!hasGoogle && !hasLine) {
    issues.push(readinessIssue('third_party_login_missing', '第三方登入未設定', 'Google Client ID 與 LINE Login Channel 資料都尚未填寫。', []));
  } else {
    if (!hasGoogle) {
      issues.push(readinessIssue('google_login_missing', 'Google 登入未設定', '尚未填寫 Google Client ID。', []));
    }
    if (!hasLine) {
      issues.push(readinessIssue('line_login_incomplete', 'LINE 登入未設定完整', 'LINE Channel ID 或 Channel Secret 尚未填寫完整。', []));
    }
  }

  return readinessCategory('third_party_login', '第三方登入', 'recommended', issues, {
    has_google_login: hasGoogle,
    has_line_login: hasLine
  });
}

function emailReadiness(settings, layout) {
  const issues = [];
  const smtpFields = [
    'notification_smtp_host',
    'notification_smtp_username',
    'notification_smtp_password',
    'notification_smtp_port',
    'notification_smtp_from_email'
  ];
  const missingSmtpFields = isSmtpConfigured(settings)
    ? []
    : smtpFields.filter((field) => isBlank(settings[field]));

  if (missingSmtpFields.length > 0) {
    issues.push(readinessIssue(
      'email_smtp_incomplete',
      'Email SMTP 未設定完整',
      `缺少欄位：${missingSmtpFields.join(', ')}。Gmail 需使用兩步驟驗證後建立的 16 碼應用程式密碼。`,
      ['slimweb_mail_layout_get', 'slimweb_mail_templates_get'],
      { missing_fields: missingSmtpFields }
    ));
  }

  if (isBlank(settings.notification_new_order_sms_numbers)) {
    issues.push(readinessIssue(
      'new_order_email_recipients_missing',
      '新訂單 Email 提示收件者未設定',
      '後台尚未填寫新訂單管理通知 Email，管理員可能無法即時收到新訂單提示。',
      ['slimweb_mail_templates_get']
    ));
  }

  return readinessCategory('email', 'Email 與郵件版型', 'recommended', issues, {
    smtp_configured: missingSmtpFields.length === 0,
    shipment_email_enabled: Boolean(settings.notification_sms_on_shipped),
    recovery_email_enabled: Boolean(settings.notification_auto_send_reminder_sms),
    custom_layout_enabled: Boolean(layout?.is_active)
  });
}

function publicInformationReadiness(settings) {
  const requiredGroups = [
    ['seo', 'SEO 對外資訊', ['seo_title', 'seo_description']],
    ['aeo', 'AEO 回答引擎資訊', ['aeo_business_summary', 'aeo_products_services', 'aeo_entity_facts']],
    ['geo', 'GEO 生成式搜尋資訊', ['geo_citation_targets', 'geo_verifiable_claims', 'geo_trust_signals', 'geo_same_as_profiles', 'geo_comparison_positioning']]
  ];
  const issues = [];

  if (isBlank(settings.llms_txt)) {
    issues.push(readinessIssue('llms_txt_missing', 'llms.txt 未填', 'AI crawler 與回答引擎缺少站台摘要。', ['slimweb_seo_settings_get', 'slimweb_seo_settings_update']));
  }

  for (const [key, label, fields] of requiredGroups) {
    const missingFields = fields.filter((field) => isBlank(settings[field]));
    if (missingFields.length > 0) {
      issues.push(readinessIssue(
        `${key}_fields_missing`,
        `${label}不完整`,
        `缺少欄位：${missingFields.join(', ')}`,
        ['slimweb_seo_settings_get', 'slimweb_seo_settings_update'],
        { missing_fields: missingFields }
      ));
    }
  }

  return readinessCategory('public_information', 'SEO / AEO / GEO 對外資訊', 'required', issues, {
    robots_policy: settings.robots_policy
  });
}

function navigationReadiness(counts) {
  const issues = counts.nav_item_count === 0
    ? [readinessIssue('navigation_missing', '導覽列未設定', '站台沒有導覽項目，使用者不容易進入商品、文章或固定頁面。', ['slimweb_nav_items_upsert'])]
    : [];

  return readinessCategory('navigation', '導覽與頁面入口', 'recommended', issues, {
    nav_item_count: counts.nav_item_count
  });
}

function customerSupportReadiness(settings, counts) {
  const issues = [];

  if (!settings.use_ai_customer_service) {
    issues.push(readinessIssue('ai_customer_service_disabled', 'AI 客服未啟用', 'AI 客服目前未啟用，使用者問題無法由站台客服 AI 接手。', ['slimweb_customer_service_settings_get', 'slimweb_customer_service_settings_update']));
  }

  return readinessCategory('customer_support', 'AI 客服', 'recommended', issues, {
    use_ai_customer_service: Boolean(settings.use_ai_customer_service)
  });
}

function adminAccessReadiness(counts) {
  const issues = [];

  if (counts.admin_count === 0) {
    issues.push(readinessIssue('site_admin_missing', '後台管理員未建立', '站台沒有後台管理員資料。', ['slimweb_admins_upsert']));
  }

  if (counts.backend_ai_admin_count === 0) {
    issues.push(readinessIssue('backend_ai_permission_missing', 'AI 助理權限未開', '沒有後台管理員具備 backend_ai_assistant 權限，AI 無法完整協助管理站台。', ['slimweb_admins_list', 'slimweb_admins_upsert']));
  }

  return readinessCategory('admin_access', '管理員與 AI 權限', 'recommended', issues, counts);
}

function contentReadiness(counts) {
  const issues = counts.article_count === 0
    ? [readinessIssue('articles_missing', '文章內容未建立', '沒有文章內容，品牌知識、SEO 長尾內容與 AI 引用來源較弱。', ['slimweb_articles_list', 'slimweb_articles_create'])]
    : [];

  return readinessCategory('content', '文章與品牌內容', 'recommended', issues, {
    article_count: counts.article_count
  });
}

function promotionReadiness(counts) {
  const issues = [];

  if (counts.coupon_template_count === 0) {
    issues.push(readinessIssue('coupon_templates_missing', '優惠券模板未建立', '優惠券不是開站必需，但缺少會員經營與活動發券基礎。', ['slimweb_coupon_templates_upsert']));
  }

  if (counts.discount_code_count === 0) {
    issues.push(readinessIssue('discount_codes_missing', '折扣碼未建立', '折扣碼不是開站必需，但缺少促銷活動入口。', ['slimweb_discount_codes_upsert']));
  }

  return readinessCategory('promotions', '優惠與促銷', 'optional', issues, {
    coupon_template_count: counts.coupon_template_count,
    discount_code_count: counts.discount_code_count
  });
}

function readinessCategory(key, label, severity, issues, evidence = {}) {
  return {
    key,
    label,
    severity,
    status: issues.length === 0 ? 'ready' : (issues.some((issue) => issue.key.endsWith('_missing') || issue.key.endsWith('_not_enabled')) ? 'missing' : 'incomplete'),
    issues,
    evidence
  };
}

function readinessIssue(key, label, detail, suggestedTools, extra = {}) {
  return {
    key,
    label,
    detail,
    suggested_tools: suggestedTools,
    ...extra
  };
}

function isBlank(value) {
  return String(value ?? '').trim() === '';
}

function normalizeIntegrationSettings(args, current = {}) {
  const normalized = {};
  const booleanColumns = new Set([
    'facebook_comment_on_products',
    'facebook_comment_on_posts',
    'use_ai_customer_service'
  ]);

  for (const column of INTEGRATION_SETTINGS_COLUMNS) {
    if (booleanColumns.has(column)) {
      normalized[column] = Object.prototype.hasOwnProperty.call(args, column)
        ? Boolean(args[column])
        : Boolean(current[column]);
    } else {
      normalized[column] = Object.prototype.hasOwnProperty.call(args, column)
        ? nullableString(args[column])
        : (current[column] ?? null);
    }
  }

  normalized.ai_provider = normalizeAiProvider(normalized.ai_provider);

  return normalized;
}

function normalizeAiProvider(value) {
  const provider = String(value ?? 'openai_gpt').trim();

  if (!['openai_gpt', 'google_gemini'].includes(provider)) {
    throw codedError('VALIDATION_FAILED', 'ai_provider must be openai_gpt or google_gemini.');
  }

  return provider;
}

function formatIntegrationSettings(row) {
  const settings = {};

  for (const column of INTEGRATION_SETTINGS_COLUMNS) {
    settings[column] = row[column] ?? null;
  }

  settings.facebook_comment_on_products = Boolean(row.facebook_comment_on_products);
  settings.facebook_comment_on_posts = Boolean(row.facebook_comment_on_posts);
  settings.use_ai_customer_service = Boolean(row.use_ai_customer_service);
  settings.ai_provider = settings.ai_provider ?? 'openai_gpt';

  return settings;
}

function pickFacebookSettings(settings = {}) {
  return {
    facebook_app_id: settings.facebook_app_id ?? null,
    facebook_page_id: settings.facebook_page_id ?? null,
    facebook_comment_on_products: Boolean(settings.facebook_comment_on_products),
    facebook_comment_on_posts: Boolean(settings.facebook_comment_on_posts)
  };
}

function pickNotionSettings(settings = {}) {
  return {
    notion_token: settings.notion_token ?? null
  };
}

function defaultMailTemplate(triggerEvent) {
  const defaults = {
    order_created: {
      subject: '🌟 訂單已建立，感謝您的訂購',
      content: '<p>親愛的 member_name，</p><p>您的訂單已建立，我們將儘快為您處理，感謝您的訂購。</p>'
    },
    order_shipped: {
      subject: '📦 您的訂單已出貨',
      content: '<p>親愛的 member_name，</p><p>您的訂單已安排出貨，請留意配送或取貨通知。</p>'
    },
    store_arrived: {
      subject: '🏪 商品已抵達取貨門市',
      content: '<p>親愛的 member_name，</p><p>您的商品已抵達指定取貨門市，請於期限內前往取貨。</p>'
    },
    return_requested: {
      subject: '↩️ 已收到您的退貨申請',
      content: '<p>親愛的 member_name，</p><p>我們已收到您的退貨申請，將儘快為您處理。</p>'
    },
    return_logistics: {
      subject: '🚚 退貨物流已建立',
      content: '<p>親愛的 member_name，</p><p>退貨物流已建立，請依照通知完成退貨寄送或交付。</p>'
    },
    registration_code: {
      subject: '註冊驗證碼',
      content: '<p>親愛的 member_name，</p><p>您的註冊驗證碼是：{code}</p>'
    },
    password_reset: {
      subject: '密碼重設通知',
      content: '<p>親愛的 member_name，</p><p>您已申請重設密碼，請點擊下方連結設定新密碼：</p><p><a href="{link}">{link}</a></p>'
    }
  };

  return defaults[triggerEvent] ?? {
    subject: triggerEvent,
    content: '<p>親愛的 member_name，</p>'
  };
}

function formatMailTemplate(row) {
  return {
    id: row.id === null || row.id === undefined ? null : Number(row.id),
    site_id: Number(row.site_id),
    trigger_event: row.trigger_event,
    subject: row.subject ?? '',
    content: row.content ?? '',
    is_active: Boolean(row.is_active),
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null
  };
}

function formatMailLayout(row) {
  const html = row.html ?? null;

  return {
    id: row.id === null || row.id === undefined ? null : Number(row.id),
    site_id: Number(row.site_id),
    html,
    is_active: Boolean(row.is_active),
    uses_default_layout: !(Boolean(row.is_active) && typeof html === 'string' && html.trim() !== ''),
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null
  };
}

function formatMailDeliverySettings(row) {
  const settings = {};

  for (const column of MAIL_DELIVERY_SETTINGS_COLUMNS) {
    settings[column] = row[column] ?? null;
  }

  settings.notification_sms_on_shipped = Boolean(row.notification_sms_on_shipped);
  settings.notification_auto_send_reminder_sms = Boolean(row.notification_auto_send_reminder_sms);
  settings.notification_smtp_ssl = Boolean(row.notification_smtp_ssl);

  return settings;
}

function normalizeMailDeliverySettings(args, current = {}) {
  const normalized = {};
  const booleanColumns = new Set([
    'notification_sms_on_shipped',
    'notification_auto_send_reminder_sms',
    'notification_smtp_ssl'
  ]);

  for (const column of MAIL_DELIVERY_SETTINGS_COLUMNS) {
    if (booleanColumns.has(column)) {
      normalized[column] = Object.prototype.hasOwnProperty.call(args, column)
        ? Boolean(args[column])
        : Boolean(current[column]);
    } else {
      normalized[column] = Object.prototype.hasOwnProperty.call(args, column)
        ? nullableString(args[column])
        : (current[column] ?? null);
    }
  }

  return normalized;
}

function isSmtpConfigured(settings = {}) {
  const requiredSmtpFields = [
    'notification_smtp_host',
    'notification_smtp_username',
    'notification_smtp_password',
    'notification_smtp_port',
    'notification_smtp_from_email'
  ];

  return requiredSmtpFields.every((field) => !isBlank(settings[field]));
}

function normalizeMailTemplateUpdates(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw codedError('VALIDATION_FAILED', 'templates must be a non-empty array.');
  }

  return value.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw codedError('VALIDATION_FAILED', `templates[${index}] must be an object.`);
    }

    const triggerEvent = String(item.trigger_event ?? '').trim();
    if (!MAIL_TEMPLATE_EVENTS.includes(triggerEvent)) {
      throw codedError('VALIDATION_FAILED', `Unsupported trigger_event: ${triggerEvent}`);
    }

    const update = { trigger_event: triggerEvent };
    if (Object.prototype.hasOwnProperty.call(item, 'subject')) {
      update.subject = String(item.subject ?? '').trim();
      if (update.subject === '') {
        throw codedError('VALIDATION_FAILED', `templates[${index}].subject cannot be blank.`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(item, 'content')) {
      update.content = String(item.content ?? '');
    }
    if (Object.prototype.hasOwnProperty.call(item, 'is_active')) {
      update.is_active = Boolean(item.is_active);
    }

    return update;
  });
}

function normalizeBasicSettings(args, current = {}) {
  const normalized = {
    site_status: Object.prototype.hasOwnProperty.call(args, 'site_status') ? String(args.site_status ?? '').trim() : (current.site_status ?? 'active'),
    member_verification: Object.prototype.hasOwnProperty.call(args, 'member_verification') ? String(args.member_verification ?? '').trim() : (current.member_verification ?? 'none'),
    website_type: Object.prototype.hasOwnProperty.call(args, 'website_type') ? String(args.website_type ?? '').trim() : (current.website_type ?? 'ecommerce'),
    default_country_code: Object.prototype.hasOwnProperty.call(args, 'default_country_code') ? String(args.default_country_code ?? '').trim().toUpperCase() : (current.default_country_code ?? 'TW'),
    product_load_mode: Object.prototype.hasOwnProperty.call(args, 'product_load_mode') ? String(args.product_load_mode ?? '').trim() : (current.product_load_mode ?? 'pagination'),
    return_days_allowed: Object.prototype.hasOwnProperty.call(args, 'return_days_allowed') ? requireNonNegativeAmount(args.return_days_allowed, 'return_days_allowed') : Number.parseInt(current.return_days_allowed ?? '0', 10),
    product_category_depth: Object.prototype.hasOwnProperty.call(args, 'product_category_depth') ? requireInteger(args.product_category_depth, 'product_category_depth') : Number.parseInt(current.product_category_depth ?? '3', 10)
  };

  if (!['active', 'maintenance'].includes(normalized.site_status)) {
    throw codedError('VALIDATION_FAILED', 'site_status must be active or maintenance.');
  }

  if (!['none', 'email'].includes(normalized.member_verification)) {
    throw codedError('VALIDATION_FAILED', 'member_verification must be none or email.');
  }

  if (!['ecommerce', 'brand'].includes(normalized.website_type)) {
    throw codedError('VALIDATION_FAILED', 'website_type must be ecommerce or brand.');
  }

  if (!['TW', 'JP', 'KR', 'SG', 'HK', 'CN', 'US', 'CA', 'GB', 'AU'].includes(normalized.default_country_code)) {
    throw codedError('VALIDATION_FAILED', 'default_country_code is not supported.');
  }

  if (!['pagination', 'dynamic'].includes(normalized.product_load_mode)) {
    throw codedError('VALIDATION_FAILED', 'product_load_mode must be pagination or dynamic.');
  }

  if (![1, 2, 3].includes(normalized.product_category_depth)) {
    throw codedError('VALIDATION_FAILED', 'product_category_depth must be 1, 2, or 3.');
  }

  return normalized;
}

function formatBasicSettings(row) {
  return {
    site_status: row.site_status ?? 'active',
    member_verification: row.member_verification ?? 'none',
    website_type: row.website_type ?? 'ecommerce',
    default_country_code: row.default_country_code ?? 'TW',
    product_load_mode: row.product_load_mode ?? 'pagination',
    return_days_allowed: Number.parseInt(row.return_days_allowed ?? '0', 10),
    product_category_depth: Number.parseInt(row.product_category_depth ?? '3', 10)
  };
}

function supportedPaymentProviders() {
  return PAYMENT_PROVIDER_DEFINITIONS.map(({ provider, label, requires_hash_iv, online_card_exclusive }) => ({
    provider,
    label,
    requires_hash_iv,
    online_card_exclusive,
    language_options: paymentLanguageOptions(provider)
  }));
}

function supportedLogisticsProviders() {
  return LOGISTICS_PROVIDER_DEFINITIONS.map(({ provider, label, requires_hash_iv, supported_store_types, supports_logistics_type, logistics_type_options, follows_payment_provider, note }) => ({
    provider,
    label,
    requires_hash_iv,
    supported_store_types,
    supports_logistics_type,
    logistics_type_options,
    follows_payment_provider,
    note
  }));
}

function paymentLogisticsAnswerPolicy() {
  const paymentLabels = PAYMENT_PROVIDER_DEFINITIONS.map((provider) => provider.label).join('、');
  const logisticsLabels = LOGISTICS_PROVIDER_DEFINITIONS.map((provider) => provider.label).join('、');

  return {
    slimweb_site_payment_question: `When the user asks what payment providers their SlimWeb site can use, answer only from the supported SlimWeb providers: ${paymentLabels}. Do not invent unsupported providers.`,
    slimweb_site_logistics_question: `When the user asks what logistics providers their SlimWeb site can use, answer only from the supported SlimWeb providers: ${logisticsLabels}.`,
    convenience_store_logistics_question: 'For convenience-store logistics, answer from supported_logistics_providers. ECPay and NewebPay logistics follow the same payment provider enabled state and do not have a separate logistics switch. ECPay supports seven, family, hilife, and ok, with c2c/b2c matching the ECPay backend and b2c required for reverse logistics. NewebPay supports seven, family, and hilife by default; do not say OK is available for NewebPay unless provider docs or the merchant contract confirms it.',
    general_ecommerce_question: 'If the user asks about payment providers for ecommerce in general, that is outside the SlimWeb MCP contract; do not claim it is a SlimWeb-supported provider unless it appears in supported_payment_providers.',
    slimai_policy: 'Inside SlimAI, answer payment/logistics questions from SlimWeb supported providers first.'
  };
}

function normalizePaymentProviderUpdates(value) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw codedError('VALIDATION_FAILED', 'payments must be an array.');
  }

  return value.map((provider) => {
    if (!provider || typeof provider !== 'object') {
      throw codedError('VALIDATION_FAILED', 'Each payment provider update must be an object.');
    }

    const definition = paymentProviderDefinition(provider.provider);

    return {
      provider: definition.provider,
      mode: normalizeProviderMode(provider.mode),
      is_enabled: Boolean(provider.is_enabled),
      merchant_id: nullableString(provider.merchant_id),
      hash_key: normalizeCredentialInput(provider.hash_key),
      hash_iv: normalizeCredentialInput(provider.hash_iv),
      language: normalizePaymentLanguage(provider.language, definition.provider)
    };
  });
}

function normalizeLogisticsProviderUpdates(value) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw codedError('VALIDATION_FAILED', 'logistics must be an array.');
  }

  return value.map((provider) => {
    if (!provider || typeof provider !== 'object') {
      throw codedError('VALIDATION_FAILED', 'Each logistics provider update must be an object.');
    }

    const definition = logisticsProviderDefinition(provider.provider);

    return {
      provider: definition.provider,
      mode: normalizeProviderMode(provider.mode),
      is_enabled: Boolean(provider.is_enabled),
      merchant_id: nullableString(provider.merchant_id),
      password: normalizeCredentialInput(provider.password ?? provider.hash_key),
      customer_id: nullableString(provider.customer_id ?? provider.hash_iv),
      sender_name: nullableString(provider.sender_name),
      sender_phone: nullableString(provider.sender_phone),
      sender_zip: nullableString(provider.sender_zip),
      sender_address: nullableString(provider.sender_address),
      store_types: normalizeStoreTypes(provider.store_types, definition),
      logistics_type: normalizeLogisticsType(provider.logistics_type, definition),
      collect_payment_enabled: definition.provider === 'hct' ? Boolean(provider.collect_payment_enabled) : false
    };
  });
}

function normalizeProviderMode(value) {
  const mode = String(value ?? 'test').trim();

  if (!['test', 'production'].includes(mode)) {
    throw codedError('VALIDATION_FAILED', 'mode must be test or production.');
  }

  return mode;
}

function paymentLanguageOptions(provider) {
  if (provider === 'ecpay') {
    return ['zh-tw', 'zh-cn', 'en', 'jp', 'ko'];
  }

  if (provider === 'newebpay') {
    return ['zh-tw', 'en', 'jp'];
  }

  if (provider === 'linepay') {
    return ['zh-tw', 'zh-cn', 'en', 'jp', 'ko', 'th'];
  }

  return ['zh-tw'];
}

function defaultPaymentLanguage(provider) {
  return paymentLanguageOptions(provider)[0];
}

function normalizePaymentLanguage(value, provider) {
  const options = paymentLanguageOptions(provider);
  const normalized = String(value ?? defaultPaymentLanguage(provider)).trim().toLowerCase();

  if (!options.includes(normalized)) {
    throw codedError('VALIDATION_FAILED', `language for ${provider} must be one of: ${options.join(', ')}.`);
  }

  return normalized;
}

function normalizeStoreTypes(value, definition) {
  const supported = definition.supported_store_types ?? [];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw codedError('VALIDATION_FAILED', `store_types for ${definition.provider} must be an array.`);
  }

  const normalized = [];
  for (const item of value) {
    const storeType = String(item ?? '').trim();
    if (!supported.includes(storeType)) {
      throw codedError('VALIDATION_FAILED', `store_types for ${definition.provider} must be one of: ${supported.join(', ')}.`);
    }
    if (!normalized.includes(storeType)) {
      normalized.push(storeType);
    }
  }

  return normalized;
}

function filterSupportedStoreTypes(value, definition) {
  const supported = definition.supported_store_types ?? [];
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item ?? '').trim())
    .filter((item, index, items) => supported.includes(item) && items.indexOf(item) === index);
}

function normalizeLogisticsType(value, definition) {
  if (!definition.supports_logistics_type) {
    return undefined;
  }

  const normalized = String(value ?? 'c2c').trim();
  if (!definition.logistics_type_options.includes(normalized)) {
    throw codedError('VALIDATION_FAILED', `logistics_type for ${definition.provider} must be one of: ${definition.logistics_type_options.join(', ')}.`);
  }

  return normalized;
}

function normalizeCredentialInput(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized === MASKED_PROVIDER_CREDENTIAL ? undefined : normalized;
}

function assertOnlyOneOnlineCardPaymentEnabled(paymentUpdates) {
  const enabledOnlineCardProviders = paymentUpdates
    .filter((provider) => provider.is_enabled && ONLINE_CARD_PAYMENT_PROVIDERS.includes(provider.provider))
    .map((provider) => provider.provider);

  if (new Set(enabledOnlineCardProviders).size > 1) {
    throw codedError('VALIDATION_FAILED', 'Only one online card payment provider can be enabled at a time. LINE Pay is exempt from this rule.');
  }
}

function paymentProviderDefinition(provider) {
  const definition = PAYMENT_PROVIDER_DEFINITIONS.find((item) => item.provider === provider);

  if (!definition) {
    throw codedError('VALIDATION_FAILED', `Unsupported payment provider: ${provider}. Supported providers are ${PAYMENT_PROVIDER_DEFINITIONS.map((item) => item.provider).join(', ')}.`);
  }

  return definition;
}

function logisticsProviderDefinition(provider) {
  const definition = LOGISTICS_PROVIDER_DEFINITIONS.find((item) => item.provider === provider);

  if (!definition) {
    throw codedError('VALIDATION_FAILED', `Unsupported logistics provider: ${provider}. Supported providers are ${LOGISTICS_PROVIDER_DEFINITIONS.map((item) => item.provider).join(', ')}.`);
  }

  return definition;
}

function normalizePaymentProviderSettings(update, current, definition) {
  const settings = {
    merchant_id: update.merchant_id ?? current.merchant_id ?? '',
    hash_key: update.hash_key ?? current.hash_key ?? '',
    hash_iv: definition.requires_hash_iv ? (update.hash_iv ?? current.hash_iv ?? '') : '',
    language: update.language ?? current.language ?? defaultPaymentLanguage(definition.provider)
  };

  return settings;
}

function normalizeLogisticsProviderSettings(update, current, definition, paymentSettings = {}) {
  const settings = {
    merchant_id: definition.provider === 'hct'
      ? (update.merchant_id ?? current.merchant_id ?? '')
      : (paymentSettings.merchant_id ?? current.merchant_id ?? ''),
    sender_name: update.sender_name ?? current.sender_name ?? '',
    sender_phone: update.sender_phone ?? current.sender_phone ?? '',
    sender_zip: update.sender_zip ?? current.sender_zip ?? '',
    sender_address: update.sender_address ?? current.sender_address ?? '',
    collect_payment_enabled: definition.provider === 'hct' ? Boolean(update.collect_payment_enabled ?? current.collect_payment_enabled) : false
  };

  if (definition.provider === 'hct') {
    settings.password = update.password ?? current.password ?? current.hash_key ?? '';
    settings.customer_id = update.customer_id ?? current.customer_id ?? current.hash_iv ?? '';
    return settings;
  }

  settings.store_types = update.store_types ?? filterSupportedStoreTypes(current.store_types ?? [], definition);
  if (definition.supports_logistics_type) {
    settings.logistics_type = update.logistics_type ?? (definition.logistics_type_options.includes(current.logistics_type) ? current.logistics_type : 'c2c');
  }

  return settings;
}

function validateProviderCredentials(enabled, settings, requiresHashIv) {
  if (!enabled) {
    return;
  }

  if (String(settings.merchant_id ?? '').trim() === '') {
    throw codedError('VALIDATION_FAILED', 'merchant_id is required when enabling this provider.');
  }

  if (String(settings.hash_key ?? '').trim() === '') {
    throw codedError('VALIDATION_FAILED', 'hash_key is required when enabling this provider.');
  }

  if (requiresHashIv && String(settings.hash_iv ?? '').trim() === '') {
    throw codedError('VALIDATION_FAILED', 'hash_iv is required when enabling this provider.');
  }
}

function validateLogisticsProviderSettings(enabled, settings, definition) {
  if (!enabled) {
    return;
  }

  if (String(settings.merchant_id ?? '').trim() === '') {
    throw codedError('VALIDATION_FAILED', 'merchant_id is required when enabling this provider.');
  }

  for (const field of ['sender_name', 'sender_phone', 'sender_zip', 'sender_address']) {
    if (String(settings[field] ?? '').trim() === '') {
      throw codedError('VALIDATION_FAILED', `${field} is required when enabling this provider.`);
    }
  }

  if (definition.provider === 'hct') {
    if (String(settings.password ?? '').trim() === '') {
      throw codedError('VALIDATION_FAILED', 'password is required when enabling this provider.');
    }
    return;
  }

  if (!Array.isArray(settings.store_types) || settings.store_types.length === 0) {
    throw codedError('VALIDATION_FAILED', 'store_types is required when enabling this provider.');
  }
}

function defaultProviderRow(siteId, definition) {
  return {
    id: null,
    site_id: siteId,
    provider: definition.provider,
    mode: 'test',
    is_enabled: false,
    settings: {},
    sort_order: definition.sort_order,
    created_at: null,
    updated_at: null
  };
}

function formatPaymentProvider(row, definition, appKey) {
  const settings = readProviderSettings(row.settings, appKey);
  const exists = row.id !== null && row.id !== undefined;

  return {
    id: row.id ?? null,
    provider: definition.provider,
    label: definition.label,
    mode: row.mode ?? 'test',
    is_enabled: Boolean(row.is_enabled),
    status: providerStatus(exists, Boolean(row.is_enabled), settings, definition.requires_hash_iv),
    online_card_exclusive: definition.online_card_exclusive,
    settings: {
      merchantId: settings.merchant_id ?? '',
      hashKey: maskedProviderCredential(settings.hash_key),
      hashIv: maskedProviderCredential(settings.hash_iv),
      language: settings.language ?? defaultPaymentLanguage(definition.provider)
    }
  };
}

function formatLogisticsProvider(row, definition, appKey) {
  const settings = readProviderSettings(row.settings, appKey);
  const exists = row.id !== null && row.id !== undefined;

  return {
    id: row.id ?? null,
    provider: definition.provider,
    label: definition.label,
    mode: row.mode ?? 'test',
    is_enabled: Boolean(row.is_enabled),
    status: logisticsProviderStatus(exists, Boolean(row.is_enabled), settings, definition),
    supported_store_types: definition.supported_store_types,
    supports_logistics_type: definition.supports_logistics_type,
    logistics_type_options: definition.logistics_type_options,
    follows_payment_provider: definition.follows_payment_provider,
    note: definition.note,
    settings: {
      merchantId: settings.merchant_id ?? '',
      password: definition.provider === 'hct' ? maskedProviderCredential(settings.password ?? settings.hash_key) : '',
      customerId: definition.provider === 'hct' ? (settings.customer_id ?? settings.hash_iv ?? '') : '',
      senderName: settings.sender_name ?? '',
      senderPhone: settings.sender_phone ?? '',
      senderZip: settings.sender_zip ?? '',
      senderAddress: settings.sender_address ?? '',
      storeTypes: filterSupportedStoreTypes(settings.store_types ?? [], definition),
      logisticsType: definition.supports_logistics_type && definition.logistics_type_options.includes(settings.logistics_type)
        ? settings.logistics_type
        : 'c2c',
      collectPaymentEnabled: Boolean(settings.collect_payment_enabled)
    }
  };
}

function providerStatus(exists, enabled, settings, requiresHashIv) {
  if (!exists) {
    return 'not_configured';
  }

  const hasCredentials = String(settings.merchant_id ?? '').trim() !== ''
    && String(settings.hash_key ?? '').trim() !== ''
    && (!requiresHashIv || String(settings.hash_iv ?? '').trim() !== '');

  if (!hasCredentials) {
    return 'missing_credentials';
  }

  return enabled ? 'enabled' : 'configured';
}

function logisticsProviderStatus(exists, enabled, settings, definition) {
  if (!exists) {
    return 'not_configured';
  }

  const hasRequiredSettings = String(settings.merchant_id ?? '').trim() !== ''
    && String(settings.sender_name ?? '').trim() !== ''
    && String(settings.sender_phone ?? '').trim() !== ''
    && String(settings.sender_zip ?? '').trim() !== ''
    && String(settings.sender_address ?? '').trim() !== '';

  const isConfigured = definition.provider === 'hct'
    ? hasRequiredSettings && String(settings.password ?? settings.hash_key ?? '').trim() !== ''
    : hasRequiredSettings && Array.isArray(settings.store_types) && settings.store_types.length > 0;

  if (!isConfigured) {
    return 'missing_credentials';
  }

  return enabled ? 'enabled' : 'configured';
}

function maskedProviderCredential(value) {
  return String(value ?? '').trim() === '' ? '' : MASKED_PROVIDER_CREDENTIAL;
}

function readProviderSettings(value, appKey) {
  if (value === undefined || value === null || value === '') {
    return {};
  }

  if (typeof value === 'object' && !Buffer.isBuffer(value)) {
    return value;
  }

  const text = String(value);
  if (text.trim().startsWith('{')) {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  if (!appKey) {
    return {};
  }

  const decrypted = decryptLaravelString(text, appKey);
  try {
    return JSON.parse(decrypted);
  } catch {
    return {};
  }
}

function writeProviderSettings(settings, appKey) {
  if (!appKey) {
    throw codedError('UPSTREAM_NOT_CONFIGURED', 'WEBLESS_APP_KEY, LARAVEL_APP_KEY, or APP_KEY is required to write encrypted payment/logistics provider settings.');
  }

  return encryptLaravelString(JSON.stringify(settings), appKey);
}

function laravelEncryptionKey(appKey) {
  const value = String(appKey ?? '').trim();
  const key = value.startsWith('base64:')
    ? Buffer.from(value.slice('base64:'.length), 'base64')
    : Buffer.from(value);

  if (![16, 32].includes(key.length)) {
    throw codedError('UPSTREAM_NOT_CONFIGURED', 'Laravel APP_KEY must decode to 16 or 32 bytes for payment/logistics encryption.');
  }

  return key;
}

function laravelCipherForKey(key) {
  return key.length === 16 ? 'aes-128-cbc' : 'aes-256-cbc';
}

function encryptLaravelString(value, appKey) {
  const key = laravelEncryptionKey(appKey);
  const iv = randomBytes(16);
  const cipher = createCipheriv(laravelCipherForKey(key), key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]).toString('base64');
  const encodedIv = iv.toString('base64');
  const mac = createHmac('sha256', key).update(encodedIv + encrypted).digest('hex');

  return Buffer.from(JSON.stringify({ iv: encodedIv, value: encrypted, mac, tag: '' })).toString('base64');
}

function decryptLaravelString(payload, appKey) {
  const key = laravelEncryptionKey(appKey);
  const decoded = JSON.parse(Buffer.from(String(payload), 'base64').toString('utf8'));
  const iv = String(decoded.iv ?? '');
  const value = String(decoded.value ?? '');
  const mac = String(decoded.mac ?? '');
  const expectedMac = createHmac('sha256', key).update(iv + value).digest('hex');

  if (
    mac.length !== expectedMac.length
    || !timingSafeEqual(Buffer.from(mac), Buffer.from(expectedMac))
  ) {
    throw codedError('VALIDATION_FAILED', 'Encrypted provider settings failed integrity validation.');
  }

  const decipher = createDecipheriv(laravelCipherForKey(key), key, Buffer.from(iv, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value, 'base64')), decipher.final()]).toString('utf8');
}

function normalizeAdminPermissions(value) {
  if (!Array.isArray(value)) {
    throw codedError('VALIDATION_FAILED', 'permissions must be an array.');
  }

  const allowed = new Set(ADMIN_PERMISSION_KEYS);
  const permissions = Array.from(new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean)));
  const invalid = permissions.filter((permission) => !allowed.has(permission));

  if (invalid.length > 0) {
    throw codedError('VALIDATION_FAILED', `Unsupported permission key: ${invalid[0]}`);
  }

  if (permissions.length === 0) {
    throw codedError('VALIDATION_FAILED', 'At least one permission is required.');
  }

  return permissions;
}

function normalizeExternalAssetScope(value) {
  const scope = String(value ?? '').trim();
  if (!['site', 'theme', 'page'].includes(scope)) {
    throw codedError('VALIDATION_FAILED', 'scope must be site, theme, or page.');
  }

  return scope;
}

function normalizeExternalAssetType(value) {
  const assetType = String(value ?? '').trim();
  if (!['css', 'js'].includes(assetType)) {
    throw codedError('VALIDATION_FAILED', 'asset_type must be css or js.');
  }

  return assetType;
}

function normalizeExternalAssetPlacement(value) {
  const placement = String(value ?? 'head').trim();
  if (!['head', 'body_end'].includes(placement)) {
    throw codedError('VALIDATION_FAILED', 'placement must be head or body_end.');
  }

  return placement;
}

function normalizeExternalAssetLoadMode(value) {
  const loadMode = String(value ?? 'defer').trim();
  if (!['normal', 'defer', 'async'].includes(loadMode)) {
    throw codedError('VALIDATION_FAILED', 'load_mode must be normal, defer, or async.');
  }

  return loadMode;
}

function normalizeNonNegativeInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(value).trim() === '') {
    throw codedError('VALIDATION_FAILED', `${name} must be a non-negative integer.`);
  }

  return parsed;
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 1 || value === '1' || value === 'true') {
    return true;
  }

  if (value === 0 || value === '0' || value === 'false') {
    return false;
  }

  return Boolean(value);
}

function normalizeJsonObject(value) {
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  throw codedError('VALIDATION_FAILED', 'attributes must be an object.');
}

function ensureSystemAdminPermission(permissions) {
  return Array.from(new Set(['system_admin', ...permissions]));
}

function allAdminPermissionKeys() {
  return ADMIN_PERMISSION_KEYS.slice();
}

function normalizeStoredPermissions(value) {
  if (Array.isArray(value)) {
    return value.filter((permission) => typeof permission === 'string');
  }

  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((permission) => typeof permission === 'string') : [];
    } catch {
      return [];
    }
  }

  return [];
}

function formatSite(row, clientMcpBaseUrl = '') {
  return {
    id: row.id,
    slug: row.slug,
    site_code: row.callback_code ?? null,
    name: row.name,
    domain: row.domain,
    callback_code: row.callback_code ?? null,
    icon_path: row.icon_path ?? null,
    client_mcp_url: clientMcpUrlForSite(row, clientMcpBaseUrl),
    site_status: normalizeSiteStatus(row.site_status),
    site_status_label: siteStatusLabel(row.site_status),
    theme_mode: normalizeSiteThemeMode(row.theme_mode)
  };
}

function formatAdminSite(row, clientMcpBaseUrl = '') {
  const isFirstAdmin = String(row.site_admin_id) === String(row.first_admin_id);
  const permissions = isFirstAdmin
    ? allAdminPermissionKeys()
    : normalizeStoredPermissions(row.permissions);

  return {
    id: row.id,
    site_id: row.id,
    site_code: row.callback_code ?? null,
    account_id: row.account_id ?? null,
    site_admin_id: row.site_admin_id,
    slug: row.slug,
    name: row.name,
    domain: row.domain,
    callback_code: row.callback_code ?? null,
    icon_path: row.icon_path ?? null,
    client_mcp_url: clientMcpUrlForSite(row, clientMcpBaseUrl),
    theme_mode: normalizeSiteThemeMode(row.theme_mode),
    google_email: row.google_email ?? null,
    google_sub: row.google_sub ?? null,
    permissions,
    site_status: normalizeSiteStatus(row.site_status),
    site_status_label: siteStatusLabel(row.site_status)
  };
}

function clientMcpUrlForSite(site, clientMcpBaseUrl = '') {
  const callbackCode = site.callback_code ?? null;

  if (!clientMcpBaseUrl || !callbackCode) {
    return null;
  }

  return `${clientMcpBaseUrl.replace(/\/+$/, '')}/sites/${encodeURIComponent(callbackCode)}/mcp`;
}

function formatAdmin(admin, options = {}) {
  const isSystemAdmin = String(admin.id) === String(options.first_admin_id);
  const permissions = Array.isArray(admin.permissions)
    ? admin.permissions.filter((permission) => typeof permission === 'string')
    : [];
  const permissionKeys = isSystemAdmin ? ensureSystemAdminPermission(permissions) : permissions;

  return {
    id: admin.id,
    username: admin.username ?? admin.google_email ?? '',
    google_email: admin.google_email ?? null,
    googleEmail: admin.google_email ?? null,
    google_sub: admin.google_sub ?? null,
    permissions: permissionKeys,
    permissionKeys,
    avatar_path: admin.avatar_path ?? null,
    avatarUrl: admin.avatar_path ? mediaUrlFor(options.publicSiteBaseUrl, admin.avatar_path) : null,
    is_system_admin: isSystemAdmin,
    isSystemAdmin,
    can_delete: !isSystemAdmin,
    canDelete: !isSystemAdmin,
    created_at: admin.created_at,
    updated_at: admin.updated_at
  };
}

function formatExternalAsset(asset) {
  return {
    id: asset.id,
    site_id: asset.site_id,
    site_page_id: asset.site_page_id,
    page_key: asset.page_key,
    scope: asset.scope,
    asset_type: asset.asset_type,
    url: asset.url,
    placement: asset.placement,
    load_mode: asset.load_mode,
    sort_order: Number.parseInt(asset.sort_order ?? '0', 10),
    is_enabled: Boolean(asset.is_enabled),
    purpose: asset.purpose ?? null,
    attributes: normalizeJsonObject(asset.attributes ?? {}),
    created_at: asset.created_at,
    updated_at: asset.updated_at
  };
}

function clampPositiveInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function requireArticleTitle(value) {
  const title = String(value ?? '').trim();

  if (title.length < 1 || title.length > 255) {
    throw codedError('VALIDATION_FAILED', 'title must be between 1 and 255 characters.');
  }

  return title;
}

function requireCategoryName(value) {
  const name = String(value ?? '').trim();

  if (name.length < 1 || name.length > 255) {
    throw codedError('VALIDATION_FAILED', 'name must be between 1 and 255 characters.');
  }

  return name;
}

function requireNavItemName(value) {
  const name = String(value ?? '').trim();

  if (name.length < 1 || name.length > 255) {
    throw codedError('VALIDATION_FAILED', 'name must be between 1 and 255 characters.');
  }

  return name;
}

function normalizeNavItemType(value) {
  const itemType = String(value ?? '').trim();

  if (!['dropdown', 'link'].includes(itemType)) {
    throw codedError('VALIDATION_FAILED', 'item_type must be dropdown or link.');
  }

  return itemType;
}

function normalizeNavItemUrl(value, itemType) {
  if (itemType === 'dropdown') {
    return null;
  }

  const url = String(value ?? '').trim();
  if (url.length < 1 || url.length > 2048) {
    throw codedError('VALIDATION_FAILED', 'url is required for link navigation items and must be 2048 characters or fewer.');
  }

  return url;
}

function normalizeGeneratedSvgIcon(value, existing = null, required = false) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) {
      throw codedError('VALIDATION_FAILED', 'icon_svg_base64 is required when creating this item. Generate a semantic SVG icon, base64-encode the SVG markup, and pass it as icon_svg_base64.');
    }

    return existing;
  }

  const raw = String(value).trim();
  const base64 = raw.startsWith('data:image/svg+xml;base64,')
    ? raw.slice('data:image/svg+xml;base64,'.length)
    : raw;
  let svg;

  try {
    svg = Buffer.from(base64, 'base64').toString('utf8').trim();
  } catch {
    throw codedError('VALIDATION_FAILED', 'icon_svg_base64 must be valid base64-encoded SVG markup.');
  }

  if (!svg || !svg.toLowerCase().includes('<svg')) {
    throw codedError('VALIDATION_FAILED', 'icon_svg_base64 must decode to SVG markup.');
  }

  return sanitizeGeneratedSvg(svg);
}

function sanitizeGeneratedSvg(svg) {
  let clean = svg.trim();
  clean = clean.replace(/<\?xml.*?\?>/gis, '');
  clean = clean.replace(/<!DOCTYPE.*?>/gis, '');
  clean = clean.replace(/<script\b[^>]*>.*?<\/script>/gis, '');
  clean = clean.replace(/\son[a-z]+\s*=\s*("|\').*?\1/gis, '');

  if (!/<svg\b[^>]*>/i.test(clean)) {
    throw codedError('VALIDATION_FAILED', 'icon SVG must contain an <svg> element.');
  }

  clean = clean.replace(/<svg\b([^>]*)>/i, (_match, attrs) => {
    let normalizedAttrs = String(attrs ?? '')
      .replace(/\s(width|height)\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
      .trim();

    if (!/\bxmlns\s*=/i.test(normalizedAttrs)) {
      normalizedAttrs = `xmlns="http://www.w3.org/2000/svg"${normalizedAttrs ? ` ${normalizedAttrs}` : ''}`;
    }
    if (!/\bviewBox\s*=/i.test(normalizedAttrs)) {
      normalizedAttrs += `${normalizedAttrs ? ' ' : ''}viewBox="0 0 24 24"`;
    }

    return `<svg width="24" height="24" ${normalizedAttrs}>`;
  });

  return clean.trim();
}

function normalizeNullableInteger(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  return requireInteger(value, name);
}

function buildCategoryTree(categories, productCounts, parentId = null, depth = 1) {
  return categories
    .filter((category) => category.parent_id === parentId)
    .map((category) => {
      const children = buildCategoryTree(categories, productCounts, category.id, depth + 1);
      const childCount = children.reduce((sum, child) => sum + child.product_count, 0);
      const directCount = productCounts.get(category.id) ?? 0;

      return {
        ...category,
        depth,
        product_count: children.length > 0 ? childCount : directCount,
        is_leaf: children.length === 0,
        children
      };
    });
}

function formatCategory(category) {
  return {
    id: category.id,
    site_id: category.site_id,
    parent_id: category.parent_id ?? null,
    name: category.name,
    icon_svg: category.icon_svg ?? null,
    icon_path: category.icon_path ?? null,
    image_path: category.image_path ?? null,
    sort_order: Number.parseInt(category.sort_order ?? '0', 10),
    created_at: category.created_at ?? null,
    updated_at: category.updated_at ?? null
  };
}

function categoryChangedFields(before, after) {
  const fields = ['parent_id', 'name', 'icon_svg', 'image_path', 'sort_order'];
  if (!before) {
    return fields.filter((field) => after[field] !== undefined && after[field] !== null);
  }

  return fields.filter((field) => {
    const beforeValue = before[field] === undefined || before[field] === null ? null : String(before[field]);
    const afterValue = after[field] === undefined || after[field] === null ? null : String(after[field]);
    return beforeValue !== afterValue;
  });
}

function formatNavItem(item) {
  return {
    id: item.id,
    site_id: item.site_id,
    parent_id: item.parent_id ?? null,
    name: item.name,
    item_type: item.item_type,
    url: item.url ?? null,
    icon_svg: item.icon_svg ?? null,
    icon_path: item.icon_path ?? null,
    sort_order: Number.parseInt(item.sort_order ?? '0', 10),
    created_at: item.created_at ?? null,
    updated_at: item.updated_at ?? null
  };
}

function normalizeProductPayload(args, existing = null) {
  const name = requireProductName(args.name ?? existing?.name);
  const variantsInput = productVariantRowsInput(args);
  const existingVariantMode = existing?.variant_mode === 'same_price' ? 'different_price' : existing?.variant_mode;
  const variantMode = normalizeVariantMode(args.variant_mode ?? (variantsInput.length > 0 ? 'different_price' : existingVariantMode) ?? 'none');
  const payload = {
    site_category_id: requireInteger(args.site_category_id ?? existing?.site_category_id, 'site_category_id'),
    variant_mode: variantMode,
    replace_image_by_variant: Boolean(args.replace_image_by_variant ?? existing?.replace_image_by_variant ?? false),
    sku: normalizeProductSku(args.sku ?? existing?.sku ?? ''),
    name,
    summary: nullableString(args.summary ?? existing?.summary),
    description: nullableString(args.description ?? existing?.description),
    base_price: requireNonNegativeAmount(args.base_price ?? existing?.base_price, 'base_price'),
    sale_price: args.sale_price === undefined && existing ? nullableNumber(existing.sale_price) : nullableNonNegativeAmount(args.sale_price, 'sale_price'),
    sale_ends_at: normalizeOptionalDate(args.sale_ends_at ?? existing?.sale_ends_at, 'sale_ends_at'),
    cost_price: requireNonNegativeAmount(args.cost_price ?? existing?.cost_price ?? 0, 'cost_price'),
    stock: requireNonNegativeAmount(args.stock ?? existing?.stock ?? 0, 'stock'),
    buy_limit: nullableNonNegativeAmount(args.buy_limit ?? existing?.buy_limit, 'buy_limit'),
    gift_coupon_template_id: normalizeNullableInteger(args.gift_coupon_template_id ?? existing?.gift_coupon_template_id, 'gift_coupon_template_id'),
    status: normalizeProductStatus(args.status ?? existing?.status ?? 'active'),
    is_service: Boolean(args.is_service ?? existing?.is_service ?? false),
    primary_images: normalizeProductImageInputs(args.primary_images),
    primary_images_mode: normalizeProductImagesMode(args.primary_images_mode, existing),
    content_images: normalizeProductImageInputs(args.content_images),
    content_images_mode: normalizeProductImagesMode(args.content_images_mode, existing),
    videos: normalizeStringArray(args.videos),
    variants: variantsInput,
    quantity_discounts: Array.isArray(args.quantity_discounts) ? args.quantity_discounts : []
  };

  if (!payload.sku) {
    payload.sku = `MCP-${Date.now()}`;
  }

  if (payload.sale_price !== null && payload.sale_price > payload.base_price) {
    throw codedError('VALIDATION_FAILED', 'sale_price cannot be greater than base_price.');
  }

  return payload;
}

function normalizeProductImagesMode(value, existing = null) {
  if (value === undefined || value === null || value === '') {
    return existing ? 'append' : 'replace';
  }

  const mode = String(value).trim();
  if (!['append', 'replace'].includes(mode)) {
    throw codedError('VALIDATION_FAILED', 'image mode must be append or replace.');
  }

  return mode;
}

function requireProductName(value) {
  const name = String(value ?? '').trim();

  if (name.length < 1 || name.length > 255) {
    throw codedError('VALIDATION_FAILED', 'Product name is required and must be 255 characters or fewer.');
  }

  return name;
}

function normalizeProductSku(value) {
  const sku = String(value ?? '').trim();

  if (sku.length > 64) {
    throw codedError('VALIDATION_FAILED', 'sku must be 64 characters or fewer.');
  }

  return sku;
}

function normalizeVariantMode(value) {
  const mode = String(value ?? 'none').trim();

  if (!['none', 'different_price'].includes(mode)) {
    throw codedError('VALIDATION_FAILED', 'variant_mode must be none or different_price.');
  }

  return mode;
}

function productVariantRowsInput(args) {
  if (Array.isArray(args.variants)) {
    return args.variants;
  }

  if (Array.isArray(args.different_price_variants)) {
    return args.different_price_variants;
  }

  return [];
}

function normalizeProductStatus(value) {
  const status = String(value ?? 'active').trim();

  if (!['active', 'hidden', 'sold_out'].includes(status)) {
    throw codedError('VALIDATION_FAILED', 'status must be active, hidden, or sold_out.');
  }

  return status;
}

function nullableNonNegativeAmount(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  return requireNonNegativeAmount(value, name);
}

function nullableNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  return Number.parseInt(value, 10);
}

function normalizeOptionalDate(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  return requireDateString(value, name);
}

function normalizeProductImageInputs(value) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw codedError('VALIDATION_FAILED', 'Product images must be an array.');
  }

  return value.filter((item) => {
    if (item === null || item === undefined) {
      return false;
    }

    if (typeof item === 'string') {
      return item.trim() !== '';
    }

    return typeof item === 'object';
  });
}

function normalizeYoutubeUrl(url) {
  const text = String(url ?? '').trim();
  if (text === '') {
    throw codedError('VALIDATION_FAILED', 'Missing YouTube URL.');
  }

  const match = text.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (!match) {
    throw codedError('VALIDATION_FAILED', 'Only YouTube URLs are supported.');
  }

  return `https://www.youtube.com/watch?v=${match[1]}`;
}

function normalizeDifferentPriceVariants(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((row) => ({
      name: String(row?.name ?? '').trim(),
      price: requireNonNegativeAmount(row?.base_price ?? row?.price, 'variants.base_price'),
      sale_price: nullableNonNegativeAmount(row?.sale_price, 'variants.sale_price'),
      stock: requireNonNegativeAmount(row?.stock ?? 0, 'variants.stock')
    }))
    .filter((row) => row.name !== '');
}

function normalizeQuantityDiscounts(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((row) => ({
      quantity: requirePositiveAmount(row?.quantity, 'quantity_discounts.quantity'),
      discount_percent: requirePositiveAmount(row?.discount_percent, 'quantity_discounts.discount_percent')
    }))
    .filter((row) => row.quantity > 0 && row.discount_percent > 0)
    .sort((a, b) => a.quantity - b.quantity);
}

function formatProductSummary(product) {
  return {
    id: product.id,
    site_id: product.site_id,
    site_category_id: product.site_category_id,
    category_name: product.category_name ?? null,
    sku: product.sku,
    name: product.name,
    summary: product.summary ?? '',
    base_price: Number.parseInt(product.base_price ?? '0', 10),
    sale_price: product.sale_price === null || product.sale_price === undefined ? null : Number.parseInt(product.sale_price, 10),
    stock: Number.parseInt(product.stock ?? '0', 10),
    status: product.status,
    sales_volume: Number.parseInt(product.sales_volume ?? '0', 10),
    created_at: product.created_at ?? null,
    updated_at: product.updated_at ?? null
  };
}

function formatEmailProduct(product, publicSiteBaseUrl, siteSlug) {
  const price = product.sale_price === null || product.sale_price === undefined
    ? Number.parseInt(product.base_price ?? '0', 10)
    : Number.parseInt(product.sale_price, 10);
  const slug = encodeURIComponent(siteSlug ?? `site-${product.site_id}`);
  const productUrl = `${publicSiteBaseUrl}/sites/${slug}/default-preview/products/${product.id}`;
  const aiUrl = `${publicSiteBaseUrl}/sites/${slug}/default-preview/products/${product.id}/ai`;

  return {
    ...formatProductSummary(product),
    price,
    primary_image_url: product.primary_image_path ? mediaUrlFor(publicSiteBaseUrl, product.primary_image_path) : null,
    product_url: productUrl,
    ai_url: aiUrl
  };
}

function formatProduct(product, images, videos, variants, quantityDiscounts, publicSiteBaseUrl) {
  return {
    ...formatProductSummary(product),
    slug: product.slug,
    variant_mode: product.variant_mode || 'none',
    replace_image_by_variant: Boolean(product.replace_image_by_variant),
    description: product.description ?? '',
    sale_ends_at: product.sale_ends_at ? String(product.sale_ends_at).slice(0, 10) : null,
    cost_price: Number.parseInt(product.cost_price ?? '0', 10),
    buy_limit: product.buy_limit === null || product.buy_limit === undefined ? null : Number.parseInt(product.buy_limit, 10),
    gift_coupon_template_id: product.gift_coupon_template_id ?? null,
    is_service: Boolean(product.is_service),
    primary_images: images.filter((image) => image.image_type === 'primary').map((image) => formatProductImage(image, publicSiteBaseUrl)),
    content_images: images.filter((image) => image.image_type === 'content').map((image) => formatProductImage(image, publicSiteBaseUrl)),
    videos: videos.map((video) => ({ id: video.id, url: video.url, sort_order: Number.parseInt(video.sort_order ?? '0', 10) })),
    variants: variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      price: Number.parseInt(variant.price ?? '0', 10),
      sale_price: variant.sale_price === null || variant.sale_price === undefined ? null : Number.parseInt(variant.sale_price, 10),
      stock: Number.parseInt(variant.stock ?? '0', 10),
      sort_order: Number.parseInt(variant.sort_order ?? '0', 10),
      is_default: Boolean(variant.is_default)
    })),
    quantity_discounts: quantityDiscounts.map((discount) => ({
      id: discount.id,
      quantity: Number.parseInt(discount.quantity ?? '0', 10),
      discount_percent: Number.parseInt(discount.discount_percent ?? '0', 10),
      sort_order: Number.parseInt(discount.sort_order ?? '0', 10)
    }))
  };
}

function formatProductImage(image, publicSiteBaseUrl) {
  return {
    id: image.id,
    type: image.image_type,
    path: image.path,
    url: looksLikeUrl(image.path) ? image.path : mediaUrlFor(publicSiteBaseUrl, image.path),
    sort_order: Number.parseInt(image.sort_order ?? '0', 10),
    alt_text: image.alt_text ?? ''
  };
}

async function parseProductImportSource(source) {
  if (!source || typeof source !== 'object') {
    throw codedError('VALIDATION_FAILED', 'source is required.');
  }

  const originalName = nullableString(source.filename) ?? nullableString(source.original_name) ?? filenameFromUrl(source.file_url || source.image_url) ?? 'products.csv';
  const extension = path.extname(originalName).replace('.', '').toLowerCase();
  let bytes;

  if (typeof source.data_base64 === 'string' && source.data_base64.trim() !== '') {
    bytes = Buffer.from(source.data_base64, 'base64');
  } else {
    const url = source.file_url || source.image_url;
    if (typeof url !== 'string' || url.trim() === '') {
      throw codedError('VALIDATION_FAILED', 'source.data_base64 or source.file_url is required.');
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw codedError('VALIDATION_FAILED', `Unable to download import source: HTTP ${response.status}`);
    }

    bytes = Buffer.from(await response.arrayBuffer());
  }

  if (bytes.length > MAX_ASSET_BYTES * 3) {
    throw codedError('VALIDATION_FAILED', 'Import source is too large.');
  }

  if (extension === 'csv') {
    return parseCsvDataset(bytes.toString('utf8'), originalName);
  }

  if (extension === 'xlsx') {
    return parseXlsxDataset(bytes, originalName);
  }

  if (extension === 'sql') {
    return parseSqlDataset(bytes.toString('utf8'), originalName);
  }

  throw codedError('VALIDATION_FAILED', 'Unsupported import source type. Please provide CSV, XLSX, or SQL.');
}

function parseCsvDataset(content, sourceName) {
  const rows = parseCsvRows(content);
  const headers = rows.shift()?.map((value) => String(value ?? '').trim()) ?? [];
  const objects = rows
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? '').trim()]).filter(([header]) => header !== '')))
    .filter((row) => Object.values(row).some((value) => String(value).trim() !== ''));

  return buildImportDataset('csv', sourceName, headers, objects);
}

function parseCsvRows(content) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  if (value !== '' || row.length > 0) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }

  return rows;
}

async function parseXlsxDataset(bytes, sourceName) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    throw codedError('VALIDATION_FAILED', 'Unable to find first worksheet in XLSX file.');
  }

  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    headers[columnNumber - 1] = String(cell.value ?? '').trim();
  });
  const rows = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    const item = {};
    for (let index = 0; index < headers.length; index += 1) {
      const header = headers[index];
      if (!header) {
        continue;
      }

      item[header] = cellText(row.getCell(index + 1).value);
    }

    if (Object.values(item).some((value) => String(value).trim() !== '')) {
      rows.push(item);
    }
  });

  return buildImportDataset('xlsx', sourceName, headers, rows);
}

function cellText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'object') {
    if ('text' in value) {
      return String(value.text ?? '').trim();
    }
    if ('result' in value) {
      return String(value.result ?? '').trim();
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? '').join('').trim();
    }
  }

  return String(value).trim();
}

function parseSqlDataset(content, sourceName) {
  const tables = [];
  const statementPattern = /INSERT\s+INTO\s+[`"]?([a-zA-Z0-9_]+)[`"]?\s*\((.*?)\)\s*VALUES\s*([\s\S]*?);/gi;
  let match;

  while ((match = statementPattern.exec(content)) !== null) {
    const columns = match[2].split(',').map((column) => column.replaceAll(/[`"]/g, '').trim());
    const rows = extractSqlTuples(match[3])
      .map(parseSqlTuple)
      .filter((values) => values.length === columns.length)
      .map((values) => Object.fromEntries(columns.map((column, index) => [column, values[index]])));

    if (rows.length > 0) {
      tables.push({ table: match[1], columns, rows });
    }
  }

  const best = tables
    .map((table) => ({ ...table, score: scoreProductLikeTable(table.table, table.columns, table.rows) }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best) {
    throw codedError('VALIDATION_FAILED', 'No importable INSERT rows found in SQL file.');
  }

  return {
    ...buildImportDataset('sql', sourceName, best.columns, best.rows),
    sourceTable: best.table
  };
}

function extractSqlTuples(valuesSql) {
  const tuples = [];
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let start = -1;

  for (let index = 0; index < valuesSql.length; index += 1) {
    const char = valuesSql[index];

    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === "'") {
        quoted = false;
      }
      continue;
    }

    if (char === "'") {
      quoted = true;
    } else if (char === '(') {
      if (depth === 0) {
        start = index + 1;
      }
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        tuples.push(valuesSql.slice(start, index));
      }
    }
  }

  return tuples;
}

function parseSqlTuple(tuple) {
  const values = [];
  let value = '';
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < tuple.length; index += 1) {
    const char = tuple[index];

    if (quoted) {
      if (escaped) {
        value += char;
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === "'") {
        if (tuple[index + 1] === "'") {
          value += "'";
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        value += char;
      }
    } else if (char === "'") {
      quoted = true;
    } else if (char === ',') {
      values.push(normalizeSqlValue(value));
      value = '';
    } else {
      value += char;
    }
  }

  values.push(normalizeSqlValue(value));

  return values;
}

function normalizeSqlValue(value) {
  const trimmed = String(value ?? '').trim();
  return /^null$/i.test(trimmed) ? '' : trimmed;
}

function scoreProductLikeTable(tableName, columns, rows) {
  const normalizedColumns = columns.map((column) => String(column).toLowerCase());
  let score = rows.length;

  for (const column of ['pname', 'name', 'title']) {
    if (normalizedColumns.includes(column)) {
      score += 500;
    }
  }

  for (const column of ['price', 'sprice', 'stock', 'images', 'info_images', 'pnum', 'sku']) {
    if (normalizedColumns.includes(column)) {
      score += 180;
    }
  }

  if (/product|goods|item/i.test(tableName)) {
    score += 300;
  }

  if (/visitor|log|analytics/i.test(tableName)) {
    score -= 600;
  }

  return score;
}

function buildImportDataset(sourceType, sourceName, headers, rows) {
  const normalizedHeaders = Array.from(new Set(headers.map((header) => String(header ?? '').trim()).filter((header) => header !== '')));
  const totalRows = rows.length;
  const columns = {};

  for (const header of normalizedHeaders) {
    const values = rows.map((row) => String(row[header] ?? '').trim());
    const nonEmpty = values.filter((value) => value !== '');
    columns[header] = {
      null_ratio: totalRows > 0 ? Number((((totalRows - nonEmpty.length) / totalRows) * 100).toFixed(2)) : 0,
      samples: Array.from(new Set(nonEmpty)).slice(0, 5),
      type_guess: guessImportColumnType(nonEmpty)
    };
  }

  return {
    sourceType,
    sourceName,
    headers: normalizedHeaders,
    columns,
    totalRows,
    sampleRows: rows.slice(0, 20),
    rows
  };
}

function guessImportColumnType(values) {
  if (values.length === 0) {
    return 'empty';
  }

  if (values.every((value) => isNumericValue(value))) {
    return 'number';
  }

  if (values.some((value) => looksLikeUrl(value))) {
    return 'url';
  }

  return 'text';
}

function productImportDatasetSummary(dataset) {
  return {
    source_type: dataset.sourceType,
    source_name: dataset.sourceName,
    source_table: dataset.sourceTable ?? null,
    total_rows: dataset.totalRows,
    columns: dataset.columns,
    sample_rows: dataset.sampleRows
  };
}

function productImportTargetSchema() {
  return {
    field_mapping: ['name', 'sku', 'summary', 'description', 'base_price', 'sale_price', 'stock', 'youtube_url'],
    image_mapping: ['primary_images', 'content_images'],
    required_fields: ['name', 'base_price']
  };
}

function productImportAiMappingPrompt(dataset, categories) {
  const expectedJsonShape = {
    field_mapping: {
      name: 'source_column_or_null',
      sku: 'source_column_or_null',
      summary: 'source_column_or_null',
      description: 'source_column_or_null',
      base_price: 'source_column_or_null',
      sale_price: 'source_column_or_null',
      stock: 'source_column_or_null',
      youtube_url: 'source_column_or_null'
    },
    category_mapping: {
      mode: 'none|single|parent_child|path',
      columns: ['column1', 'column2']
    },
    image_mapping: {
      primary_images: 'source_column_or_null',
      content_images: 'source_column_or_null'
    },
    warnings: [],
    confidence: 0.0
  };

  return {
    system: [
      'Return JSON only. Do not wrap in markdown.',
      'Decide how the source columns map into the target product schema.',
      'Use the exact JSON shape in expected_json_shape.',
      'Use null when a source column cannot be identified.',
      'Do not invent source column names that are not present in source_columns.'
    ].join('\n'),
    expected_json_shape: expectedJsonShape,
    payload: {
      source_type: dataset.sourceType,
      source_name: dataset.sourceName,
      source_table: dataset.sourceTable ?? null,
      columns: dataset.columns,
      sample_rows: dataset.sampleRows,
      target_schema: {
        products: ['name', 'sku', 'slug', 'summary', 'description', 'base_price', 'sale_price', 'stock', 'youtube_url', 'site_category_id'],
        product_images: ['primary', 'content']
      },
      available_categories: categories.map((category) => category.path || category.name),
      import_policy: productImportPolicyText()
    },
    source_columns: dataset.headers,
    import_policy: productImportPolicyText()
  };
}

function productImportPolicyText() {
  return 'Ignore any source id column. All imported products must use the current site_id and auto-increment ids from the target database. During conversion, product names will be matched against the current site leaf category names; only unmatched products will be assigned to the site root category named 轉入商品, so category mismatches should be treated as warnings instead of blocking validation.';
}

function productImportGuidance() {
  return {
    ai_client_responsibility: 'Ask the user for a CSV, XLSX, or SQL export; inspect it; create mapping in the client; validate; then commit only after user confirmation.',
    backend_ai_analysis: false,
    failure_behavior: 'If validation.convertible is false, explain validation.fatal_reasons and row_errors to the user instead of committing.'
  };
}

function normalizeProductImportMapping(mapping) {
  if (!mapping || typeof mapping !== 'object') {
    throw codedError('VALIDATION_FAILED', 'mapping is required.');
  }

  return {
    field_mapping: mapping.field_mapping && typeof mapping.field_mapping === 'object'
      ? { ...mapping.field_mapping }
      : {},
    category_mapping: mapping.category_mapping && typeof mapping.category_mapping === 'object'
      ? { ...mapping.category_mapping }
      : { mode: 'none', columns: [] },
    image_mapping: mapping.image_mapping && typeof mapping.image_mapping === 'object'
      ? { ...mapping.image_mapping }
      : {},
    warnings: Array.isArray(mapping.warnings) ? mapping.warnings.map(String) : [],
    confidence: Number.isFinite(Number(mapping.confidence)) ? Number(mapping.confidence) : null
  };
}

function validateProductImportDataset(dataset, mapping) {
  const rows = dataset.rows;
  const fatalReasons = [];
  const rowErrors = [];
  let failedRows = 0;
  const nameColumn = mapping.field_mapping.name;
  const priceColumn = mapping.field_mapping.base_price;

  if (!validMappedColumn(dataset, nameColumn)) {
    fatalReasons.push('Unable to identify a product name column.');
  }

  if (!validMappedColumn(dataset, priceColumn)) {
    fatalReasons.push('Unable to identify product pricing.');
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const issues = [];
    const name = rowValue(row, nameColumn);
    const basePrice = rowValue(row, priceColumn);

    if (name === '') {
      issues.push('Missing product name.');
    }

    if (basePrice === '') {
      issues.push('Missing base price.');
    } else if (!isNumericValue(basePrice)) {
      issues.push('Base price is not numeric.');
    }

    issues.push(...validateImagesForImportRow(row, mapping.image_mapping));

    if (issues.length > 0) {
      failedRows += 1;
      if (rowErrors.length < 20) {
        rowErrors.push({ row: index + 2, issues });
      }
    }
  }

  const errorRate = rows.length > 0 ? Number(((failedRows / rows.length) * 100).toFixed(2)) : 100;

  return {
    total_rows: rows.length,
    failed_rows: failedRows,
    passed_rows: Math.max(0, rows.length - failedRows),
    error_rate: errorRate,
    convertible: fatalReasons.length === 0 && errorRate <= 15,
    fatal_reasons: fatalReasons,
    row_errors: rowErrors
  };
}

function productImportFailureReasons(validation) {
  if (validation.convertible) {
    return [];
  }

  return [
    ...validation.fatal_reasons,
    ...validation.row_errors.slice(0, 5).map((error) => `Row ${error.row}: ${error.issues.join(', ')}`)
  ];
}

function prepareProductImportRows(dataset, mapping, siteId, importCategoryId, categoryAssignments, usedSkus, usedSlugs) {
  return dataset.rows.map((row, index) => {
    const productName = rowValue(row, mapping.field_mapping.name) || 'Imported Product';
    const matchedCategoryId = matchImportCategoryId(productName, categoryAssignments, importCategoryId);

    return {
      site_id: siteId,
      site_category_id: matchedCategoryId,
      sku: resolveProductImportSku(row, mapping, siteId, index, usedSkus),
      name: productName,
      slug: resolveProductImportSlug(row, mapping, siteId, index, usedSlugs),
      summary: nullableRowValue(row, mapping.field_mapping.summary),
      description: nullableRowValue(row, mapping.field_mapping.description),
      base_price: numericRowValue(row, mapping.field_mapping.base_price),
      sale_price: nullableNumericRowValue(row, mapping.field_mapping.sale_price),
      cost_price: 0,
      stock: signedNumericRowValue(row, mapping.field_mapping.stock),
      status: 'active',
      youtube_url: nullableRowValue(row, mapping.field_mapping.youtube_url),
      _source_row: row
    };
  });
}

function matchImportCategoryId(productName, assignments, fallbackCategoryId) {
  const needle = productName.trim().toLowerCase();
  const matched = assignments.find((assignment) => needle.includes(assignment.name.toLowerCase()));

  return matched ? matched.id : fallbackCategoryId;
}

function resolveProductImportSku(row, mapping, siteId, index, usedSkus) {
  const candidate = rowValue(row, mapping.field_mapping.sku) || `IMP-${siteId}-${index + 1}`;
  return uniqueValue(candidate.replace(/\s+/g, '-').slice(0, 64), usedSkus, 64);
}

function resolveProductImportSlug(row, mapping, siteId, index, usedSlugs) {
  const source = rowValue(row, mapping.field_mapping.slug) || rowValue(row, mapping.field_mapping.name) || `imported-product-${index + 1}`;
  const slug = slugify(source) || `imported-product-${siteId}-${index + 1}`;

  return uniqueValue(slug, usedSlugs, 255);
}

function uniqueValue(value, usedValues, maxLength) {
  const base = String(value || 'imported').slice(0, maxLength);
  let candidate = base;
  let suffix = 2;

  while (usedValues.has(candidate)) {
    const suffixText = `-${suffix}`;
    candidate = `${base.slice(0, Math.max(1, maxLength - suffixText.length))}${suffixText}`;
    suffix += 1;
  }

  usedValues.add(candidate);
  return candidate;
}

function buildProductImageRows(productId, productName, row, mapping) {
  const imageRows = [];

  for (const [mappingKey, imageType] of [['primary_images', 'primary'], ['content_images', 'content']]) {
    const raw = rowValue(row, mapping.image_mapping[mappingKey]);
    if (!raw) {
      continue;
    }

    const paths = raw.split(/\s*(?:\||,|\n)\s*/u).map((value) => value.trim()).filter(Boolean);
    for (let index = 0; index < paths.length; index += 1) {
      imageRows.push({
        product_id: productId,
        image_type: imageType,
        path: paths[index],
        sort_order: index,
        alt_text: productName.slice(0, 500)
      });
    }
  }

  return imageRows;
}

function validateImagesForImportRow(row, imageMapping) {
  const issues = [];

  for (const key of ['primary_images', 'content_images']) {
    const raw = rowValue(row, imageMapping?.[key]);
    if (!raw) {
      continue;
    }

    const values = raw.split(/\s*(?:\||,|\n)\s*/u).map((value) => value.trim()).filter(Boolean);
    for (const value of values) {
      if (!looksLikeUrl(value) && !value.startsWith('sites/')) {
        issues.push(`${key} contains a non-URL image path.`);
        break;
      }
    }
  }

  return issues;
}

function validMappedColumn(dataset, column) {
  return typeof column === 'string' && column !== '' && dataset.headers.includes(column);
}

function rowValue(row, column) {
  return typeof column === 'string' && column !== '' ? String(row[column] ?? '').trim() : '';
}

function nullableRowValue(row, column) {
  const value = rowValue(row, column);
  return value === '' ? null : value;
}

function numericRowValue(row, column) {
  return Math.max(0, Math.round(Number(rowValue(row, column).replaceAll(',', '')) || 0));
}

function nullableNumericRowValue(row, column) {
  const value = rowValue(row, column);
  return value === '' ? null : numericRowValue(row, column);
}

function signedNumericRowValue(row, column) {
  return Math.round(Number(rowValue(row, column).replaceAll(',', '')) || 0);
}

function isNumericValue(value) {
  return /^-?\d+(?:,\d{3})*(?:\.\d+)?$|^-?\d+(?:\.\d+)?$/.test(String(value ?? '').trim());
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(String(value ?? '').trim());
}

function slugify(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/giu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 255);
}

function filenameFromUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  try {
    return path.basename(new URL(value).pathname) || null;
  } catch {
    return path.basename(value);
  }
}

function categoryPathLabel(category, rows) {
  const names = [category.name];
  let parentId = category.parent_id;

  while (parentId) {
    const parent = rows.find((row) => row.id === parentId);
    if (!parent) {
      break;
    }
    names.unshift(parent.name);
    parentId = parent.parent_id;
  }

  return names.filter(Boolean).join(' > ');
}

function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function normalizeCouponTemplate(args, existing = null) {
  const issueTrigger = normalizeCouponIssueTrigger(args.issue_trigger ?? existing?.issue_trigger);
  const name = requireCouponName(args.name ?? existing?.name);
  const discountAmount = requirePositiveAmount(args.discount_amount ?? existing?.discount_amount, 'discount_amount');
  const minimumSpend = issueTrigger === 'product_bundle'
    ? 0
    : requireNonNegativeAmount(args.minimum_spend ?? existing?.minimum_spend ?? 0, 'minimum_spend');
  const triggerAmount = issueTrigger === 'order_threshold'
    ? requirePositiveAmount(args.trigger_amount ?? existing?.trigger_amount, 'trigger_amount')
    : 0;
  const startsAt = issueTrigger === 'birthday'
    ? null
    : requireDateString(args.starts_at ?? existing?.starts_at, 'starts_at');
  const endsAt = issueTrigger === 'birthday'
    ? null
    : requireDateString(args.ends_at ?? existing?.ends_at, 'ends_at');

  if (startsAt && startsAt < todayDateString()) {
    throw codedError('VALIDATION_FAILED', 'starts_at must be today or a future date.');
  }

  if (startsAt && endsAt && endsAt < startsAt) {
    throw codedError('VALIDATION_FAILED', 'ends_at must be the same as or later than starts_at.');
  }

  return {
    name,
    discount_amount: discountAmount,
    minimum_spend: minimumSpend,
    issue_trigger: issueTrigger,
    trigger_amount: triggerAmount,
    starts_at: startsAt,
    ends_at: endsAt
  };
}

function requireCouponName(value) {
  const name = String(value ?? '').trim();

  if (name.length < 1 || name.length > 255) {
    throw codedError('VALIDATION_FAILED', 'name must be between 1 and 255 characters.');
  }

  return name;
}

function normalizeCouponIssueTrigger(value) {
  const issueTrigger = String(value ?? '').trim();
  const allowed = ['manual', 'all_members', 'order_threshold', 'birthday', 'product_bundle'];

  if (!allowed.includes(issueTrigger)) {
    throw codedError('VALIDATION_FAILED', 'issue_trigger is required and must be manual, all_members, order_threshold, birthday, or product_bundle. If the user did not specify the coupon type, ask them to choose before calling this tool.', {
      choices: couponIssueTriggerChoices()
    });
  }

  return issueTrigger;
}

function requirePositiveAmount(value, name) {
  const amount = Number.parseInt(value, 10);

  if (!Number.isInteger(amount) || amount <= 0 || String(value ?? '').trim() === '') {
    throw codedError('VALIDATION_FAILED', `${name} must be a positive integer.`);
  }

  return amount;
}

function requireNonNegativeAmount(value, name) {
  const amount = Number.parseInt(value, 10);

  if (!Number.isInteger(amount) || amount < 0 || String(value ?? '').trim() === '') {
    throw codedError('VALIDATION_FAILED', `${name} must be a non-negative integer.`);
  }

  return amount;
}

function requireDateString(value, name) {
  const text = value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value ?? '').trim().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw codedError('VALIDATION_FAILED', `${name} is required for non-birthday coupons and must use YYYY-MM-DD.`);
  }

  return text;
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function couponDateRangeIsActive(couponTemplate) {
  const today = todayDateString();
  const startsAt = couponTemplate.starts_at ? String(couponTemplate.starts_at).slice(0, 10) : null;
  const endsAt = couponTemplate.ends_at ? String(couponTemplate.ends_at).slice(0, 10) : null;

  return (!startsAt || startsAt <= today) && (!endsAt || endsAt >= today);
}

function couponIssueTriggerChoices() {
  return [
    { value: 'manual', label: '手動發放', requires: ['member_id', 'starts_at', 'ends_at'] },
    { value: 'all_members', label: '發給所有會員', requires: ['starts_at', 'ends_at'] },
    { value: 'order_threshold', label: '消費滿額自動送', requires: ['trigger_amount', 'starts_at', 'ends_at'] },
    { value: 'birthday', label: '生日禮券', requires: [] },
    { value: 'product_bundle', label: '商品搭配', requires: ['starts_at', 'ends_at', 'product assignment'] }
  ];
}

function couponToolGuidance() {
  return {
    ask_before_calling_when_missing: [
      'coupon type / issue_trigger',
      'manual target member versus all members',
      'starts_at and ends_at for every non-birthday coupon',
      'trigger_amount for order_threshold coupons',
      'product assignment for product_bundle coupons'
    ],
    issue_trigger_choices: couponIssueTriggerChoices(),
    same_admin_rules: true
  };
}

function normalizeContentImages(value) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw codedError('VALIDATION_FAILED', 'content_images must be an array.');
  }

  return value.map((image) => {
    if (!image || typeof image !== 'object') {
      throw codedError('VALIDATION_FAILED', 'content_images entries must be objects.');
    }

    return {
      source: image.source,
      suggested_filename: nullableString(image.suggested_filename),
      alt_text: nullableString(image.alt_text)
    };
  });
}

function formatArticle(article, site, publicSiteBaseUrl, includeContent) {
  return {
    id: article.id,
    site_id: article.site_id,
    notion_page_id: article.notion_page_id ?? null,
    title: article.title || 'Untitled',
    ...(includeContent ? { content: article.content ?? '' } : {}),
    cover_path: article.cover_path ?? null,
    cover_url: article.cover_path ? mediaUrlFor(publicSiteBaseUrl, article.cover_path) : null,
    article_url: `${publicSiteBaseUrl}/sites/${encodeURIComponent(site.slug)}/articles/${article.id}`,
    created_at: article.created_at ?? null,
    updated_at: article.updated_at ?? null
  };
}

function formatCouponTemplate(couponTemplate) {
  const endsAt = couponTemplate.ends_at ? String(couponTemplate.ends_at).slice(0, 10) : null;

  return {
    id: couponTemplate.id,
    site_id: couponTemplate.site_id,
    name: couponTemplate.name,
    discount_amount: Number.parseInt(couponTemplate.discount_amount ?? '0', 10),
    minimum_spend: Number.parseInt(couponTemplate.minimum_spend ?? '0', 10),
    issue_trigger: couponTemplate.issue_trigger || 'manual',
    trigger_amount: Number.parseInt(couponTemplate.trigger_amount ?? '0', 10),
    starts_at: couponTemplate.starts_at ? String(couponTemplate.starts_at).slice(0, 10) : null,
    ends_at: endsAt,
    is_expired: Boolean(endsAt && endsAt < todayDateString()),
    created_at: couponTemplate.created_at ?? null,
    updated_at: couponTemplate.updated_at ?? null
  };
}

function formatMemberSummary(member) {
  return {
    id: member.id,
    site_id: member.site_id,
    email: member.email ?? null,
    name: member.name ?? null,
    status: member.status ?? null
  };
}

function formatMemberDetail(member) {
  return {
    ...formatMemberSummary(member),
    birthday: member.birthday ? String(member.birthday).slice(0, 10) : null,
    gender: member.gender ?? null,
    mobile: member.mobile ?? null,
    country: member.country ?? null,
    zip: member.zip ?? null,
    address: member.address ?? null,
    total_spent_amount: Number.parseInt(member.total_spent_amount ?? '0', 10),
    last_login_at: dateString(member.last_login_at),
    created_at: dateString(member.created_at),
    updated_at: dateString(member.updated_at)
  };
}

function formatDiscountCode(discountCode) {
  return {
    id: discountCode.id,
    site_id: discountCode.site_id,
    code: discountCode.code,
    discount_percent: Number.parseFloat(discountCode.discount_percent ?? '0'),
    platform: discountCode.platform ?? null,
    order_count: discountCode.order_count === null || discountCode.order_count === undefined ? null : Number.parseInt(discountCode.order_count, 10),
    order_total_amount: discountCode.order_total_amount === null || discountCode.order_total_amount === undefined ? null : Number.parseInt(discountCode.order_total_amount, 10),
    created_at: dateString(discountCode.created_at),
    updated_at: dateString(discountCode.updated_at)
  };
}

function formatMemberTier(memberTier) {
  return {
    id: memberTier.id,
    site_id: memberTier.site_id,
    name: memberTier.name,
    min_spend: Number.parseInt(memberTier.min_spend ?? '0', 10),
    discount_percent: Number.parseFloat(memberTier.discount_percent ?? '1'),
    created_at: dateString(memberTier.created_at),
    updated_at: dateString(memberTier.updated_at)
  };
}

function formatThresholdGift(thresholdGift) {
  return {
    id: thresholdGift.id,
    site_id: thresholdGift.site_id,
    name: thresholdGift.product_name ?? null,
    threshold_amount: Number.parseInt(thresholdGift.threshold_amount ?? '0', 10),
    product_id: thresholdGift.product_id,
    product_name: thresholdGift.product_name ?? null,
    sort_order: Number.parseInt(thresholdGift.sort_order ?? '0', 10),
    is_active: Boolean(thresholdGift.is_active),
    created_at: dateString(thresholdGift.created_at),
    updated_at: dateString(thresholdGift.updated_at)
  };
}

function formatProductAddOn(productAddOn) {
  return {
    id: productAddOn.id,
    site_id: productAddOn.site_id,
    name: productAddOn.add_on_product_name ?? null,
    product_id: productAddOn.product_id,
    product_name: productAddOn.product_name ?? null,
    add_on_product_id: productAddOn.add_on_product_id,
    add_on_product_name: productAddOn.add_on_product_name ?? null,
    add_on_price: Number.parseInt(productAddOn.add_on_price ?? '0', 10),
    max_quantity: Number.parseInt(productAddOn.max_quantity ?? '1', 10),
    sort_order: Number.parseInt(productAddOn.sort_order ?? '0', 10),
    is_active: Boolean(productAddOn.is_active),
    created_at: dateString(productAddOn.created_at),
    updated_at: dateString(productAddOn.updated_at)
  };
}

function formatCustomerServiceLog(log) {
  return {
    id: log.id,
    site_id: log.site_id,
    member_id: log.member_id ?? null,
    member_name: log.member_name ?? null,
    member_email: log.member_email ?? null,
    session_key: log.session_key ?? '',
    ip_address: log.ip_address ?? null,
    visitor_name: log.visitor_name ?? null,
    messages: Array.isArray(log.messages) ? log.messages : parseJsonObject(log.messages),
    created_at: dateString(log.created_at),
    updated_at: dateString(log.updated_at)
  };
}

function formatCustomerServiceSettings(settings) {
  return {
    use_ai_customer_service: Boolean(settings.use_ai_customer_service),
    ai_customer_service_question_limit: Number.parseInt(settings.ai_customer_service_question_limit ?? '500', 10),
    ai_customer_service_retention_days: Number.parseInt(settings.ai_customer_service_retention_days ?? '30', 10),
    ai_customer_service_prompt: settings.ai_customer_service_prompt ?? null,
    ai_customer_service_avatar_path: settings.ai_customer_service_avatar_path ?? null
  };
}

function formatMemberCoupon(memberCoupon) {
  return {
    id: memberCoupon.id,
    site_id: memberCoupon.site_id,
    member_id: memberCoupon.member_id,
    coupon_template_id: memberCoupon.coupon_template_id,
    status: memberCoupon.status,
    issued_reason: memberCoupon.issued_reason,
    issued_at: memberCoupon.issued_at ?? null,
    starts_at: memberCoupon.starts_at ? String(memberCoupon.starts_at).slice(0, 10) : null,
    expires_at: memberCoupon.expires_at ? String(memberCoupon.expires_at).slice(0, 10) : null,
    revoked_at: memberCoupon.revoked_at ?? null
  };
}

function requireRatio(value, name, allowOne = false) {
  const ratio = Number.parseFloat(value);
  const max = allowOne ? 1 : 0.999999;

  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > max) {
    throw codedError('VALIDATION_FAILED', `${name} must be greater than 0${allowOne ? ' and less than or equal to 1' : ' and less than 1'}.`);
  }

  return ratio;
}

function toCsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return '';
  }
  const headers = Object.keys(rows[0]);
  const escape = (value) => {
    const text = value === null || value === undefined
      ? ''
      : (typeof value === 'object' ? JSON.stringify(value) : String(value));
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };

  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))
  ].join('\n');
}

function mediaUrlFor(publicSiteBaseUrl, storagePath) {
  return `${publicSiteBaseUrl}/media/${storagePath.split('/').map(encodeURIComponent).join('/')}`;
}

function base64UrlEncode(value) {
  return Buffer.from(String(value), 'utf8').toString('base64url');
}

function timingSafeStringEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function normalizeEmailRecipientScope(value) {
  const scope = String(value ?? '').trim();
  if (!['members', 'all_members'].includes(scope)) {
    throw codedError('VALIDATION_FAILED', 'recipient_scope must be members or all_members.');
  }
  return scope;
}

function normalizeNewsletterRecipientScope(value) {
  const scope = String(value ?? '').trim();
  if (scope === 'all_members' || scope === 'all') {
    return 'all';
  }
  if (scope === 'members') {
    return 'members';
  }
  throw codedError('VALIDATION_FAILED', 'recipient_scope must be members or all_members.');
}

function normalizePosterProductNames(value) {
  if (!Array.isArray(value)) {
    throw codedError('VALIDATION_FAILED', 'product_names must be an array.');
  }

  const names = value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);

  if (names.length < 1) {
    throw codedError('VALIDATION_FAILED', 'product_names must include at least one product name.');
  }
  if (names.length > 5) {
    throw codedError('VALIDATION_FAILED', 'product_names accepts at most 5 products.');
  }

  return names;
}

function normalizePosterAspectRatio(value) {
  const ratio = String(value ?? '9:16').trim() || '9:16';
  if (!['16:9', '1:1', '9:16'].includes(ratio)) {
    throw codedError('VALIDATION_FAILED', 'aspect_ratio must be 16:9, 1:1, or 9:16.');
  }

  return ratio;
}

function escapeLikePattern(value) {
  return String(value).replace(/[\\%_]/g, (character) => `\\${character}`);
}

function normalizeNewsletterTitle(value) {
  const title = requireNonEmptyString(value, 'title');
  if (title.length > 255) {
    throw codedError('VALIDATION_FAILED', 'title must be at most 255 characters.');
  }
  return title;
}

function normalizeNewsletterScheduledAt(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return new Date(Date.now() + 5 * 60 * 1000).toISOString();
  }

  const scheduledAt = String(value).trim();
  const parsed = new Date(scheduledAt);
  if (Number.isNaN(parsed.getTime())) {
    throw codedError('VALIDATION_FAILED', 'scheduled_at must be a valid date or datetime.');
  }
  if (parsed.getTime() < Date.now()) {
    throw codedError('VALIDATION_FAILED', 'scheduled_at must be now or in the future.');
  }
  return scheduledAt;
}

function formatNewsletter(row) {
  return {
    id: row.id,
    site_id: row.site_id,
    title: row.title,
    recipient_scope: row.recipient_scope,
    html_content: row.html_content,
    status: row.status,
    scheduled_at: dateString(row.scheduled_at),
    sent_at: dateString(row.sent_at),
    created_at: dateString(row.created_at),
    updated_at: dateString(row.updated_at)
  };
}

function normalizeIntegerList(value, name) {
  if (value === undefined || value === null || value === '') {
    return [];
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return normalizeIntegerList(JSON.parse(trimmed), name);
      } catch {
        // Fall through to scalar parsing below.
      }
    }
  }

  if (!Array.isArray(value)) {
    return [requireIntegerFromModelValue(value, name)];
  }

  return [...new Set(value.flatMap((item) => normalizeIntegerListItem(item, name)))];
}

function normalizeIntegerListWithAlias(value, aliasValue, name, aliasName) {
  const hasValue = value !== undefined && value !== null && value !== '';
  const values = hasValue ? normalizeIntegerList(value, name) : [];

  if (values.length > 0 || aliasValue === undefined || aliasValue === null || aliasValue === '') {
    return values;
  }

  return normalizeIntegerList(aliasValue, aliasName);
}

function normalizeIntegerListItem(value, name) {
  if (Array.isArray(value)) {
    return normalizeIntegerList(value, name);
  }

  return [requireIntegerFromModelValue(value, name)];
}

function requireIntegerFromModelValue(value, name) {
  if (value && typeof value === 'object') {
    for (const key of ['id', 'member_id', 'product_id', 'value']) {
      if (value[key] !== undefined && value[key] !== null && value[key] !== '') {
        return requireInteger(value[key], name);
      }
    }
  }

  return requireInteger(value, name);
}

function normalizeEmailSubject(value) {
  const subject = requireNonEmptyString(value, 'subject');
  if (subject.length > 160) {
    throw codedError('VALIDATION_FAILED', 'subject must be at most 160 characters.');
  }
  return subject;
}

function normalizeEmailAddress(value) {
  const email = nullableString(value);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email.toLowerCase();
}

function sanitizeEmailHtml(value) {
  let html = requireNonEmptyString(value, 'html_content');
  if (html.length > 50000) {
    throw codedError('VALIDATION_FAILED', 'html_content must be at most 50000 characters.');
  }

  html = html
    .replace(/<\s*(script|iframe)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe)\b[^>]*\/?\s*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '')
    .trim();

  if (html === '') {
    throw codedError('VALIDATION_FAILED', 'html_content is empty after sanitization.');
  }

  return html;
}

function renderEmailLayout(layout, site, publicSiteBaseUrl, contentHtml) {
  const siteUrl = `${publicSiteBaseUrl}/sites/${encodeURIComponent(site.slug ?? `site-${site.id}`)}/default-preview`;
  const logoUrl = siteLogoUrlFor(site, publicSiteBaseUrl);
  const html = layout && !layout.uses_default_layout && layout.html
    ? layout.html
    : DEFAULT_MAIL_LAYOUT_HTML;
  const rendered = html
    .replaceAll('{content}', contentHtml)
    .replaceAll('{site_name}', escapeHtml(site.name ?? 'SlimWeb'))
    .replaceAll('{site_url}', siteUrl)
    .replaceAll('{logo_url}', logoUrl);

  return rendered.includes(contentHtml) ? rendered : `${rendered}${contentHtml}`;
}

function siteLogoUrlFor(site, publicSiteBaseUrl) {
  const iconPath = String(site?.icon_path ?? '').trim();

  if (looksLikeUrl(iconPath)) {
    return iconPath;
  }

  return mediaUrlFor(publicSiteBaseUrl, iconPath || 'images/logo.webp');
}

function renderEmailProductCards(products) {
  if (!Array.isArray(products) || products.length === 0) {
    return '';
  }

  return [
    '<section style="margin-top:24px;">',
    ...products.map((product) => {
      const image = product.primary_image_url
        ? `<img src="${escapeHtml(product.primary_image_url)}" alt="${escapeHtml(product.name)}" style="width:100%;max-width:220px;border-radius:8px;object-fit:cover;">`
        : '';
      const price = Number.isFinite(product.price) ? `NT$${Number(product.price).toLocaleString('en-US')}` : '';
      const summary = htmlToPlainText(product.summary ?? '');
      return `
        <article style="border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin:12px 0;">
          ${image}
          <h3 style="font-size:18px;line-height:1.4;margin:12px 0 6px;">${escapeHtml(product.name)}</h3>
          <p style="margin:0 0 8px;color:#4b5563;">${escapeHtml(summary)}</p>
          <p style="margin:0 0 12px;font-weight:700;">${escapeHtml(price)}</p>
          <p style="margin:0;">
            <a href="${escapeHtml(product.product_url)}" style="display:inline-block;padding:9px 14px;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px;">開啟商品</a>
            <a href="${escapeHtml(product.ai_url)}" style="display:inline-block;padding:9px 14px;margin-left:8px;background:#0f766e;color:#ffffff;text-decoration:none;border-radius:6px;">詢問 AI 客服</a>
          </p>
        </article>`;
    }),
    '</section>'
  ].join('');
}

function htmlToPlainText(value) {
  return String(value ?? '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeCommittedMediaPath(source, siteId, fieldName) {
  if (typeof source === 'string') {
    source = { media_path: source };
  }

  if (!source || typeof source !== 'object') {
    throw codedError('VALIDATION_FAILED', `${fieldName} must be an object with media_path from slimweb_uploads_commit or an existing SlimWeb committed media URL.`);
  }

  let mediaPath = String(source.media_path ?? source.public_url ?? source.url ?? '').trim();
  if (mediaPath === '') {
    throw codedError('VALIDATION_FAILED', `${fieldName}.media_path is required. Use slimweb_uploads_create, upload bytes with the AI client Python sandbox, then call slimweb_uploads_commit.`);
  }

  if (looksLikeUrl(mediaPath)) {
    mediaPath = committedMediaPathFromUrl(mediaPath, siteId, fieldName);
  }

  if (mediaPath.startsWith('/mnt/') || mediaPath.startsWith('file:') || mediaPath.includes('..')) {
    throw codedError('VALIDATION_FAILED', `${fieldName}.media_path must be the committed SlimWeb media_path returned by slimweb_uploads_commit, not a URL, local path, or attachment reference.`);
  }

  const prefix = `sites/${siteId}/`;
  if (!mediaPath.startsWith(prefix)) {
    throw codedError('VALIDATION_FAILED', `${fieldName}.media_path must belong to the selected site.`);
  }

  if (!/^sites\/\d+\/[A-Za-z0-9/_.,@-]+\.(png|jpe?g|webp)$/i.test(mediaPath)) {
    throw codedError('VALIDATION_FAILED', `${fieldName}.media_path is not a valid committed image path.`);
  }

  return mediaPath;
}

function committedMediaPathFromUrl(url, siteId, fieldName) {
  const mediaPath = tryCommittedMediaPathFromUrl(url, siteId);
  if (mediaPath) {
    return mediaPath;
  }

  throw codedError('VALIDATION_FAILED', `${fieldName}.media_path URL must point to an existing SlimWeb committed media file for the selected site.`);
}

function tryCommittedMediaPathFromUrl(url, siteId) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const path = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
  const expectedPrefix = `media/sites/${siteId}/mcp-uploads/committed/`;
  if (!path.startsWith(expectedPrefix)) {
    return null;
  }

  return path.slice('media/'.length);
}

function normalizeNullableCommittedMediaPath(source, siteId, fieldName) {
  if (source === null) {
    return null;
  }

  return normalizeCommittedMediaPath(source, siteId, fieldName);
}

function formatTheme(theme) {
  return {
    id: theme.id,
    site_id: theme.site_id,
    name: theme.name,
    is_default: Boolean(theme.is_default),
    is_active: Boolean(theme.is_active),
    theme_mode: theme.theme_mode || 'light',
    color_mode_scope: 'site',
    inherits_site_theme_mode: true
  };
}

function buildTree(rows, parentId = null) {
  return rows
    .filter((row) => row.parent_id === parentId)
    .map((row) => ({
      id: row.id,
      name: row.name,
      type: row.item_type,
      url: row.url,
      has_icon: Boolean(row.has_icon),
      image_path: row.image_path ?? null,
      children: buildTree(rows, row.id)
    }));
}

function contactItemsFromSiteDetails(site) {
  const fields = [
    ['email', 'contact', site.contact_email],
    ['line', 'social', site.contact_line],
    ['wechat', 'social', site.contact_wechat],
    ['telegram', 'social', site.contact_telegram],
    ['twitter', 'social', site.contact_twitter],
    ['instagram', 'social', site.contact_instagram],
    ['facebook', 'social', site.contact_facebook_page],
    ['address', 'contact', site.contact_store_address],
    ['phone', 'contact', site.contact_phone],
    ['mobile', 'contact', site.contact_mobile],
    ['tax_id', 'business', site.contact_tax_id],
    ['copyright', 'legal', site.contact_copyright]
  ];

  return fields
    .filter(([, , value]) => typeof value === 'string' && value.trim() !== '')
    .map(([name, kind, value]) => ({
      name,
      kind,
      value
    }));
}

function formatStyleProfile(profile) {
  if (!profile) {
    return null;
  }

  return {
    id: profile.id,
    site_id: profile.site_id,
    theme_id: profile.site_page_id,
    summary: profile.summary,
    target_audience: profile.target_audience,
    visual_keywords: normalizeStringArray(profile.visual_keywords),
    color_notes: profile.color_notes,
    typography_notes: profile.typography_notes,
    layout_notes: profile.layout_notes,
    illustration_notes: profile.illustration_notes,
    avoid_notes: profile.avoid_notes,
    user_requests: normalizeUserRequests(profile.user_requests),
    ai_design_notes: profile.ai_design_notes,
    version: Number.parseInt(profile.version ?? '1', 10),
    is_active: profile.is_active !== false,
    created_at: profile.created_at ?? null,
    updated_at: profile.updated_at ?? null
  };
}

function normalizeStringArray(value) {
  const raw = typeof value === 'string' ? JSON.parse(value || '[]') : value;

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => String(item ?? '').trim())
    .filter((item) => item !== '');
}

function normalizeUserRequests(value) {
  const raw = typeof value === 'string' ? JSON.parse(value || '[]') : value;

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map(normalizeUserRequestEntry).filter(Boolean);
}

function normalizeUserRequestEntry(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const request = nullableString(value.request);
  if (!request) {
    return null;
  }

  return {
    request,
    ai_notes: nullableString(value.ai_notes),
    recorded_at: nullableString(value.recorded_at) ?? new Date().toISOString()
  };
}

function nullableString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();

  return text === '' ? null : text;
}

function normalizedOrderListFilters(args, statuses, limit, offset) {
  return {
    search_order_no: nullableString(args.search_order_no) ?? '',
    search_field: nullableString(args.search_field) ?? '',
    search_value: nullableString(args.search_value) ?? '',
    fuzzy: Boolean(args.fuzzy),
    date_from: nullableString(args.date_from) ?? '',
    date_to: nullableString(args.date_to) ?? '',
    amount_min: args.amount_min ?? null,
    amount_max: args.amount_max ?? null,
    logistics_status: nullableString(args.logistics_status) ?? '',
    statuses,
    limit,
    offset
  };
}

function applyOrderListFilters(where, params, args, statuses) {
  const searchOrderNo = nullableString(args.search_order_no);
  if (searchOrderNo) {
    params.push(`%${searchOrderNo}%`);
    where.push(`order_no ilike $${params.length}`);
  }

  if (statuses.length > 0) {
    params.push(statuses);
    where.push(`status = any($${params.length}::text[])`);
  }

  if (nullableString(args.logistics_status) === 'pending') {
    where.push('payment_completed_at is not null');
    where.push('logistics_completed_at is null');
  }

  const searchField = nullableString(args.search_field);
  if (!searchField) {
    return;
  }

  if (searchField === 'date_range') {
    const dateFrom = nullableString(args.date_from);
    const dateTo = nullableString(args.date_to);
    if (dateFrom) {
      params.push(dateFrom);
      where.push(`placed_at::date >= $${params.length}::date`);
    }
    if (dateTo) {
      params.push(dateTo);
      where.push(`placed_at::date <= $${params.length}::date`);
    }
    return;
  }

  if (searchField === 'amount_range') {
    const amountMin = args.amount_min === undefined || args.amount_min === null || args.amount_min === '' ? null : Number.parseInt(args.amount_min, 10);
    const amountMax = args.amount_max === undefined || args.amount_max === null || args.amount_max === '' ? null : Number.parseInt(args.amount_max, 10);
    if (Number.isInteger(amountMin) && amountMin >= 0) {
      params.push(amountMin);
      where.push(`grand_total_amount >= $${params.length}`);
    }
    if (Number.isInteger(amountMax) && amountMax >= 0) {
      params.push(amountMax);
      where.push(`grand_total_amount <= $${params.length}`);
    }
    return;
  }

  if (searchField === 'payment_incomplete') {
    where.push('payment_completed_at is null');
    return;
  }

  const allowedFields = new Set(['order_no', 'buyer_name', 'buyer_phone', 'buyer_email', 'recipient_name', 'recipient_phone', 'product_name']);
  if (!allowedFields.has(searchField)) {
    throw codedError('VALIDATION_FAILED', 'search_field must match a supported admin order search field.');
  }

  const searchValue = nullableString(args.search_value);
  if (!searchValue) {
    return;
  }

  const operator = args.fuzzy ? 'ilike' : '=';
  const value = args.fuzzy ? `%${searchValue}%` : searchValue;

  params.push(value);
  const valueIndex = params.length;

  if (searchField === 'product_name') {
    where.push(`exists (select 1 from order_items oi where oi.order_id = orders.id and oi.product_name ${operator} $${valueIndex})`);
    return;
  }

  if (searchField === 'buyer_name') {
    where.push(`(buyer_name ${operator} $${valueIndex} or exists (select 1 from members m where m.id = orders.member_id and m.name ${operator} $${valueIndex}))`);
    return;
  }

  if (searchField === 'buyer_phone') {
    where.push(`(recipient_phone ${operator} $${valueIndex} or exists (select 1 from members m where m.id = orders.member_id and m.mobile ${operator} $${valueIndex}))`);
    return;
  }

  if (searchField === 'buyer_email') {
    where.push(`(buyer_email ${operator} $${valueIndex} or exists (select 1 from members m where m.id = orders.member_id and m.email ${operator} $${valueIndex}))`);
    return;
  }

  where.push(`${searchField} ${operator} $${valueIndex}`);
}

function normalizeOrderStatuses(value) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw codedError('VALIDATION_FAILED', 'statuses must be an array.');
  }

  const allowed = new Set(['pending', 'confirmed', 'returning', 'returned', 'cancelled']);
  return value.map((status) => String(status).trim()).filter(Boolean).map((status) => {
    if (!allowed.has(status)) {
      throw codedError('VALIDATION_FAILED', 'statuses must contain only pending, confirmed, returning, returned, or cancelled.');
    }
    return status;
  });
}

function paymentLogisticsCallbackUrls(site) {
  const baseUrl = String(process.env.WEBLESS_PUBLIC_URL || process.env.WEBLESS_APP_URL || process.env.APP_URL || 'https://slimweb.tw').replace(/\/+$/, '');
  const code = nullableString(site.callback_code) ?? `site-${site.id}`;
  const payment = Object.fromEntries(PAYMENT_PROVIDER_DEFINITIONS.map((provider) => [
    provider.provider,
    {
      notify_url: `${baseUrl}/callbacks/${code}/payment/${provider.provider}/notify`,
      return_url: `${baseUrl}/callbacks/${code}/payment/${provider.provider}/return`
    }
  ]));
  const logistics = Object.fromEntries(LOGISTICS_PROVIDER_DEFINITIONS.map((provider) => [
    provider.provider,
    {
      notify_url: `${baseUrl}/callbacks/${code}/logistics/${provider.provider}/notify`
    }
  ]));

  return {
    base_url: baseUrl,
    site_callback_code: code,
    store_map_callback_url: `${baseUrl}/callbacks/${code}/store-map`,
    payment,
    logistics
  };
}

function formatOrderForMcp(order, context) {
  const paymentProviders = context.paymentProviders ?? [];
  const logisticsProviders = context.logisticsProviders ?? [];
  const logisticsDetails = parseJsonObject(order.logistics_details);
  const returnLogisticsDetails = parseJsonObject(order.return_logistics_details);
  const paymentDetails = parseJsonObject(order.payment_details);
  const refundDetails = parseJsonObject(order.refund_details);
  const logisticsStatus = orderLogisticsStatus(order, logisticsDetails);
  const returnStatus = orderReturnStatus(order);
  const refundStatus = orderRefundStatus(order);
  const actions = [
    ...orderLogisticsActions(order, logisticsProviders),
    ...orderRefundActions(order, paymentProviders)
  ];

  if (context.includeReturnActions) {
    actions.push(...orderReturnActions(order, logisticsProviders));
  }

  return {
    id: order.id,
    order_no: order.order_no ?? '',
    status: order.status ?? '',
    status_label: ORDER_STATUS_LABELS[order.status] ?? order.status ?? '',
    payment_method: order.payment_method ?? '',
    payment_method_label: PAYMENT_METHOD_LABELS[order.payment_method] ?? order.payment_method ?? '',
    payment_provider: order.payment_provider ?? '',
    payment_completed: order.payment_completed_at !== null && order.payment_completed_at !== undefined,
    payment_completed_at: orderDateString(order, 'payment_completed_at'),
    payment_details: paymentDetails,
    payment_status_label: order.payment_completed_at ? '已完成' : '未完成',
    logistics_status: logisticsStatus,
    logistics_status_label: WORKFLOW_STATUS_LABELS[logisticsStatus] ?? logisticsStatus,
    logistics_raw_status_label: logisticsRawStatusLabel(logisticsDetails),
    logistics_completed_at: orderDateString(order, 'logistics_completed_at'),
    logistics_details: logisticsDetails,
    pickup_store_provider: order.pickup_store_provider ?? '',
    pickup_store_type: order.pickup_store_type ?? '',
    pickup_store_id: order.pickup_store_id ?? '',
    pickup_store_name: order.pickup_store_name ?? '',
    pickup_store_address: order.pickup_store_address ?? '',
    return_status: returnStatus,
    return_status_label: WORKFLOW_STATUS_LABELS[returnStatus] ?? returnStatus,
    return_requested_at: orderDateString(order, 'return_requested_at'),
    return_cancelled_at: orderDateString(order, 'return_cancelled_at'),
    return_completed_at: orderDateString(order, 'return_completed_at'),
    return_logistics_provider: order.return_logistics_provider ?? '',
    return_logistics_type: order.return_logistics_type ?? '',
    return_logistics_tracking_no: order.return_logistics_tracking_no ?? '',
    return_logistics_status: orderReturnLogisticsStatus(order, returnLogisticsDetails),
    return_logistics_status_label: WORKFLOW_STATUS_LABELS[orderReturnLogisticsStatus(order, returnLogisticsDetails)] ?? '',
    return_logistics_raw_status_label: logisticsRawStatusLabel(returnLogisticsDetails),
    return_logistics_details: returnLogisticsDetails,
    refund_status: refundStatus,
    refund_status_label: WORKFLOW_STATUS_LABELS[refundStatus] ?? refundStatus,
    refund_provider: order.refund_provider ?? '',
    refund_amount: Number.parseInt(order.refund_amount ?? '0', 10),
    refund_completed_at: orderDateString(order, 'refund_completed_at'),
    refund_details: refundDetails,
    buyer_name: order.buyer_name ?? '',
    buyer_email: order.buyer_email ?? '',
    recipient_name: order.recipient_name ?? '',
    recipient_phone: order.recipient_phone ?? '',
    recipient_email: order.recipient_email ?? '',
    recipient_country_code: order.recipient_country_code ?? '',
    recipient_zip: order.recipient_zip ?? '',
    recipient_address: order.recipient_address ?? '',
    currency_prefix: order.currency_prefix ?? 'NT$',
    items_subtotal_amount: Number.parseInt(order.items_subtotal_amount ?? '0', 10),
    shipping_fee_amount: Number.parseInt(order.shipping_fee_amount ?? '0', 10),
    grand_total_amount: Number.parseInt(order.grand_total_amount ?? '0', 10),
    item_count: Number.parseInt(order.item_count ?? '0', 10),
    total_quantity: Number.parseInt(order.total_quantity ?? '0', 10),
    placed_at: orderDateString(order, 'placed_at'),
    created_at: orderDateString(order, 'created_at'),
    available_actions: actions,
    action_policy: {
      ask_user_when_requires_choice: actions.some((action) => action.requires_user_choice),
      note: 'Only call action tools using an item from available_actions. If more than one logistics provider is available, ask the user to choose before creating logistics.'
    }
  };
}

function orderDateDisplaySelectSql() {
  return ORDER_DATE_FIELDS
    .map((field) => `to_char(${field}, 'YYYY-MM-DD HH24:MI:SS') as ${field}_display`)
    .join(',\n               ');
}

function orderDateString(order, field) {
  return dateString(order[`${field}_display`] ?? order[field]);
}

function orderLogisticsActions(order, logisticsProviders) {
  if (order.return_requested_at && !order.return_cancelled_at) {
    return [];
  }
  if (order.logistics_completed_at !== null && order.logistics_completed_at !== undefined) {
    return [];
  }
  if (order.payment_completed_at === null || order.payment_completed_at === undefined) {
    return [
      blockedAction('create_logistics', 'Payment must be completed before creating forward logistics.')
    ];
  }

  const enabled = enabledLogisticsProviders(logisticsProviders);
  const paymentMethod = order.payment_method ?? '';
  const paymentProvider = order.payment_provider ?? '';

  if (isCvsOrder(order)) {
    const provider = order.pickup_store_provider || paymentProvider;
    const storeType = order.pickup_store_type || '';
    if (provider && enabled.has(provider) && providerSupportsStoreType(logisticsProviders, provider, storeType)) {
      return [logisticsAction('create_logistics', provider, {
        store_type: storeType,
        logistics_type: 'cvs',
        label: `${storeTypeLabel(storeType)}物流單`,
        reason: '超商取貨訂單只能建立同超商通路的物流單。'
      })];
    }
    return [blockedAction('create_logistics', 'Convenience-store order requires the matching enabled store logistics provider and store type.')];
  }

  if (paymentMethod === 'cod_home_delivery') {
    const hct = logisticsProviders.find((provider) => provider.provider === 'hct');
    if (hct?.is_enabled && hct.settings?.collectPaymentEnabled) {
      return [logisticsAction('create_logistics', 'hct', {
        logistics_type: 'home_delivery',
        label: '新竹物流宅配貨到付款',
        reason: '宅配貨到付款只能建立新竹物流。'
      })];
    }
    return [blockedAction('create_logistics', 'HCT logistics with collect_payment_enabled is required for cash-on-delivery home delivery.')];
  }

  const actions = [];
  if (paymentProvider === 'ecpay' && enabled.has('ecpay')) {
    actions.push(logisticsAction('create_logistics', 'ecpay', {
      logistics_type: 'home_delivery',
      label: '綠界宅配物流單',
      reason: '訂單金流來源為綠界，可建立綠界宅配物流。'
    }));
  }
  if (enabled.has('hct')) {
    actions.push(logisticsAction('create_logistics', 'hct', {
      logistics_type: 'home_delivery',
      label: '新竹物流宅配物流單',
      reason: paymentProvider === 'newebpay' ? '藍新無逆物流 API；宅配物流可用新竹物流。' : '宅配訂單可使用新竹物流。'
    }));
  }

  return markChoice(actions);
}

function orderReturnActions(order, logisticsProviders) {
  if (!order.return_requested_at || order.return_cancelled_at || orderReturnStatus(order) === 'completed') {
    return [];
  }

  const actions = [];
  if (!order.return_logistics_tracking_no) {
    actions.push({
      action: 'cancel_return',
      label: '取消退貨',
      description: '回歸正常訂單，不退了。'
    });
    actions.push({
      action: 'complete_return',
      label: '已完成退貨',
      description: '用戶已用其他方式完成退貨；退款仍需另外處理。'
    });

    const enabled = enabledLogisticsProviders(logisticsProviders);
    const paymentProvider = order.payment_provider ?? '';
    const isCvs = isCvsOrder(order);
    if (paymentProvider === 'ecpay' && enabled.has('ecpay')) {
      actions.push({
        action: 'create_return_logistics',
        provider: 'ecpay',
        type: isCvs ? 'cvs' : 'home_delivery',
        label: isCvs ? '綠界超商退貨' : '綠界宅配退貨',
        description: isCvs ? '超商取貨訂單強制超商退貨。' : '綠界宅配訂單使用訂單收件人資訊建立退貨。'
      });
    }
    if (paymentProvider !== 'ecpay' && !isCvs && enabled.has('hct')) {
      actions.push({
        action: 'create_return_logistics',
        provider: 'hct',
        type: 'home_delivery',
        label: '新竹物流退貨',
        description: '宅配退貨使用訂單收件人資訊。'
      });
    }
  }

  return actions;
}

function orderRefundActions(order, paymentProviders) {
  if (!order.payment_completed_at) {
    return [];
  }
  const refundStatus = orderRefundStatus(order);
  if (!['pending', 'exception'].includes(refundStatus)) {
    return [];
  }

  const actions = [{
    action: 'complete_refund',
    label: '已完成退款',
    description: '用戶使用其他方式退款，或 ATM/超商代碼/取貨付款等非刷卡退款。'
  }];
  const provider = order.payment_provider ?? '';
  const paymentProvider = paymentProviders.find((item) => item.provider === provider);
  if (['ecpay', 'newebpay'].includes(provider) && paymentProvider?.is_enabled && String(order.payment_method ?? '').includes('online_payment')) {
    actions.push({
      action: 'create_refund',
      provider,
      label: provider === 'ecpay' ? '綠界刷退' : '藍新刷退',
      description: '建立刷退後移除手動退款操作，後續狀態以金流回傳為準。'
    });
  }

  return actions;
}

function findAction(actions, actionName, provider, storeType) {
  return actions.find((action) => action.action === actionName
    && action.provider === provider
    && (!storeType || action.store_type === storeType));
}

function logisticsAction(action, provider, details) {
  return {
    action,
    provider,
    ...details,
    description: details.reason
  };
}

function blockedAction(action, reason) {
  return {
    action,
    blocked: true,
    reason,
    description: reason
  };
}

function markChoice(actions) {
  if (actions.length > 1) {
    return actions.map((action) => ({ ...action, requires_user_choice: true }));
  }
  return actions;
}

function enabledLogisticsProviders(providers) {
  return new Set(providers.filter((provider) => provider.is_enabled).map((provider) => provider.provider));
}

function providerSupportsStoreType(providers, providerName, storeType) {
  if (!storeType) {
    return false;
  }
  const provider = providers.find((item) => item.provider === providerName);
  return Boolean(provider?.is_enabled && (provider.settings?.storeTypes ?? []).includes(storeType));
}

function isCvsOrder(order) {
  return ['cvs_pickup_online_payment', 'cvs_pickup_cod', 'cvs_pickup_linepay'].includes(order.payment_method)
    || Boolean(order.pickup_store_id || order.pickup_store_type);
}

function orderLogisticsStatus(order, details) {
  if (!order.logistics_completed_at) {
    return 'pending';
  }
  if ((details.status_source ?? '') === 'manual') {
    return 'completed';
  }
  if (logisticsDetailsIndicateException(details)) {
    return 'exception';
  }
  if (logisticsDetailsIndicateCompleted(details)) {
    return 'completed';
  }
  return 'created';
}

function orderReturnStatus(order) {
  const status = order.return_status ?? '';
  if (['pending', 'created', 'exception', 'completed', 'cancelled'].includes(status)) {
    return status;
  }
  if (order.return_cancelled_at) {
    return 'cancelled';
  }
  if (order.return_completed_at || order.returned_at || order.status === 'returned') {
    return 'completed';
  }
  if (order.return_logistics_tracking_no) {
    return 'created';
  }
  if (order.return_requested_at) {
    return 'pending';
  }
  return '';
}

function orderRefundStatus(order) {
  const status = order.refund_status ?? '';
  if (['pending', 'created', 'exception', 'completed'].includes(status)) {
    return status;
  }
  if (order.refund_completed_at) {
    return 'completed';
  }
  return order.payment_completed_at ? 'pending' : '';
}

function orderReturnLogisticsStatus(order, details) {
  if (!order.return_logistics_tracking_no && Object.keys(details).length === 0) {
    return 'pending';
  }
  if (logisticsDetailsIndicateException(details)) {
    return 'exception';
  }
  if (logisticsDetailsIndicateCompleted(details) || order.return_status === 'completed') {
    return 'completed';
  }
  return order.return_logistics_tracking_no ? 'created' : 'pending';
}

function logisticsRawStatusLabel(details) {
  return String(details.raw_status_label ?? details.raw_status ?? details.status ?? '');
}

function logisticsDetailsIndicateCompleted(details) {
  const text = logisticsSearchText(details);
  return ['已送達', '已配達', '客戶已取貨', '取貨完成', '已完成', 'delivered', 'picked up', 'picked_up', 'completed', 'complete']
    .some((needle) => text.includes(needle.toLowerCase()));
}

function logisticsDetailsIndicateException(details) {
  const text = logisticsSearchText(details);
  return ['異常', '失敗', '無法送達', '拒收', '退回', 'exception', 'failed', 'failure', 'error']
    .some((needle) => text.includes(needle.toLowerCase()));
}

function logisticsSearchText(details) {
  const payload = parseJsonObject(details.payload);
  return [
    details.raw_status ?? '',
    details.raw_status_label ?? '',
    details.status ?? '',
    ...Object.values(payload)
  ].filter((value) => typeof value === 'string' || typeof value === 'number').join(' ').toLowerCase();
}

function parseJsonObject(value) {
  if (!value) {
    return {};
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function dateString(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function storeTypeLabel(storeType) {
  return {
    seven: '7-11',
    family: '全家',
    hilife: '萊爾富',
    ok: 'OK'
  }[storeType] ?? storeType;
}

function generateTrackingNo(provider, orderId, reverse = false) {
  const prefix = reverse
    ? ({ hct: 'HCTR', newebpay: 'NWPR', ecpay: 'ECPR' }[provider] ?? 'RTR')
    : ({ hct: 'HCT', newebpay: 'NWP', ecpay: 'ECP' }[provider] ?? 'LOG');
  const date = new Date().toISOString().slice(2, 10).replaceAll('-', '');
  const suffix = randomBytes(2).toString('hex').toUpperCase();
  return `${prefix}${date}${String(orderId).padStart(6, '0')}${suffix}`;
}

function themeDirectory(theme) {
  return theme.is_default
    ? `sites/${theme.site_id}/templates/default`
    : `sites/${theme.site_id}/templates/schemes/${theme.id}`;
}

function siteLevelHomepageTheme(site) {
  return {
    id: 'site_homepage',
    site_id: site.id,
    name: 'Site homepage',
    is_default: true,
    is_active: false,
    theme_mode: 'light'
  };
}

function homeContentStoragePath(siteId) {
  return pageContentStoragePath(siteId, { id: 'default', site_id: siteId, is_default: true }, 'index');
}

function legacyHomepageContentStoragePath(siteId, themeId) {
  return `site-page-templates/${siteId}/${themeId}/pages/index.blade.php`;
}

function customPageMetadataStoragePath(siteId, pageKey) {
  return `sites/${siteId}/templates/default/pages/${normalizePageKey(pageKey)}/.page.json`;
}

function articleSeoMetadataStoragePath(siteId, articleId) {
  return `sites/${siteId}/articles/${requireInteger(articleId, 'article_id')}/seo.json`;
}

function pageContentStoragePath(siteId, theme, pageKey) {
  const filename = theme.is_default ? 'content.blade.php' : 'body.blade.php';

  return `${themeDirectory({ ...theme, site_id: siteId })}/pages/${normalizePageKey(pageKey)}/${filename}`;
}

function fixedTemplatePages() {
  return [
    ['index', '首頁'],
    ['profile', '個人資訊'],
    ['order_history', '訂購紀錄'],
    ['cart', '購物車頁面'],
    ['checkout', '結帳頁面'],
    ['checkout_complete', '結帳完成頁面'],
    ['products', '商品列表頁面'],
    ['product_detail', '商品內頁'],
    ['login', '登入頁面'],
    ['register', '註冊頁面'],
    ['register_verify', '註冊驗證頁面'],
    ['articles', '文章列表頁面'],
    ['article_view', '文章頁面'],
    ['ai_support', 'AI 客服頁面']
  ].map(([pageKey, title]) => ({ page_key: pageKey, title }));
}

function isEditableFixedPageKey(pageKey) {
  return pageKey === 'index';
}

function headlineFromPageKey(pageKey) {
  return String(pageKey)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fixedTemplatePageTitleCandidates(page) {
  const candidates = new Set([page.title, headlineFromPageKey(page.page_key)]);

  if (page.page_key === 'index') {
    candidates.add('Home');
    candidates.add('Homepage');
    candidates.add('Home Page');
  }

  return [...candidates];
}

function pageLookupCandidates(page) {
  const candidates = new Set([page.page_key, page.title, headlineFromPageKey(page.page_key)]);

  if (page.page_key === 'index') {
    candidates.add('Home');
    candidates.add('Homepage');
    candidates.add('Home Page');
  }

  return [...candidates];
}

function templateAssetStoragePath(theme, relativePath) {
  return `${themeDirectory(theme)}/${relativePath.replace(/^\/+/, '')}`;
}

function rootElementStoragePath(theme, fragment) {
  const filename = {
    navbar: 'navbar.blade.php',
    footer: 'footer.blade.php',
    online_support: 'online-support.blade.php'
  }[fragment];

  return `${themeDirectory(theme)}/root-elements/${filename}`;
}

function extractHtmlContent(content) {
  const html = typeof content?.html === 'string'
    ? content.html
    : (typeof content?.body_html === 'string' ? content.body_html : '');

  return extractSafeHtml(stripManagedPageLibraryBlock(html), 'content.html or content.body_html', { allowInlineScript: true });
}

function extractSafeHtml(html, name, options = {}) {
  if (typeof html !== 'string' || html.trim() === '') {
    throw codedError('VALIDATION_FAILED', `${name} is required.`);
  }

  const allowInlineScript = options.allowInlineScript === true;
  const blockedTagPattern = allowInlineScript
    ? /<\s*(link|iframe)\b/i
    : /<\s*(script|link|iframe)\b/i;

  if (blockedTagPattern.test(html) || /<\s*script\b[^>]*\bsrc\s*=/i.test(html) || /\son[a-z]+\s*=/i.test(html)) {
    throw codedError('UNSAFE_CONTENT', allowInlineScript
      ? 'Page HTML cannot include external script/link/iframe tags or inline event handlers. Select supported libraries with enabled_libraries and keep page JavaScript inline.'
      : 'HTML content cannot include script/link/iframe tags or inline event handlers.');
  }

  if (allowInlineScript && hasUnsafePageScript(html)) {
    throw codedError('UNSAFE_CONTENT', 'Page JavaScript cannot use eval, Function, fetch, storage, cookies, or navigation APIs.');
  }

  return html;
}

function normalizePageEnabledLibraries(value) {
  const normalized = [];
  for (const key of normalizeStringArray(value)) {
    if (!PAGE_SUPPORTED_LIBRARY_KEYS.includes(key)) {
      throw codedError('VALIDATION_FAILED', `enabled_libraries may only include: ${PAGE_SUPPORTED_LIBRARY_KEYS.join(', ')}.`);
    }
    if (!normalized.includes(key)) {
      normalized.push(key);
    }
  }

  for (const key of [...normalized]) {
    for (const dependency of PAGE_LIBRARY_ASSETS[key]?.requires ?? []) {
      if (!normalized.includes(dependency)) {
        normalized.push(dependency);
      }
    }
  }

  return PAGE_SUPPORTED_LIBRARY_KEYS.filter((key) => normalized.includes(key));
}

function pageHtmlWithManagedLibraries(html, enabledLibraries) {
  const cleanHtml = stripManagedPageLibraryBlock(html).trim();
  if (enabledLibraries.length === 0) {
    return cleanHtml;
  }

  return `${managedPageLibraryBlock(enabledLibraries)}\n${cleanHtml}`;
}

function managedPageLibraryBlock(enabledLibraries) {
  const cssUrls = [];
  const jsUrls = [];
  for (const key of enabledLibraries) {
    cssUrls.push(...(PAGE_LIBRARY_ASSETS[key]?.css ?? []));
    jsUrls.push(...(PAGE_LIBRARY_ASSETS[key]?.js ?? []));
  }

  const links = [...new Set(cssUrls)].map((url) => `<link rel="stylesheet" href="${url}">`);
  const scripts = [...new Set(jsUrls)].map((url) => `<script src="${url}"></script>`);
  const metadata = `<script type="application/json" data-slimweb-page-libraries>${JSON.stringify(enabledLibraries)}</script>`;

  return [
    PAGE_LIBRARY_BLOCK_START,
    ...links,
    ...scripts,
    metadata,
    PAGE_LIBRARY_BLOCK_END
  ].join('\n');
}

function stripManagedPageLibraryBlock(html) {
  return String(html ?? '').replace(managedPageLibraryBlockPattern(), '').trimStart();
}

function extractManagedPageLibraries(html) {
  const match = String(html ?? '').match(managedPageLibraryBlockPattern());
  if (!match) {
    return [];
  }

  const metadataMatch = match[0].match(/<script\s+type="application\/json"\s+data-slimweb-page-libraries>([\s\S]*?)<\/script>/i);
  if (!metadataMatch) {
    return [];
  }

  try {
    return JSON.parse(metadataMatch[1]);
  } catch {
    return [];
  }
}

function managedPageLibraryBlockPattern() {
  return new RegExp(`${escapeRegExp(PAGE_LIBRARY_BLOCK_START)}[\\s\\S]*?${escapeRegExp(PAGE_LIBRARY_BLOCK_END)}\\s*`, 'i');
}

function hasUnsafePageScript(html) {
  const scripts = [...String(html).matchAll(/<\s*script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\s*\/\s*script\s*>/gi)];
  return scripts.some((match) => /\b(eval|fetch)\s*\(|new\s+Function\b|document\s*\.\s*cookie|localStorage|sessionStorage|location\s*\.(?:href|assign|replace)|window\s*\.\s*open/i.test(match[1]));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTitleMatch(value) {
  return String(value ?? '').trim().toLowerCase();
}

function removeDuplicateArticleTitleHeading(html, title) {
  const match = html.match(/^(\s*(?:<article\b[^>]*>\s*)?)<h1\b[^>]*>([\s\S]*?)<\/h1>\s*/i);
  if (!match) {
    return html;
  }

  if (normalizeHtmlText(match[2]) !== normalizeHtmlText(title)) {
    return html;
  }

  return `${match[1]}${html.slice(match[0].length)}`;
}

function normalizeHtmlText(value) {
  return decodeHtmlEntities(String(value).replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
      const point = Number.parseInt(code, 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : _match;
    })
    .replace(/&#(\d+);/g, (_match, code) => {
      const point = Number.parseInt(code, 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : _match;
    })
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (match, entity) => ({
      nbsp: ' ',
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'"
    }[String(entity).toLowerCase()] ?? match));
}

function contentTypeForPath(storagePath) {
  const extension = path.extname(storagePath).toLowerCase();

  if (extension === '.css') {
    return 'text/css; charset=utf-8';
  }

  if (extension === '.php') {
    return 'text/x-php; charset=utf-8';
  }

  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }

  if (extension === '.png') {
    return 'image/png';
  }

  if (extension === '.webp') {
    return 'image/webp';
  }

  return 'application/octet-stream';
}

async function listLocalFiles(directory) {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listLocalFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}
