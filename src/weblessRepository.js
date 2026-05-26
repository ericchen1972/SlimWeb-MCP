import pg from 'pg';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const { Pool } = pg;
const MAX_ASSET_BYTES = 10 * 1024 * 1024;

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
    this.storageRoot = options.storageRoot ?? process.env.WEBLESS_STORAGE_ROOT ?? '';
    this.publicSiteBaseUrl = (options.publicSiteBaseUrl ?? process.env.WEBLESS_PUBLIC_BASE_URL ?? 'https://slimweb.tw').replace(/\/+$/, '');
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

  async listSitesForAccount(accountId) {
    const result = await this.pool.query(
      `
        select id, slug, name, domain, status, site_status
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
      status: site.status,
      site_status: site.site_status
    }));
  }

  async selectSiteForAccount(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const themes = await this.listThemesForSite(site.id);

    return {
      selected_site: site,
      themes,
      requires_site_id_for_mutations: true
    };
  }

  async getPagePreviewUrl(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const pageKey = normalizePageKey(args.page_key ?? 'index');
    const theme = await this.resolveThemeForSite(site.id, args.theme_id);
    const url = new URL(`${this.publicSiteBaseUrl}/sites/${encodeURIComponent(site.slug)}/default-preview`);

    url.searchParams.set('mcp_site_id', String(site.id));
    url.searchParams.set('mcp_page_key', pageKey);
    url.searchParams.set('mcp_theme_id', String(theme.id));

    return {
      site,
      page_key: pageKey,
      theme,
      url: url.toString(),
      mode: args.mode === 'published' ? 'published' : 'preview',
      supports_theme_parameter: false
    };
  }

  async getHomeContent(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const theme = await this.resolveThemeForSite(site.id, args.theme_id);
    const storagePath = homeContentStoragePath(site.id, theme);
    const absolutePath = this.absoluteStoragePath(storagePath);
    const html = await readFile(absolutePath, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') {
        return null;
      }

      throw error;
    });

    return {
      site,
      page_key: 'index',
      theme,
      storage_path: storagePath,
      content: html === null ? null : { html },
      exists: html !== null
    };
  }

  async updateHomeContent(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const theme = await this.resolveThemeForSite(site.id, args.theme_id);
    const html = extractHtmlContent(args.content);
    const storagePath = homeContentStoragePath(site.id, theme);
    const absolutePath = this.absoluteStoragePath(storagePath);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, html.trim() + '\n', 'utf8');

    return {
      ok: true,
      site,
      page_key: 'index',
      theme,
      replacement_mode: args.replacement_mode ?? 'replace_all',
      storage_path: storagePath,
      bytes_written: Buffer.byteLength(html.trim() + '\n')
    };
  }

  async uploadAsset(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const theme = await this.resolveThemeForSite(site.id, args.theme_id);
    const { bytes, mimeType } = await resolveAssetSource(args.source);
    const filename = safeAssetFilename(args.suggested_filename, mimeType);
    const storagePath = templateAssetStoragePath(theme, `assets/mcp/${Date.now()}-${filename}`);
    const absolutePath = this.absoluteStoragePath(storagePath);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);

    return {
      ok: true,
      site,
      theme,
      target_usage: args.target_usage,
      asset_scope: args.asset_scope,
      target_id: args.target_id ?? null,
      alt_text: args.alt_text ?? '',
      mime_type: mimeType,
      storage_path: storagePath,
      public_url: `${this.publicSiteBaseUrl}/sites/${encodeURIComponent(site.slug)}/template-assets/${theme.id}/assets/mcp/${path.basename(storagePath)}`
    };
  }

  async getSiteForAccount(accountId, siteId) {
    const result = await this.pool.query(
      `
        select id, slug, name, domain, status, site_status
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
      status: site.status,
      site_status: site.site_status
    };
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

  absoluteStoragePath(storagePath) {
    if (!this.storageRoot) {
      throw codedError('UPSTREAM_NOT_CONFIGURED', 'WEBLESS_STORAGE_ROOT is required for page and asset write tools.', {
        env: 'WEBLESS_STORAGE_ROOT'
      });
    }

    const absoluteRoot = path.resolve(this.storageRoot);
    const absolutePath = path.resolve(absoluteRoot, storagePath);

    if (!absolutePath.startsWith(absoluteRoot + path.sep)) {
      throw codedError('VALIDATION_FAILED', 'Invalid storage path.');
    }

    return absolutePath;
  }
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
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(value).trim() === '') {
    throw codedError('VALIDATION_FAILED', `${name} must be a positive integer.`);
  }

  return parsed;
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

