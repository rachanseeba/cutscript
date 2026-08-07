# CutScript

A single-page web app for generating hairstyling instruction sheets. The entire
client is one static file, `index.html` (~43KB), with a small serverless function
that proxies requests to the Anthropic API so the API key never reaches the browser.

## Deploying to Cloudflare Pages

This repo deploys as a [Cloudflare Pages](https://developers.cloudflare.com/pages/)
project with a Pages Function.

**Build settings:**

| Setting            | Value  |
| ------------------ | ------ |
| Framework preset   | None   |
| Build command      | *(none)* |
| Build output directory | `/` |

There's no build step — Pages serves `index.html` at the root and automatically
wires up any files under `functions/` as
[Pages Functions](https://developers.cloudflare.com/pages/functions/).

**Environment variables** (set under Pages → Settings → Environment variables):

| Variable            | Required | Purpose |
| ------------------- | -------- | ------- |
| `ANTHROPIC_API_KEY` | Yes      | Anthropic API key used server-side by the function. |
| `ACCESS_CODE`       | No       | If set, callers must send a matching `x-cutscript-code` header or get a 401. Leave unset to keep the link open. |

## File layout

```
index.html              # the whole app (client)
functions/
  api/
    generate.js         # Cloudflare Pages Function → POST /api/generate
```

`functions/api/generate.js` exports `onRequestPost` (the proxy) and `onRequest`
(a catch-all returning 405 for non-POST). It enforces an origin check, the
optional access code, payload caps (~20KB body, non-empty `messages` array of at
most 4 entries, each with a `role` and string `content`), and pins `model` and
`max_tokens` server-side so a caller can't override them.

## Warnings

- **Supabase RLS must be verified before sharing the link.** `SUPABASE_URL` and
  `SUPABASE_ANON_KEY` are hardcoded in `index.html` (around lines 706–707). That's
  fine by design — the anon key is meant to be public — *but only if Row Level
  Security is enabled* on the `clients` and `consultations` tables. Without RLS,
  anyone with the key can read or write those tables. The Supabase project hasn't
  been touched since February 2026, so confirm RLS is on before the link goes out.

- **The origin check is a speed bump, not rate limiting.** It stops casual
  cross-site use of the function but does nothing to cap how often a single client
  can call it. For a widely shared link, add a KV or D1 binding to the Pages project
  and count requests per IP to throttle abuse.
