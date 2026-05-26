const SERVICE_NAME = 'slimweb-mcp';
const SERVICE_VERSION = '0.1.0';

function jsonResponse(response, statusCode, payload) {
  const body = JSON.stringify(payload);

  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  response.end(body);
}

function notFound(response) {
  jsonResponse(response, 404, {
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found'
    }
  });
}

function methodNotAllowed(response) {
  jsonResponse(response, 405, {
    ok: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: 'Method not allowed'
    }
  });
}

async function readJsonRequest(request) {
  let rawBody = '';

  for await (const chunk of request) {
    rawBody += chunk;

    if (rawBody.length > 1024 * 1024) {
      const error = new Error('Request body too large');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
  }

  if (rawBody.trim() === '') {
    return {};
  }

  return JSON.parse(rawBody);
}

function mcpResult(id, result) {
  return {
    jsonrpc: '2.0',
    id,
    result
  };
}

function mcpError(id, code, message) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message
    }
  };
}

function handleMcpMessage(message) {
  const id = message?.id ?? null;

  switch (message?.method) {
    case 'initialize':
      return mcpResult(id, {
        protocolVersion: '2025-03-26',
        capabilities: {
          tools: {
            listChanged: false
          }
        },
        serverInfo: {
          name: SERVICE_NAME,
          version: SERVICE_VERSION
        }
      });

    case 'tools/list':
      return mcpResult(id, {
        tools: []
      });

    default:
      return mcpError(id, -32601, `Unknown MCP method: ${message?.method ?? 'undefined'}`);
  }
}

async function handleMcp(request, response) {
  if (request.method !== 'POST') {
    methodNotAllowed(response);
    return;
  }

  try {
    const message = await readJsonRequest(request);
    jsonResponse(response, 200, handleMcpMessage(message));
  } catch (error) {
    const code = error.code === 'BODY_TOO_LARGE' ? -32000 : -32700;
    const message = error.code === 'BODY_TOO_LARGE' ? error.message : 'Invalid JSON request body';

    jsonResponse(response, 200, mcpError(null, code, message));
  }
}

function handleServiceInfo(response) {
  jsonResponse(response, 200, {
    ok: true,
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    status: 'ready'
  });
}

export function createRequestHandler() {
  return async function requestHandler(request, response) {
    const url = new URL(request.url, 'http://localhost');

    if (url.pathname === '/' || url.pathname === '/healthz' || url.pathname === '/readyz') {
      if (request.method !== 'GET') {
        methodNotAllowed(response);
        return;
      }

      handleServiceInfo(response);
      return;
    }

    if (url.pathname === '/mcp') {
      await handleMcp(request, response);
      return;
    }

    notFound(response);
  };
}
