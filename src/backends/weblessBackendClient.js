import { randomUUID } from 'node:crypto';

import { assertSlimWebBackend } from './slimWebBackend.js';

export class BackendError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'BackendError';
    this.code = options.code ?? 'UPSTREAM_FAILED';
    this.status = options.status ?? null;
    this.details = options.details ?? {};
    this.requestId = options.requestId ?? null;
    this.cause = options.cause;
  }
}

export class WeblessBackendClient {
  constructor({
    baseUrl,
    secret,
    fetchImpl = fetch,
    timeoutMs = 15_000,
    requestIdFactory = randomUUID,
    idempotencyKeyFactory = randomUUID
  } = {}) {
    this.baseUrl = String(baseUrl ?? '').trim().replace(/\/+$/, '');
    this.secret = String(secret ?? '').trim();
    if (this.baseUrl === '') {
      throw new TypeError('WeblessBackendClient baseUrl is required.');
    }
    if (this.secret === '') {
      throw new TypeError('WeblessBackendClient secret is required.');
    }

    this.fetch = fetchImpl;
    this.timeoutMs = Math.max(1, Number(timeoutMs) || 15_000);
    this.requestIdFactory = requestIdFactory;
    this.idempotencyKeyFactory = idempotencyKeyFactory;

    assertSlimWebBackend(this);
  }

  async listSitesForAdminIdentity(identity) {
    const data = await this.request('/internal/mcp/v1/sites', {
      identity,
      tool: 'slimweb_sites_list'
    });

    return data.sites;
  }

  async resolveAdminSiteForIdentity(identity, args) {
    const siteCode = String(args?.site_code ?? '').trim();
    const selector = siteCode !== ''
      ? { site_code: siteCode }
      : { site_id: args?.site_id };
    const data = await this.request('/internal/mcp/v1/site-context/resolve', {
      method: 'POST',
      identity,
      tool: 'site_context',
      body: selector
    });

    return {
      ...identity,
      ...data.actor,
      site: data.site
    };
  }

  async selectSiteForAdminIdentity(identity, args) {
    const actor = await this.resolveAdminSiteForIdentity(identity, args);
    const data = await this.request(this.sitePath(actor, '/themes?include_default=1'), {
      identity: actor,
      tool: 'slimweb_site_select',
      permission: 'page_management_templates'
    });

    return {
      selected_site: actor.site,
      site_admin_id: actor.site_admin_id,
      permissions: actor.permissions,
      themes: data.themes,
      requires_site_code_for_mutations: true
    };
  }

  async getBasicSettings(actor) {
    return this.request(this.settingsPath(actor), {
      identity: actor,
      tool: 'slimweb_settings_get',
      permission: 'basic_settings'
    });
  }

  async updateBasicSettings(actor, args) {
    const { site_id: _siteId, site_code: _siteCode, ...patch } = args ?? {};

    return this.request(this.settingsPath(actor), {
      method: 'PATCH',
      identity: actor,
      tool: 'slimweb_settings_update',
      permission: 'basic_settings',
      idempotencyKey: this.idempotencyKeyFactory(),
      body: patch
    });
  }

  async listCategories(actor) {
    return this.request(this.sitePath(actor, '/catalog/categories'), {
      identity: actor,
      tool: 'slimweb_categories_list',
      permission: 'product_management_categories'
    });
  }

  async upsertCategory(actor, args) {
    return this.catalogMutation(actor, '/catalog/categories', 'PUT', 'slimweb_categories_upsert', 'product_management_categories', args);
  }

  async deleteCategory(actor, args) {
    return this.catalogMutation(actor, `/catalog/categories/${this.requiredId(args?.category_id, 'category_id')}`, 'DELETE', 'slimweb_categories_delete', 'product_management_categories', {});
  }

  async listNavItems(actor) {
    return this.request(this.sitePath(actor, '/navigation/items'), {
      identity: actor,
      tool: 'slimweb_nav_items_list',
      permission: 'page_management_navbar'
    });
  }

  async upsertNavItem(actor, args) {
    return this.catalogMutation(actor, '/navigation/items', 'PUT', 'slimweb_nav_items_upsert', 'page_management_navbar', args);
  }

