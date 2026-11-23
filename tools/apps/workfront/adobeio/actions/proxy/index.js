/*
 * Copyright 2026 Adobe Systems Incorporated
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* eslint-env node */
/* global globalThis */
/* eslint-disable no-underscore-dangle -- I/O Runtime passes the raw request as __ow_* params. */
const ALLOWED_METHODS = 'GET, POST, PUT, OPTIONS';
const ALLOWED_HEADERS = 'Authorization, Content-Type';
const API_PATH = /^\/attask\/api\/v\d+\.\d+\//;
// raw-http passes form bodies as plain strings and JSON bodies base64-encoded.
const FORM_BODY = /^application\/x-www-form-urlencoded\s*(;|$)/i;
const JSON_BODY = /^application\/json\s*(;|$)/i;

function parseOrigins(value = '') {
  return value.split(',').map((origin) => origin.trim()).filter(Boolean);
}

function isAllowedOrigin(origin, allowed) {
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

function reject(statusCode, message, origin) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...(origin ? corsHeaders(origin) : {}) },
    body: JSON.stringify({ error: { message } }),
  };
}

function decodeBody(body, contentType = '') {
  if (FORM_BODY.test(contentType)) return body;
  if (JSON_BODY.test(contentType)) return Buffer.from(body, 'base64');
  return null;
}

async function main(params) {
  const headers = params.__ow_headers || {};
  const method = (params.__ow_method || 'get').toUpperCase();
  const { origin } = headers;
  const corsOrigin = isAllowedOrigin(origin, parseOrigins(params.ALLOWED_ORIGINS)) ? origin : null;

  if (!corsOrigin) return reject(403, 'Origin not allowed.');
  if (method === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(corsOrigin) };
  if (!['GET', 'POST', 'PUT'].includes(method)) return reject(405, 'Method not allowed.', corsOrigin);

  let upstreamUrl;
  try {
    upstreamUrl = new URL(new URL(params.WORKFRONT_ORIGIN).origin);
  } catch {
    return reject(500, 'The proxy is not configured.', corsOrigin);
  }
  // Setting pathname keeps the tenant host and resolves "..", so the final path is checked.
  upstreamUrl.pathname = params.__ow_path || '/';
  if (!API_PATH.test(upstreamUrl.pathname)) return reject(404, 'Not found.', corsOrigin);
  if (params.__ow_query) upstreamUrl.search = params.__ow_query;

  if (!/^Bearer \S+$/.test(headers.authorization || '')) {
    return reject(401, 'A bearer token is required.', corsOrigin);
  }
  const forwarded = { authorization: headers.authorization };
  if (headers['content-type']) forwarded['content-type'] = headers['content-type'];
  if (headers.accept) forwarded.accept = headers.accept;

  let body;
  if (method !== 'GET' && params.__ow_body) {
    body = decodeBody(params.__ow_body, headers['content-type']);
    if (body === null) return reject(415, 'Only form or JSON request bodies are supported.', corsOrigin);
  }

  let upstream;
  try {
    upstream = await globalThis.fetch(upstreamUrl, {
      method,
      headers: forwarded,
      body,
      redirect: 'manual',
    });
  } catch {
    return reject(502, 'Workfront could not be reached.', corsOrigin);
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    return reject(502, 'Workfront returned an unexpected redirect.', corsOrigin);
  }

  return {
    statusCode: upstream.status,
    headers: {
      ...corsHeaders(corsOrigin),
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
      'Cache-Control': 'no-store',
    },
    body: await upstream.text(),
  };
}

module.exports = { main, isAllowedOrigin };
