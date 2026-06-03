# `cors`

```jsonc
"cors": {
  "origin": ["https://app.example.com", "https://admin.example.com"],
  "credentials": true,
  "exposeHeaders": ["x-mock-status"],
  "allowMethods": ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  "allowHeaders": ["content-type", "authorization"],
  "maxAge": 86400
}
```

All fields optional. When the `cors` section is present, @databehave/server
handles `OPTIONS` preflight for every declared route and attaches
CORS headers on every response.

## `cors.origin`

`origin` accepts:

- **omitted** — the loader installs a reflector that echoes the
  request `Origin` back (or `*` when the request has none).
- **`string`** — single allowed origin. Treated as a one-entry
  allowlist.
- **`string[]`** — explicit allowlist. The request `Origin` is matched
  case-insensitively against the list; only an exact match is echoed
  back. Off-allowlist requests get an empty `Access-Control-Allow-Origin`
  value, which the response builder omits entirely (the de-facto
  reject signal — no header is sent).

```jsonc
"cors": {
  "origin": "https://app.example.com",        // single origin
  "credentials": true
}
```

```jsonc
"cors": {
  "origin": ["https://app.example.com", "https://staging.example.com"],
  "credentials": true
}
```

For a fully custom reflector (e.g. regex matching), use the
programmatic API — `cors.origin` there accepts a `(o: string) => string`
function.

## `Vary: Origin`

Whenever the `cors` section is present, the response decorator adds
`Vary: Origin` to every response (preflight included). This prevents
reverse proxies and CDNs from caching one origin's response and serving
it to another after the body diverges on the request `Origin`.

When a handler also sets `Vary` (e.g. `Vary: Accept-Encoding`), the two
values are **merged additively**, not replaced. Tokens are deduplicated
case-insensitively, the first occurrence's casing is preserved, and a
literal `*` short-circuits to just `*` (HTTP semantic: "varies on every
possible header").

```ts
// Handler returns Vary: Accept-Encoding
// CORS adds      Vary: Origin
// On the wire    Vary: Accept-Encoding, Origin
```

Other CORS response headers (`Access-Control-Allow-Origin`,
`Access-Control-Allow-Credentials`, `Access-Control-Expose-Headers`)
follow the standard "handler wins" merge rule — only `Vary` is
additive.