  async deleteNavItem(actor, args) {
    return this.catalogMutation(actor, `/navigation/items/${this.requiredId(args?.nav_item_id, 'nav_item_id')}`, 'DELETE', 'slimweb_nav_items_delete', 'page_management_navbar', {});
  }

  async listProducts(actor, args) {
    const filters = this.withoutSiteSelector(args);
    const query = new URLSearchParams();
    for (const field of ['category_id', 'keyword', 'status', 'max_stock', 'page', 'per_page']) {
      if (filters[field] !== undefined && filters[field] !== null && filters[field] !== '') {
        query.set(field, String(filters[field]));
      }
    }
    const suffix = `/catalog/products${query.size > 0 ? `?${query}` : ''}`;

    return this.request(this.sitePath(actor, suffix), {
      identity: actor,
      tool: 'slimweb_products_list',
      permission: 'product_management_products'
    });
  }

  async getProduct(actor, args) {
    return this.request(this.sitePath(actor, `/catalog/products/${this.requiredId(args?.product_id, 'product_id')}`), {
      identity: actor,
      tool: 'slimweb_products_get',
      permission: 'product_management_products'
    });
  }

  async prepareProductImageReference(actor, args) {
    return this.request(this.sitePath(actor, '/catalog/product-image-reference'), {
      method: 'POST',
      identity: actor,
      tool: 'slimweb_product_image_reference_prepare',
      body: this.withoutSiteSelector(args)
    });
  }

  async upsertProduct(actor, args) {
    return this.catalogMutation(actor, '/catalog/products', 'PUT', 'slimweb_products_upsert', 'product_management_products', args);
  }

  async deleteProduct(actor, args) {
    return this.catalogMutation(actor, `/catalog/products/${this.requiredId(args?.product_id, 'product_id')}`, 'DELETE', 'slimweb_products_delete', 'product_management_products', {});
  }

  async inspectProductImport(actor, args) {
    return this.request(this.sitePath(actor, '/catalog/imports/inspect'), {
      method: 'POST',
      identity: actor,
      tool: 'slimweb_products_import_inspect',
      permission: 'product_management_import',
      body: this.withoutSiteSelector(args)
    });
  }

  async validateProductImport(actor, args) {
    return this.request(this.sitePath(actor, '/catalog/imports/validate'), {
      method: 'POST',
      identity: actor,
      tool: 'slimweb_products_import_validate',
      permission: 'product_management_import',
      body: this.withoutSiteSelector(args)
    });
  }

  async commitProductImport(actor, args) {
    return this.catalogMutation(actor, '/catalog/imports/commit', 'POST', 'slimweb_products_import_commit', 'product_management_import', args);
  }

  async listArticles(actor, args) {
    const filters = this.withoutSiteSelector(args);
    const query = new URLSearchParams();
    for (const field of ['page', 'per_page']) {
      if (filters[field] !== undefined && filters[field] !== null && filters[field] !== '') query.set(field, String(filters[field]));
    }
    return this.request(this.sitePath(actor, `/content/articles${query.size ? `?${query}` : ''}`), {
      identity: actor,
      tool: 'slimweb_articles_list',
      permission: 'page_management_articles'
    });
  }

  async checkArticleTitle(actor, args) {
    const query = new URLSearchParams({ title: String(args?.title ?? '') });
    return this.request(this.sitePath(actor, `/content/articles/title-check?${query}`), {
      identity: actor,
      tool: 'slimweb_articles_check_title',
      permission: 'page_management_articles'
    });
  }

  async getArticleContent(actor, args) {
    return this.request(this.sitePath(actor, `/content/articles/${this.requiredId(args?.article_id, 'article_id')}`), {
      identity: actor,
      tool: 'slimweb_articles_get_content',
      permission: 'page_management_articles'
    });
  }

  async createArticle(actor, args) {
    return this.catalogMutation(actor, '/content/articles', 'PUT', 'slimweb_articles_create', 'page_management_articles', args);
  }

  async updateArticle(actor, args) {
    return this.catalogMutation(actor, '/content/articles', 'PUT', 'slimweb_articles_update', 'page_management_articles', args);
  }