function formatTheme(theme) {
  return {
    id: theme.id,
    site_id: theme.site_id,
    name: theme.name,
    is_default: Boolean(theme.is_default),
    is_active: Boolean(theme.is_active),
    theme_mode: theme.is_default ? 'light' : (theme.theme_mode || 'light')
  };
}

function themeDirectory(theme) {
  return theme.is_default
    ? `sites/${theme.site_id}/templates/default`
    : `sites/${theme.site_id}/templates/schemes/${theme.id}`;
}

function homeContentStoragePath(siteId, theme) {
  const filename = theme.is_default ? 'content.blade.php' : 'body.blade.php';

  return `${themeDirectory({ ...theme, site_id: siteId })}/pages/index/${filename}`;
}

function templateAssetStoragePath(theme, relativePath) {
  return `${themeDirectory(theme)}/${relativePath.replace(/^\/+/, '')}`;
}

function extractHtmlContent(content) {
  const html = typeof content?.html === 'string'
    ? content.html
    : (typeof content?.body_html === 'string' ? content.body_html : '');

  if (html.trim() === '') {
    throw codedError('VALIDATION_FAILED', 'content.html or content.body_html is required.');
  }

  if (/<\s*(script|link|iframe)\b/i.test(html) || /\son[a-z]+\s*=/i.test(html)) {
    throw codedError('UNSAFE_CONTENT', 'Homepage content cannot include script/link/iframe tags or inline event handlers. Use external asset tools for CSS/JS.');
  }

  return html;
}

async function resolveAssetSource(source) {
  if (!source || typeof source !== 'object') {
    throw codedError('VALIDATION_FAILED', 'source is required.');
  }

  if (typeof source.data_base64 === 'string' && source.data_base64.trim() !== '') {
    const bytes = Buffer.from(source.data_base64, 'base64');
    if (bytes.length > MAX_ASSET_BYTES) {
      throw codedError('VALIDATION_FAILED', 'Asset is too large.');
    }

    return {
      bytes,
      mimeType: source.mime_type || 'application/octet-stream'
    };
  }

  const url = source.image_url || source.file_url;
  if (typeof url === 'string' && url.trim() !== '') {
    const response = await fetch(url);
    if (!response.ok) {
      throw codedError('VALIDATION_FAILED', `Unable to download asset: HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    if (bytes.length > MAX_ASSET_BYTES) {
      throw codedError('VALIDATION_FAILED', 'Asset is too large.');
    }

    return {
      bytes,
      mimeType: response.headers.get('content-type') || source.mime_type || 'application/octet-stream'
    };
  }

  throw codedError('VALIDATION_FAILED', 'source.data_base64, source.image_url, or source.file_url is required for upload.');
}

function safeAssetFilename(suggestedFilename, mimeType) {
  const fallbackExtension = mimeTypeExtension(mimeType);
  const raw = String(suggestedFilename || `asset.${fallbackExtension}`).trim();
  const basename = path.basename(raw).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

  if (!basename) {
    return `asset.${fallbackExtension}`;
  }

  return path.extname(basename) ? basename : `${basename}.${fallbackExtension}`;
}

function mimeTypeExtension(mimeType) {
  if (/png/i.test(mimeType)) {
    return 'png';
  }

  if (/jpe?g/i.test(mimeType)) {
    return 'jpg';
  }

  if (/webp/i.test(mimeType)) {
    return 'webp';
  }

  if (/gif/i.test(mimeType)) {
    return 'gif';
  }

  if (/css/i.test(mimeType)) {
    return 'css';
  }

  return 'bin';
}
