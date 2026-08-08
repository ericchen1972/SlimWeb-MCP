import { SLIMWEB_BACKEND_METHODS } from './backends/slimWebBackend.js';

export class WeblessAccountRepository {
  constructor(_unusedPool, options = {}) {
    this.backendClient = options.backendClient ?? null;
  }

  requireBackendClient(capability) {
    if (!this.backendClient) {
      const error = new Error(`Webless backend API is required for ${capability}.`);
      error.code = 'UPSTREAM_NOT_CONFIGURED';
      throw error;
    }

    return this.backendClient;
  }

  async upsertGoogleAccount(profile) {
    return {
      id: null,
      google_id: profile.sub,
      email: profile.email,
      name: profile.name
    };
  }

  async listAdminSitesForGoogleProfile(profile) {
    return this.listSitesForAdminIdentity({
      email: profile.email,
      name: profile.name,
      google_id: profile.sub,
      resource_context: profile.resource_context ?? null
    });
  }

  async listThemesForAccountSite(actor, args) {
    return this.requireBackendClient('listThemes').listThemes(actor, args);
  }

  async uploadAsset(actor, args) {
    return this.requireBackendClient('registerAsset').registerAsset(actor, args);
  }
}

for (const method of SLIMWEB_BACKEND_METHODS) {
  if (typeof WeblessAccountRepository.prototype[method] === 'function') continue;

  Object.defineProperty(WeblessAccountRepository.prototype, method, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: async function backendOperation(actor, args) {
      return this.requireBackendClient(method)[method](actor, args);
    }
  });
}