  async deleteArticle(actor, args) {
    return this.catalogMutation(actor, `/content/articles/${this.requiredId(args?.article_id, 'article_id')}`, 'DELETE', 'slimweb_articles_delete', 'page_management_articles', {});
  }

  async listPages(actor) {
    return this.request(this.sitePath(actor, '/content/pages'), { identity: actor, tool: 'slimweb_pages_list', permission: 'page_management_pages' });
  }

  async checkPageTitle(actor, args) {
    const query = new URLSearchParams({ title: String(args?.title ?? '') });
    return this.request(this.sitePath(actor, `/content/pages/title-check?${query}`), { identity: actor, tool: 'slimweb_pages_check_title', permission: 'page_management_pages' });
  }

  async getPageContent(actor, args) {
    const query = new URLSearchParams({ name: String(args?.page_name ?? '') });
    return this.request(this.sitePath(actor, `/content/pages/resolve?${query}`), { identity: actor, tool: 'slimweb_pages_get_content', permission: 'page_management_pages' });
  }

  async createPage(actor, args) {
    return this.catalogMutation(actor, '/content/pages', 'PUT', 'slimweb_pages_create', 'page_management_pages', args);
  }

  async updatePage(actor, args) {
    return this.catalogMutation(actor, '/content/pages', 'PUT', 'slimweb_pages_update', 'page_management_pages', args);
  }

  async getPagePreviewUrl(actor, args) {
    return this.request(this.sitePath(actor, '/content/pages/preview'), { method: 'POST', identity: actor, tool: 'slimweb_preview_get_page_url', permission: 'page_management_pages', body: this.withoutSiteSelector(args) });
  }

  async deletePage(actor, args) {
    const key = String(args?.page_key ?? '').trim();
    if (!/^[a-z0-9][a-z0-9_-]{1,99}$/i.test(key)) throw new BackendError('page_key is invalid.', { code: 'VALIDATION_FAILED' });
    return this.catalogMutation(actor, `/content/pages/${encodeURIComponent(key)}`, 'DELETE', 'slimweb_pages_delete', 'page_management_pages', {});
  }

  async createUpload(actor, args) {
    return this.request(this.sitePath(actor, '/media/uploads'), {
      method: 'POST', identity: actor, tool: 'slimweb_uploads_create', body: this.withoutSiteSelector(args)
    });
  }

  async commitUpload(actor, args) {
    const uploadId = String(args?.upload_id ?? '').trim();
    if (!/^[A-Za-z0-9._-]{8,128}$/.test(uploadId)) throw new BackendError('upload_id is invalid.', { code: 'VALIDATION_FAILED' });
    return this.request(this.sitePath(actor, `/media/uploads/${encodeURIComponent(uploadId)}/commit`), {
      method: 'POST', identity: actor, tool: 'slimweb_uploads_commit', body: this.withoutSiteSelector(args)
    });
  }

  async listThemes(actor) {
    return this.request(this.sitePath(actor, '/themes'), { identity: actor, tool: 'slimweb_themes_list', permission: 'page_management_templates' });
  }

  async getSiteThemeMode(actor) {
    return this.request(this.sitePath(actor, '/theme-mode'), { identity: actor, tool: 'slimweb_site_theme_mode_get', permission: 'page_management_templates' });
  }

  async getDesignContext(actor) {
    return this.request(this.sitePath(actor, '/design-context'), { identity: actor, tool: 'slimweb_design_context_get', permission: 'page_management_templates' });
  }

  async updateSiteThemeMode(actor, args) {
    return this.themeMutation(actor, '/theme-mode', 'PATCH', 'slimweb_site_theme_mode_update', args);
  }

  async createThemeFromDefault(actor, args) {
    return this.themeMutation(actor, '/themes', 'POST', 'slimweb_themes_create_from_default', args);
  }

  async activateTheme(actor, args) {
    return this.themeMutation(actor, `/themes/${this.themeId(args)}/activate`, 'POST', 'slimweb_themes_activate', {});
  }

