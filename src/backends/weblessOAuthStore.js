/** Shared state lives in the backend database cache, never this process. */
export class WeblessOAuthStore {
  constructor(transport) {
    this.transport = transport;
  }

  async request(method, kind, key, body) {
    const data = await this.transport.request({
      method,
      path: `/internal/mcp/v1/oauth-state/${encodeURIComponent(kind)}/${encodeURIComponent(key)}`,
      tool: 'oauth_state',
      body
    });
    return data.value;
  }

  put(kind, key, value, expiresAt) {
    return this.request('PUT', kind, key, { value, expires_at: expiresAt });
  }

  get(kind, key) {
    return this.request('GET', kind, key);
  }

  take(kind, key) {
    return this.request('DELETE', kind, key);
  }
}
