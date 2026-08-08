import { WeblessBackendClient } from './backends/weblessBackendClient.js';
import { WeblessAccountRepository } from './weblessRepository.js';

export function createSaasContext(options = {}) {
  if (options.accountRepository) {
    return { accountRepository: options.accountRepository };
  }

  const backendBaseUrl = options.weblessBackendApiBaseUrl
    ?? process.env.WEBLESS_BACKEND_API_BASE_URL
    ?? '';
  const backendClient = options.backendClient ?? (
    String(backendBaseUrl).trim() !== ''
      ? new WeblessBackendClient({
          baseUrl: backendBaseUrl,
          secret: options.weblessMcpSecret ?? process.env.WEBLESS_MCP_SECRET
        })
      : null
  );

  return {
    accountRepository: new WeblessAccountRepository(undefined, { backendClient })
  };
}