  async deleteTheme(actor, args) {
    return this.themeMutation(actor, `/themes/${this.themeId(args)}`, 'DELETE', 'slimweb_themes_delete', {});
  }

  async getThemeShellContext(actor, args) {
    return this.request(this.sitePath(actor, `/themes/${this.themeId(args)}/shell-context`), { identity: actor, tool: 'slimweb_theme_shell_get_context', permission: 'page_management_templates' });
  }

  async updateThemeRootElements(actor, args) {
    return this.themeMutation(actor, `/themes/${this.themeId(args)}/root-elements`, 'PUT', 'slimweb_themes_update_root_elements', args);
  }

  async getThemeStyleProfile(actor, args) {
    return this.request(this.sitePath(actor, `/themes/${this.themeId(args)}/style-profile`), { identity: actor, tool: 'slimweb_theme_style_profile_get', permission: 'page_management_templates' });
  }

  async upsertThemeStyleProfile(actor, args) {
    return this.themeMutation(actor, `/themes/${this.themeId(args)}/style-profile`, 'PUT', 'slimweb_theme_style_profile_upsert', args);
  }

  async appendThemeStyleProfileRequest(actor, args) {
    return this.themeMutation(actor, `/themes/${this.themeId(args)}/style-profile/requests`, 'POST', 'slimweb_theme_style_profile_append_request', args);
  }

  async themeMutation(actor, suffix, method, tool, args) {
    const body = this.withoutSiteSelector(args);
    delete body.theme_id;
    return this.request(this.sitePath(actor, suffix), { method, identity: actor, tool, permission: 'page_management_templates', idempotencyKey: this.idempotencyKeyFactory(), body });
  }

  themeId(args) {
    const value = typeof args?.theme_id === 'object' && args.theme_id !== null ? args.theme_id.id : args?.theme_id;
    if (String(value).toLowerCase() === 'default') return 'default';
    return String(this.requiredId(value, 'theme_id'));
  }

  async getMediaLibraryStats(actor, args) {
    const query = new URLSearchParams();
    if (args?.include_unused_assets !== undefined) query.set('include_unused_assets', String(Boolean(args.include_unused_assets)));
    return this.request(this.sitePath(actor, `/media/library/stats${query.size ? `?${query}` : ''}`), { identity: actor, tool: 'slimweb_media_library_stats' });
  }

  async deleteUnusedMedia(actor) {
    return this.request(this.sitePath(actor, '/media/library/unused'), { method: 'DELETE', identity: actor, tool: 'slimweb_media_library_delete_unused', idempotencyKey: this.idempotencyKeyFactory(), body: {} });
  }

  async registerAsset(actor, args) {
    return this.request(this.sitePath(actor, '/media/assets/register'), { method: 'POST', identity: actor, tool: 'slimweb_assets_upload', idempotencyKey: this.idempotencyKeyFactory(), body: this.withoutSiteSelector(args) });
  }

  async listExternalAssets(actor) {
    return this.request(this.sitePath(actor, '/external-assets'), { identity: actor, tool: 'slimweb_external_assets_list', permission: 'page_management_external_assets' });
  }

  async deleteExternalAsset(actor, args) {
    return this.request(this.sitePath(actor, `/external-assets/${this.requiredId(args?.asset_id, 'asset_id')}`), {
      method: 'DELETE', identity: actor, tool: 'slimweb_external_assets_delete', permission: 'page_management_external_assets', idempotencyKey: this.idempotencyKeyFactory(), body: {}
    });
  }

  async updateContentSeo(actor, args) {
    return this.request(this.sitePath(actor, '/content/seo'), {
      method: 'PUT', identity: actor, tool: 'slimweb_content_seo_update', idempotencyKey: this.idempotencyKeyFactory(), body: this.withoutSiteSelector(args)
    });
  }

  async importChatGptAttachment(actor, args) {
    return this.request(this.sitePath(actor, '/media/imports/chatgpt-attachment'), {
      method: 'POST', identity: actor, tool: 'slimweb_images_import_chatgpt_attachment', idempotencyKey: this.idempotencyKeyFactory(), body: this.withoutSiteSelector(args)
    });
  }

