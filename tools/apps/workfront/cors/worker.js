const ALLOWED_METHODS = 'GET, POST, PUT, OPTIONS';
const ALLOWED_HEADERS = 'Authorization, Content-Type';
const FORWARDED_HEADERS = ['authorization', 'content-type', 'accept'];
const API_PATH = /^\/attask\/api\/v\d+\.\d+\//;

function parseOrigins(value = '') {
  return value.split(',').map((origin) => origin.trim()).filter(Boolean);
}

export function isAllowedOrigin(origin, allowed) {
  if (!origin) return false;
  return allowed.some((pattern) => {
    if (pattern === origin) return true;
    if (!pattern.includes('*')) return false;
    // "*" matches exactly one hostname label, e.g. https://*.aem.page
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+');
    return new RegExp(`^${escaped}$`, 'i').test(origin);
  });
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function reject(status, message, origin) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...(origin ? corsHeaders(origin) : {}) },
  });
}

export default {
  async fetch(request, env) {
    const target = new URL(env.WORKFRONT_ORIGIN);
    const origin = request.headers.get('Origin');
    const corsOrigin = isAllowedOrigin(origin, parseOrigins(env.ALLOWED_ORIGINS)) ? origin : null;

    if (!corsOrigin) return reject(403, 'Origin not allowed.');

    if (request.method === 'OPTIONS') {
      const headers = corsHeaders(corsOrigin);
      // Chrome's Local Network Access: required when a public page calls a localhost proxy.
      if (request.headers.get('Access-Control-Request-Private-Network') === 'true') {
        headers['Access-Control-Allow-Private-Network'] = 'true';
      }
      return new Response(null, { status: 204, headers });
    }

    if (!['GET', 'POST', 'PUT'].includes(request.method)) {
      return reject(405, 'Method not allowed.', corsOrigin);
    }

    const url = new URL(request.url);
    if (!API_PATH.test(url.pathname)) return reject(404, 'Not found.', corsOrigin);

    const upstreamUrl = new URL(`${url.pathname}${url.search}`, target.origin);
    const headers = new Headers();
    FORWARDED_HEADERS.forEach((name) => {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    });

    let upstream;
    try {
      upstream = await fetch(upstreamUrl, {
        method: request.method,
        headers,
        body: request.method === 'GET' ? undefined : request.body,
        redirect: 'manual',
      });
    } catch {
      return reject(502, 'Workfront could not be reached.', corsOrigin);
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      return reject(502, 'Workfront returned an unexpected redirect.', corsOrigin);
    }

    const responseHeaders = new Headers(corsHeaders(corsOrigin));
    const contentType = upstream.headers.get('Content-Type');
    if (contentType) responseHeaders.set('Content-Type', contentType);
    responseHeaders.set('Cache-Control', 'no-store');

    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  },
};
