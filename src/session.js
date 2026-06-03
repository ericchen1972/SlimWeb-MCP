import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'swmcp_session';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createSignedToken(payload, secret) {
  if (!secret) {
    throw new Error('MCP_SESSION_SECRET is required.');
  }

  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);

  return `${encodedPayload}.${signature}`;
}

export function verifySignedToken(token, secret) {
  if (!token || !secret || !token.includes('.')) {
    return null;
  }

  const [encodedPayload, signature] = token.split('.', 2);
  const expected = sign(encodedPayload, secret);

  if (!safeEqual(signature, expected)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function createSessionToken(account, secret, now = Date.now()) {
  const payload = {
    account_id: account.id ?? account.account_id ?? null,
    email: account.email,
    name: account.name,
    google_id: account.google_id ?? account.google_sub ?? null,
    site_id: account.site_id ?? null,
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + DEFAULT_TTL_SECONDS
  };

  return createSignedToken(payload, secret);
}

export function verifySessionToken(token, secret, now = Date.now()) {
  const payload = verifySignedToken(token, secret);
  if (!payload || !payload.exp || payload.exp < Math.floor(now / 1000)) {
    return null;
  }

  return payload;
}

export function readSessionToken(request) {
  const authorization = request.headers.authorization ?? '';
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }

  const cookieHeader = request.headers.cookie ?? '';
  const cookies = cookieHeader.split(';').map((part) => part.trim());
  const cookie = cookies.find((part) => part.startsWith(`${COOKIE_NAME}=`));

  return cookie ? decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1)) : '';
}

export function sessionCookie(token, secure = true) {
  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${DEFAULT_TTL_SECONDS}`
  ];

  if (secure) {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}
