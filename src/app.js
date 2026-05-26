import { GoogleIdentityVerifier } from './googleVerifier.js';
import { createSessionToken, readSessionToken, sessionCookie, verifySessionToken } from './session.js';
import { WeblessAccountRepository } from './weblessRepository.js';

const SERVICE_NAME = 'slimweb-mcp';
const SERVICE_VERSION = '0.1.0';
const EMPTY_INPUT_SCHEMA = {
  type: 'object',
  properties: {}
};
const MCP_TOOLS = [
  {
    name: 'slimweb.auth.status',
    description: 'Return the authenticated SlimWeb MCP account status.',
    inputSchema: EMPTY_INPUT_SCHEMA
  },
  {
    name: 'slimweb.sites.list',
    description: 'List SlimWeb sites available to the authenticated account.',
    inputSchema: EMPTY_INPUT_SCHEMA
  },
  {
    name: 'slimweb.site.select',
    description: 'Validate and return a SlimWeb site selected from slimweb.sites.list. Use this before write operations when the user owns multiple sites.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'integer',
          description: 'Stable SlimWeb site ID selected from slimweb.sites.list.'
        }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb.assets.upload',
    description: 'Upload or register a reusable asset such as an image for page, theme, product, or site use. Use returned URLs/paths in page content instead of embedding file bytes.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'integer',
          description: 'Target SlimWeb site ID.'
        },
        source: {
          type: 'object',
          description: 'Image or file source. Provide exactly one of attachment_ref, image_url, file_url, data_ref, or data_base64.',
          properties: {
            attachment_ref: { type: 'string' },
            image_url: { type: 'string' },
            file_url: { type: 'string' },
            data_ref: { type: 'string' },
            data_base64: { type: 'string' },
            mime_type: { type: 'string' }
          }
        },
        theme_id: {
          type: ['integer', 'string'],
          description: 'Optional target theme/page scheme. Omit to use the active theme.'
        },
        target_usage: {
          type: 'string',
          enum: ['reference', 'home_page', 'custom_page', 'theme_asset', 'product_image', 'brand_asset']
        },
        asset_scope: {
          type: 'string',
          enum: ['site', 'theme', 'page', 'product']
        },
        target_id: {
          type: ['integer', 'string'],
          description: 'Optional stable target ID, such as page ID, theme ID, or product ID.'
        },
        suggested_filename: {
          type: 'string'
        },
        alt_text: {
          type: 'string'
        }
      },
      required: ['site_id', 'source', 'target_usage', 'asset_scope']
    }
  },
  {
    name: 'slimweb.pages.get_home_content',
    description: 'Read the current homepage content for a site, including Default/theme context.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'integer'
        },
        theme_id: {
          type: ['integer', 'string'],
          description: 'Optional target theme. Omit for currently active theme context.'
        },
        include_default: {
          type: 'boolean',
          description: 'Include Default homepage content when reading a non-Default theme.'
        }
      },
      required: ['site_id']
    }
  },
  {
    name: 'slimweb.pages.update_home_content',
    description: 'Replace homepage content using structured page content and uploaded assets. Do not include script/link tags; manage external CSS/JS with external asset tools.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'integer'
        },
        theme_id: {
          type: ['integer', 'string'],
          description: 'Target theme. Use Default only for allowed homepage content edits.'
        },
        content: {
          type: 'object',
          description: 'Structured homepage content. Do not include script/link tags; use external asset tools for CSS/JS.'
        },
        replacement_mode: {
          type: 'string',
          enum: ['replace_all', 'patch_sections']
        },
        confirmation_token: {
          type: 'string'
        }
      },
      required: ['site_id', 'content']
    }
  },
  {
    name: 'slimweb.preview.get_page_url',
    description: 'Return a preview URL for a page with explicit site, theme, and page parameters so the AI can inspect the page visually before editing.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'integer'
        },
        page_key: {
          type: 'string',
          description: 'Page identifier such as home, about, or a custom page slug.'
        },
        theme_id: {
          type: ['integer', 'string']
        },
        mode: {
          type: 'string',
          enum: ['published', 'preview']
        }
      },
      required: ['site_id', 'page_key']
    }
  }
];

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

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

