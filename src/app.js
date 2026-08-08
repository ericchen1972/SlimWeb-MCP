import { createRequestHandler as createCoreRequestHandler } from '@slimweb/mcp-core';

import { createSaasContext } from './saasContext.js';

export function createRequestHandler(options = {}) {
  return createCoreRequestHandler({
    ...createSaasContext(options),
    ...options
  });
}
