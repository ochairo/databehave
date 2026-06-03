# `server` and `basePath`

## `server`

```jsonc
"server": {
  "host": "${MOCK_SERVER_HOST:127.0.0.1}",
  "port": "${MOCK_SERVER_PORT:8000}"
}
```

`host` defaults to `127.0.0.1`, `port` to `3000`. The CLI reads this
section; the programmatic API ignores it (you pass `listen({ host,
port })` directly).

## `basePath`

```jsonc
"basePath": "/api/v1"
```

Automatically prepended to every `endpoints` key that does NOT start
with `/` after the method. Must start with `/` and must not end with
`/`. OpenAPI paths are left untouched — they already carry their full
path in the OAS document.

```jsonc
"endpoints": {
  "GET products/list": "./src/list.js",  // → /api/v1/products/list
  "GET /health":              "./src/health.js" // → /health (absolute)
}
```