  async getPaymentLogisticsSettings(actor) {
    return this.request(this.sitePath(actor, '/commerce/settings/providers'), {
      identity: actor,
      tool: 'slimweb_payment_logistics_get',
      permission: 'payments_shipping'
    });
  }

  async updatePaymentLogisticsSettings(actor, args) {
    return this.request(this.sitePath(actor, '/commerce/settings/providers'), {
      method: 'PUT',
      identity: actor,
      tool: 'slimweb_payment_logistics_update',
      permission: 'payments_shipping',
      idempotencyKey: this.idempotencyKeyFactory(),
      body: this.withoutSiteSelector(args)
    });
  }

  async listCouponTemplates(actor, args) {
    return this.commerceList(actor, '/commerce/coupon-templates', 'slimweb_coupon_templates_list', 'coupon_management', args, ['issue_trigger', 'keyword', 'status', 'page', 'per_page']);
  }

  async upsertCouponTemplate(actor, args) {
    return this.commerceMutation(actor, '/commerce/coupon-templates', 'PUT', 'slimweb_coupon_templates_upsert', 'coupon_management', args);
  }

  async issueMemberCoupon(actor, args) {
    return this.commerceMutation(actor, `/commerce/members/${this.requiredId(args?.member_id, 'member_id')}/coupons`, 'POST', 'slimweb_members_coupons_issue', 'coupon_management', args, ['member_id']);
  }

  async listMembers(actor, args) {
    return this.commerceList(actor, '/commerce/members', 'slimweb_members_list', 'member_list', args, ['keyword', 'status', 'min_spent', 'max_spent', 'page', 'per_page']);
  }

  async getMember(actor, args) {
    return this.request(this.sitePath(actor, `/commerce/members/${this.requiredId(args?.member_id, 'member_id')}`), { identity: actor, tool: 'slimweb_members_get', permission: 'member_list' });
  }

  async deleteMember(actor, args) {
    return this.commerceMutation(actor, `/commerce/members/${this.requiredId(args?.member_id, 'member_id')}`, 'DELETE', 'slimweb_members_delete', 'member_list', args, ['member_id']);
  }

  async revokeMemberCoupon(actor, args) {
    return this.commerceMutation(actor, `/commerce/members/${this.requiredId(args?.member_id, 'member_id')}/coupons/${this.requiredId(args?.member_coupon_id, 'member_coupon_id')}`, 'DELETE', 'slimweb_members_coupons_revoke', 'member_list', args, ['member_id', 'member_coupon_id']);
  }

  async listDiscountCodes(actor, args) {
    return this.commerceList(actor, '/commerce/discount-codes', 'slimweb_discount_codes_list', 'discount_code_management', args, ['keyword', 'platform', 'page', 'per_page']);
  }

  async upsertDiscountCode(actor, args) {
    return this.commerceMutation(actor, '/commerce/discount-codes', 'PUT', 'slimweb_discount_codes_upsert', 'discount_code_management', args);
  }

  async deleteDiscountCode(actor, args) {
    return this.commerceMutation(actor, `/commerce/discount-codes/${this.requiredId(args?.discount_code_id, 'discount_code_id')}`, 'DELETE', 'slimweb_discount_codes_delete', 'discount_code_management', args, ['discount_code_id']);
  }

  async listMemberTiers(actor) {
    return this.request(this.sitePath(actor, '/commerce/member-tiers'), { identity: actor, tool: 'slimweb_member_tiers_list', permission: 'member_levels' });
  }

  async upsertMemberTier(actor, args) {
    return this.commerceMutation(actor, '/commerce/member-tiers', 'PUT', 'slimweb_member_tiers_upsert', 'member_levels', args);
  }

  async deleteMemberTier(actor, args) {
    return this.commerceMutation(actor, `/commerce/member-tiers/${this.requiredId(args?.member_tier_id, 'member_tier_id')}`, 'DELETE', 'slimweb_member_tiers_delete', 'member_levels', args, ['member_tier_id']);
  }

