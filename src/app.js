import { GoogleIdentityVerifier } from './googleVerifier.js';
import { createSessionToken, readSessionToken, sessionCookie, verifySessionToken } from './session.js';
import { WeblessAccountRepository } from './weblessRepository.js';

const SERVICE_NAME = 'slimweb-mcp';
const SERVICE_VERSION = '0.1.0';

function jsonResponse(response, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);

  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers
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

function htmlResponse(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  response.end(body);
}

function mcpResult(id, result) {
  return {
    jsonrpc: '2.0',
    id,
    result
  };
}

function mcpError(id, code, message, data = undefined) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data ? { data } : {})
    }
  };
}

function mcpJsonContent(json) {
  return {
    content: [
      {
        type: 'json',
        json
      }
    ]
  };
}

async function toolResultForCall(message, request, context) {
  const name = message?.params?.name;
  const session = verifySessionToken(readSessionToken(request), context.sessionSecret);

  if (!session) {
    return mcpError(message?.id ?? null, -32001, 'Authentication required.', {
      reason: 'AUTH_REQUIRED',
      login_url: context.publicBaseUrl ? `${context.publicBaseUrl}/auth/login` : '/auth/login'
    });
  }

  switch (name) {
    case 'slimweb.auth.status':
      return mcpResult(message.id ?? null, mcpJsonContent({
        authenticated: true,
        account: {
          id: session.account_id,
          email: session.email,
          name: session.name,
          google_id: session.google_id
        }
      }));

    case 'slimweb.sites.list': {
      const sites = await context.accountRepository.listSitesForAccount(session.account_id);

      return mcpResult(message.id ?? null, mcpJsonContent({
        account_id: session.account_id,
        sites
      }));
    }

    default:
      return mcpError(message?.id ?? null, -32601, `Unknown MCP tool: ${name ?? 'undefined'}`);
  }
}

async function handleMcpMessage(message, request, context) {
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
        tools: [
          {
            name: 'slimweb.auth.status',
            description: 'Return the authenticated SlimWeb MCP account status.'
          },
          {
            name: 'slimweb.sites.list',
            description: 'List SlimWeb sites available to the authenticated account.'
          }
        ]
      });

    case 'tools/call':
      return toolResultForCall(message, request, context);

    default:
      return mcpError(id, -32601, `Unknown MCP method: ${message?.method ?? 'undefined'}`);
  }
}

async function handleMcp(request, response, context) {
  if (request.method !== 'POST') {
    methodNotAllowed(response);
    return;
  }

  try {
    const message = await readJsonRequest(request);
    jsonResponse(response, 200, await handleMcpMessage(message, request, context));
  } catch (error) {
    const code = error.code === 'BODY_TOO_LARGE' ? -32000 : -32700;
    const message = error.code === 'BODY_TOO_LARGE' ? error.message : 'Invalid JSON request body';

    jsonResponse(response, 200, mcpError(null, code, message));
  }
}

function loginPage(context) {
  const clientId = context.googleClientId;

  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SlimWeb MCP 登入</title>
  <script src="https://accounts.google.com/gsi/client" async defer></script>
</head>
<body>
  <main style="max-width: 420px; margin: 64px auto; font-family: system-ui, sans-serif;">
    <h1>SlimWeb MCP 登入</h1>
    <p>請使用 SlimWeb / Webless 平台帳號的 Google 帳號登入。</p>
    <div id="google-signin"></div>
  </main>
  <script>
    function handleCredentialResponse(response) {
      fetch('/auth/google', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credential: response.credential })
      }).then(function(result) {
        if (!result.ok) throw new Error('login failed');
        window.location.href = '/auth/success';
      }).catch(function() {
        alert('登入失敗，請重新再試。');
      });
    }

    window.onload = function() {
      google.accounts.id.initialize({
        client_id: '${clientId}',
        callback: handleCredentialResponse
      });
      google.accounts.id.renderButton(document.getElementById('google-signin'), {
        theme: 'outline',
        size: 'large'
      });
    };
  </script>
</body>
</html>`;
}

async function handleGoogleLogin(request, response, context) {
  if (request.method !== 'POST') {
    methodNotAllowed(response);
    return;
  }

  try {
    const body = await readJsonRequest(request);
    const profile = await context.googleVerifier.verify(body.credential);
    const account = await context.accountRepository.upsertGoogleAccount(profile);
    const token = createSessionToken(account, context.sessionSecret);
    const sites = await context.accountRepository.listSitesForAccount(account.id);

    jsonResponse(response, 200, {
      ok: true,
      account: {
        id: account.id,
        email: account.email,
        name: account.name
      },
      sites,
      session: {
        token_type: 'Bearer',
        access_token: token
      }
    }, {
      'set-cookie': sessionCookie(token, context.secureCookies)
    });
  } catch (error) {
    jsonResponse(response, 401, {
      ok: false,
      error: {
        code: error.code ?? 'LOGIN_FAILED',
        message: error.message
      }
    });
  }
}

function handleAuthSuccess(request, response, context) {
  const session = verifySessionToken(readSessionToken(request), context.sessionSecret);

  if (!session) {
    response.writeHead(302, { location: '/auth/login' });
    response.end();
    return;
  }

  htmlResponse(response, 200, `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>SlimWeb MCP 已登入</title></head>
<body>
  <main style="max-width: 520px; margin: 64px auto; font-family: system-ui, sans-serif;">
    <h1>已登入 SlimWeb MCP</h1>
    <p>帳號：${session.email}</p>
    <p>你現在可以回到 AI Client 繼續使用 SlimWeb MCP。</p>
  </main>
</body>
</html>`);
}

function handleServiceInfo(response) {
  jsonResponse(response, 200, {
    ok: true,
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    status: 'ready'
  });
}

function createDefaultContext(options = {}) {
  return {
    googleClientId: options.googleClientId ?? process.env.GOOGLE_CLIENT_ID ?? '27587628711-upin8ch154kqrl88k41978q660oc0pbg.apps.googleusercontent.com',
    googleVerifier: options.googleVerifier ?? new GoogleIdentityVerifier(options),
    accountRepository: options.accountRepository ?? new WeblessAccountRepository(),
    sessionSecret: options.sessionSecret ?? process.env.MCP_SESSION_SECRET,
    publicBaseUrl: options.publicBaseUrl ?? process.env.PUBLIC_BASE_URL ?? '',
    secureCookies: options.secureCookies ?? process.env.NODE_ENV === 'production'
  };
}

export function createRequestHandler(options = {}) {
  const context = createDefaultContext(options);

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

    if (url.pathname === '/auth/login') {
      if (request.method !== 'GET') {
        methodNotAllowed(response);
        return;
      }

      htmlResponse(response, 200, loginPage(context));
      return;
    }

    if (url.pathname === '/auth/google') {
      await handleGoogleLogin(request, response, context);
      return;
    }

    if (url.pathname === '/auth/success') {
      if (request.method !== 'GET') {
        methodNotAllowed(response);
        return;
      }

      handleAuthSuccess(request, response, context);
      return;
    }

    if (url.pathname === '/mcp') {
      await handleMcp(request, response, context);
      return;
    }

    notFound(response);
  };
}
