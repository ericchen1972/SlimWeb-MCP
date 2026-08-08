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

  settingsPath(actor) {
    const siteCode = String(actor?.site?.site_code ?? '').trim();
    if (siteCode === '') {
      throw new BackendError('The resolved site has no site_code.', {
        code: 'UPSTREAM_INVALID_RESPONSE'
      });
    }

    return `/internal/mcp/v1/sites/${encodeURIComponent(siteCode)}/settings/basic`;
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