function toolArgs(message) {
  return message?.params?.arguments && typeof message.params.arguments === 'object'
    ? message.params.arguments
    : {};
}

function toolExceptionToMcpError(id, error) {
  const codeByReason = {
    VALIDATION_FAILED: -32602,
    NOT_FOUND: -32002,
    UPSTREAM_NOT_CONFIGURED: -32005,
    UPSTREAM_ERROR: -32007,
    UNSAFE_CONTENT: -32006,
    NOT_IMPLEMENTED: -32004
  };
  const reason = error.code ?? 'TOOL_FAILED';
  const code = codeByReason[reason] ?? -32000;

  return mcpError(id, code, error.message || 'MCP tool failed.', {
    reason,
    ...(error.data && typeof error.data === 'object' ? error.data : {})
  });
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

    case 'slimweb.site.select': {
      try {
        const result = await context.accountRepository.selectSiteForAccount(session.account_id, toolArgs(message));

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb.assets.upload': {
      try {
        const result = await context.accountRepository.uploadAsset(session.account_id, toolArgs(message));

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb.pages.get_home_content': {
      try {
        const result = await context.accountRepository.getHomeContent(session.account_id, toolArgs(message));

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb.pages.update_home_content': {
      try {
        const result = await context.accountRepository.updateHomeContent(session.account_id, toolArgs(message));

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
    }

    case 'slimweb.preview.get_page_url': {
      try {
        const result = await context.accountRepository.getPagePreviewUrl(session.account_id, toolArgs(message));

        return mcpResult(message.id ?? null, mcpJsonContent(result));
      } catch (error) {
        return toolExceptionToMcpError(message?.id ?? null, error);
      }
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
        tools: MCP_TOOLS
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
      }).then(async function(result) {
        if (!result.ok) {
          const payload = await result.json().catch(function() { return {}; });
          const message = payload.error && payload.error.message ? payload.error.message : '登入失敗，請重新再試。';
          throw new Error(message);
        }
        window.location.href = '/auth/success';
      }).catch(function(error) {
        alert('登入失敗：' + error.message);
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
    console.warn('mcp_google_login_failed', {
      code: error.code ?? 'LOGIN_FAILED',
      message: error.message
    });

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
  const token = readSessionToken(request);
  const session = verifySessionToken(token, context.sessionSecret);

  if (!session) {
    response.writeHead(302, { location: '/auth/login' });
    response.end();
    return;
  }

  htmlResponse(response, 200, `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SlimWeb MCP 已登入</title>
</head>
<body>
  <main style="max-width: 760px; margin: 64px auto; font-family: system-ui, sans-serif; line-height: 1.6;">
    <h1>已登入 SlimWeb MCP</h1>
    <p>帳號：${escapeHtml(session.email)}</p>
    <p>如果你的 AI Client 不會自動共享瀏覽器 Cookie，請把下面的 token 設定到 MCP server 的 Bearer token 欄位。</p>
    <label for="mcp-token" style="display:block; font-weight: 700; margin-top: 24px;">Bearer token</label>
    <textarea id="mcp-token" readonly rows="7" style="box-sizing: border-box; width: 100%; margin-top: 8px; padding: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px;">${escapeHtml(token)}</textarea>
    <button type="button" id="copy-token" style="margin-top: 12px; padding: 10px 14px; border: 0; border-radius: 6px; background: #111827; color: white; cursor: pointer;">複製 Token</button>
    <p id="copy-status" style="color: #047857;"></p>
    <p style="margin-top: 24px;">MCP URL：</p>
    <pre style="padding: 12px; background: #f3f4f6; overflow:auto;">${escapeHtml(context.publicBaseUrl || '')}/mcp</pre>
    <p>請保管這個 token。任何取得 token 的人都能以你的 SlimWeb MCP 身份操作可用 tools。</p>
  </main>
  <script>
    document.getElementById('copy-token').addEventListener('click', async function() {
      const value = document.getElementById('mcp-token').value;
      await navigator.clipboard.writeText(value);
      document.getElementById('copy-status').textContent = '已複製';
    });
  </script>
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
