import { createHash, randomUUID } from 'node:crypto';

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

export class WeblessBackendTransport {
  constructor({ baseUrl, secret, fetchImpl = fetch, timeoutMs = 15_000, requestIdFactory = randomUUID } = {}) {
    this.baseUrl = String(baseUrl ?? '').trim().replace(/\/+$/, '');
    this.secret = String(secret ?? '').trim();
    if (this.baseUrl === '') throw new TypeError('WeblessBackendTransport baseUrl is required.');
    if (this.secret === '') throw new TypeError('WeblessBackendTransport secret is required.');
    this.fetch = fetchImpl;
    this.timeoutMs = Math.max(1, Number(timeoutMs) || 15_000);
    this.requestIdFactory = requestIdFactory;
  }

  async request({ method = 'GET', path, identity, tool, permission, body, idempotencyKey }) {
    method = method.toUpperCase();
    const servicePath = /^\/internal\/mcp\/v1\/(?:version|actor-grants\/(?:bootstrap|exchange|revoke)|human-approvals\/(?:bootstrap|preview|decide)|oauth-state\/[a-z_]+\/[a-f0-9]{64})$/.test(path);
    if (!servicePath && !identity?.backend_grant) {
      throw new BackendError('A verified backend identity grant is required.', {code:'UNAUTHENTICATED',status:401});
    }
    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    let assertion;
    if (!servicePath) {
      const proof = await this.request({method:'POST',path:'/internal/mcp/v1/actor-grants/exchange',tool:'actor_proof',body:{
        backend_grant:identity.backend_grant,method,path,
        body_hash:createHash('sha256').update(serializedBody ?? '').digest('hex')
      }});
      if (typeof proof.assertion !== 'string' || proof.assertion === '') {
        throw new BackendError('Backend identity proof is unavailable.', {code:'UPSTREAM_INVALID_RESPONSE',status:503});
      }
      assertion = proof.assertion;
    }
    const requestId = String(this.requestIdFactory());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = {
      accept: 'application/json',
      'X-SlimWeb-MCP-Secret': this.secret,
      'X-SlimWeb-Tool': String(tool ?? ''),
      'X-Request-Id': requestId
    };
    if (assertion) headers['X-SlimWeb-Actor-Assertion'] = assertion;
    if (permission) headers['X-SlimWeb-Permission'] = String(permission);
    if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey);
    if (body !== undefined) headers['content-type'] = 'application/json';

    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: serializedBody,
        redirect: 'manual',
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new BackendError('Webless Backend API request timed out.', { code: 'UPSTREAM_TIMEOUT', requestId, cause: error });
      }
      throw new BackendError('Webless Backend API request failed.', { code: 'UPSTREAM_FAILED', requestId, cause: error });
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
      throw new BackendError(String(payload?.error?.message ?? 'Webless Backend API rejected the request.'), {
        code: payload?.error?.code ?? fallbackCodes[response.status] ?? 'UPSTREAM_FAILED',
        status: response.status,
        details: payload?.error?.details ?? {},
        requestId: payload?.request_id ?? response.headers.get('x-request-id') ?? requestId
      });
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

  bootstrapIdentity({credential}) {
    return this.request({method:'POST',path:'/internal/mcp/v1/actor-grants/bootstrap',tool:'actor_bootstrap',body:{credential,target:'saas'}});
  }

  revokeIdentityGrant(identity) {
    return this.request({method:'POST',path:'/internal/mcp/v1/actor-grants/revoke',tool:'actor_revoke',body:{backend_grant:identity.backend_grant}});
  }
}