  async commerceList(actor, suffix, tool, permission, args, fields) {
    const filters = this.withoutSiteSelector(args);
    const query = new URLSearchParams();
    for (const field of fields) {
      if (filters[field] !== undefined && filters[field] !== null && filters[field] !== '') query.set(field, String(filters[field]));
    }
    return this.request(this.sitePath(actor, `${suffix}${query.size ? `?${query}` : ''}`), { identity: actor, tool, permission });
  }

  async commerceMutation(actor, suffix, method, tool, permission, args, removedFields = []) {
    const body = this.withoutSiteSelector(args);
    for (const field of removedFields) delete body[field];
    return this.request(this.sitePath(actor, suffix), { method, identity: actor, tool, permission, idempotencyKey: this.idempotencyKeyFactory(), body });
  }

  async catalogMutation(actor, suffix, method, tool, permission, args) {
    return this.request(this.sitePath(actor, suffix), {
      method,
      identity: actor,
      tool,
      permission,
      idempotencyKey: this.idempotencyKeyFactory(),
      body: this.withoutSiteSelector(args)
    });
  }

  sitePath(actor, suffix = '') {
    const siteCode = String(actor?.site?.site_code ?? '').trim();
    if (siteCode === '') {
      throw new BackendError('The resolved site has no site_code.', {
        code: 'UPSTREAM_INVALID_RESPONSE'
      });
    }

    return `/internal/mcp/v1/sites/${encodeURIComponent(siteCode)}${suffix}`;
  }

  withoutSiteSelector(args) {
    const { site_id: _siteId, site_code: _siteCode, ...body } = args ?? {};
    return body;
  }

  requiredId(value, field) {
    const id = Number.parseInt(value, 10);
    if (!Number.isInteger(id) || id < 1) {
      throw new BackendError(`${field} must be a positive integer.`, {
        code: 'VALIDATION_FAILED'
      });
    }

    return id;
  }

  settingsPath(actor) {
    return this.sitePath(actor, '/settings/basic');
  }

  async request(pathname, options = {}) {
    const requestId = String(this.requestIdFactory());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = {
      accept: 'application/json',
      'X-SlimWeb-MCP-Secret': this.secret,
      'X-SlimWeb-Actor-Sub': String(
        options.identity?.google_id
          ?? options.identity?.google_sub
          ?? ''
      ),
      'X-SlimWeb-Actor-Email': String(options.identity?.email ?? ''),
      'X-SlimWeb-Tool': String(options.tool ?? ''),
      'X-Request-Id': requestId
    };
    if (options.permission) {
      headers['X-SlimWeb-Permission'] = String(options.permission);
    }
    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = String(options.idempotencyKey);
    }
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${pathname}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new BackendError('Webless Backend API request timed out.', {
          code: 'UPSTREAM_TIMEOUT',
          requestId,
          cause: error
        });
      }

      throw new BackendError('Webless Backend API request failed.', {
        code: 'UPSTREAM_FAILED',
        requestId,
        cause: error
      });
    } finally {
      clearTimeout(timeout);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new BackendError('Webless Backend API returned invalid JSON.', {
        code: 'UPSTREAM_INVALID_RESPONSE',
        status: response.status,
        requestId: response.headers.get('x-request-id') ?? requestId,
        cause: error
      });
    }

    if (!response.ok) {
      const fallbackCodes = {
        401: 'UNAUTHENTICATED',
        403: 'FORBIDDEN',
        404: 'NOT_FOUND',
        409: 'CONFLICT',
        422: 'VALIDATION_FAILED',
        429: 'RATE_LIMITED'
      };
      throw new BackendError(
        String(payload?.error?.message ?? 'Webless Backend API rejected the request.'),
        {
          code: payload?.error?.code ?? fallbackCodes[response.status] ?? 'UPSTREAM_FAILED',
          status: response.status,
          details: payload?.error?.details ?? {},
          requestId: payload?.request_id ?? response.headers.get('x-request-id') ?? requestId
        }
      );
    }

    if (payload?.ok !== true || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new BackendError('Webless Backend API returned an invalid response envelope.', {
        code: 'UPSTREAM_INVALID_RESPONSE',
        status: response.status,
        requestId: response.headers.get('x-request-id') ?? requestId
      });
    }

    return payload.data;
  }
}
