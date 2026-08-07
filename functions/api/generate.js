// Cloudflare Pages Function — proxies script-generation requests to the Anthropic
// Messages API. Ported from the old Netlify function (a bare proxy) with guards
// added: origin check, optional access code, payload caps, and a clear error when
// the API key is missing. model and max_tokens are fixed server-side so a caller
// can't inflate them through the request body.

const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 1200;
const ANTHROPIC_VERSION = '2023-06-01';

const MAX_BODY_BYTES = 20 * 1024; // ~20KB
const MAX_MESSAGES = 4;

const json = (status, obj) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const error = (status, message) => json(status, { error: { message } });

export async function onRequestPost(context) {
  const { request, env } = context;

  // 1. Origin check. Compare Origin (falling back to Referer) against the request
  //    URL's own host. A missing header is allowed through so non-browser testing
  //    still works; a present-but-mismatched header is rejected.
  const originHeader = request.headers.get('Origin') || request.headers.get('Referer');
  if (originHeader) {
    let originHost;
    try {
      originHost = new URL(originHeader).host;
    } catch {
      return error(403, 'Bad origin.');
    }
    if (originHost !== new URL(request.url).host) {
      return error(403, 'Forbidden origin.');
    }
  }

  // 2. Optional access code. Only enforced when ACCESS_CODE is set; otherwise the
  //    link stays open by default.
  if (env.ACCESS_CODE) {
    if (request.headers.get('x-cutscript-code') !== env.ACCESS_CODE) {
      return error(401, 'Access code required.');
    }
  }

  // 3. Payload caps.
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return error(413, 'Payload too large.');
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return error(400, 'Invalid JSON.');
  }

  const messages = body && body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return error(400, 'messages must be a non-empty array.');
  }
  if (messages.length > MAX_MESSAGES) {
    return error(400, `Too many messages (max ${MAX_MESSAGES}).`);
  }
  for (const msg of messages) {
    if (!msg || typeof msg.role !== 'string' || typeof msg.content !== 'string') {
      return error(400, 'Each message needs a role and string content.');
    }
  }

  // 4. Missing key. Fail clearly rather than letting the upstream call return a
  //    confusing error.
  if (!env.ANTHROPIC_API_KEY) {
    return error(500, 'Server is missing ANTHROPIC_API_KEY.');
  }

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages,
    }),
  });

  const data = await upstream.json();
  // Pass upstream's status through on failure.
  return json(upstream.status, data);
}

// Catch-all for any non-POST method so a stray GET returns a clean 405 rather
// than a 404. Pages routes POST to onRequestPost above; everything else lands here.
export function onRequest() {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'POST' },
  });
}
