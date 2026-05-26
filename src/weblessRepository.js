import pg from 'pg';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const { Pool } = pg;
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

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

  async listThemesForAccountSite(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const themes = await this.listThemesForSite(site.id);

    return {
      site,
      themes
    };
  }

  async createThemeFromDefault(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const name = requireThemeName(args.name);
    const themeMode = normalizeThemeMode(args.theme_mode);

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
        [site.id, name, themeMode, sortOrder]
      );
      const theme = formatTheme(result.rows[0]);

      await this.copyDefaultTemplateToTheme(site.id, theme.id);
      await this.pool.query('COMMIT');

      return {
        site,
        theme,
        copied_from_default: true,
        source_theme: 'Default',
        preview_url: this.previewUrlFor(site, 'index', theme.id)
      };
    } catch (error) {
      await this.pool.query('ROLLBACK');
      throw error;
    }
  }

  async updateThemeRootElements(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const theme = await this.resolveThemeForSite(site.id, args.theme_id);

    if (theme.is_default) {
      throw codedError('VALIDATION_FAILED', 'Default theme root elements cannot be modified through this tool. Create a non-Default theme first.');
    }

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
      preview_url: this.previewUrlFor(site, 'index', theme.id)
    };
  }

  async getPagePreviewUrl(accountId, args) {
    const site = await this.getSiteForAccount(accountId, requireInteger(args.site_id, 'site_id'));
    const pageKey = normalizePageKey(args.page_key ?? 'index');
    const theme = await this.resolveThemeForSite(site.id, args.theme_id);
    const url = new URL(this.previewUrlFor(site, pageKey, theme.id));

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
    const html = await this.storage.readText(storagePath);

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

    await this.storage.write(storagePath, Buffer.from(html.trim() + '\n', 'utf8'), 'text/x-php; charset=utf-8');

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

    await this.storage.write(storagePath, bytes, mimeType);

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
      let targetPath = `${targetDirectory}/${relativePath}`;

      const bodyMatch = relativePath.match(/^pages\/([^/]+)\/content\.blade\.php$/);
      if (bodyMatch) {
        targetPath = `${targetDirectory}/pages/${bodyMatch[1]}/body.blade.php`;
      }

      const bytes = await this.storage.readBytes(sourcePath);
      if (bytes !== null) {
        await this.storage.write(targetPath, bytes, contentTypeForPath(targetPath));
      }
    }
  }

  previewUrlFor(site, pageKey, themeId) {
    const url = new URL(`${this.publicSiteBaseUrl}/sites/${encodeURIComponent(site.slug)}/default-preview`);

    url.searchParams.set('mcp_site_id', String(site.id));
    url.searchParams.set('mcp_page_key', pageKey);
    url.searchParams.set('mcp_theme_id', String(themeId));
    url.searchParams.set('preview_page', pageKey);
    url.searchParams.set('preview_style_scheme', String(themeId));

    return url.toString();
  }

}

export function createStorageAdapter(options = {}) {
  const driver = (options.storageDriver ?? process.env.WEBLESS_STORAGE_DRIVER ?? (options.gcsBucket || process.env.GCS_BUCKET ? 'gcs' : 'local')).toLowerCase();

  if (driver === 'gcs') {
    return new GcsStorageAdapter({
      bucket: options.gcsBucket ?? process.env.GCS_BUCKET,
      fetchImpl: options.fetchImpl
    });
  }

  return new LocalStorageAdapter({
    root: options.storageRoot ?? process.env.WEBLESS_STORAGE_ROOT ?? ''
  });
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
  constructor({ bucket, fetchImpl = fetch }) {
    this.bucket = bucket;
    this.fetch = fetchImpl;
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

function requireThemeName(value) {
  const name = String(value ?? '').trim();

  if (name.length < 2 || name.length > 80) {
    throw codedError('VALIDATION_FAILED', 'name must be between 2 and 80 characters.');
  }

  return name;
}

function normalizeThemeMode(value) {
  const mode = String(value ?? 'light').trim();

  if (!['light', 'dark', 'system'].includes(mode)) {
    throw codedError('VALIDATION_FAILED', 'theme_mode must be light, dark, or system.');
  }

  return mode;
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

  return extractSafeHtml(html, 'content.html or content.body_html');
}

function extractSafeHtml(html, name) {
  if (typeof html !== 'string' || html.trim() === '') {
    throw codedError('VALIDATION_FAILED', `${name} is required.`);
  }

  if (/<\s*(script|link|iframe)\b/i.test(html) || /\son[a-z]+\s*=/i.test(html)) {
    throw codedError('UNSAFE_CONTENT', 'HTML content cannot include script/link/iframe tags or inline event handlers. Use external asset tools for CSS/JS.');
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
