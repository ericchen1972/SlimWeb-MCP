import { SlimWebBackendRepository } from '@slimweb/mcp-core/backend-repository';

import { WeblessBackendTransport } from './backends/weblessBackendTransport.js';
import { WeblessOAuthStore } from './backends/weblessOAuthStore.js';

export function createSaasContext(options = {}) {
  if (options.accountRepository) {
    return { accountRepository: options.accountRepository };
  }

  const backendBaseUrl = options.weblessBackendApiBaseUrl
    ?? process.env.WEBLESS_BACKEND_API_BASE_URL
    ?? '';
  const transport = options.backendTransport ?? (
    String(backendBaseUrl).trim() !== ''
      ? new WeblessBackendTransport({
          baseUrl: backendBaseUrl,
          secret: options.weblessMcpSecret ?? process.env.WEBLESS_MCP_SECRET,
          fetchImpl: options.fetchImpl
        })
      : {
          async request() {
            const error = new Error('Webless backend API is required.');
            error.code = 'UPSTREAM_NOT_CONFIGURED';
            throw error;
          }
        }
  );

  return {
    accountRepository: new SlimWebBackendRepository({ transport }),
    humanApprovalTransport: options.humanApprovalTransport ?? {
      bootstrap: input => transport.request({method:'POST',path:'/internal/mcp/v1/human-approvals/bootstrap',body:{...input,target:'saas'}}),
      preview: ({human_ticket}) => transport.request({method:'POST',path:'/internal/mcp/v1/human-approvals/preview',body:{human_ticket}}),
      decide: ({human_ticket,decision}) => transport.request({method:'POST',path:'/internal/mcp/v1/human-approvals/decide',body:{human_ticket,decision}})
    },
    oauthStore: options.oauthStore ?? new WeblessOAuthStore(transport)
  };
}
