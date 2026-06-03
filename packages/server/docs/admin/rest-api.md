# REST endpoints

All paths are relative to `${admin.path}` (default `/databehave`).
Successful POSTs return `201`; missing scenarios return `404`.

| Method   | Path                              | Body                              | Response                                |
| -------- | --------------------------------- | --------------------------------- | --------------------------------------- |
| `GET`    | `{path}`                          | —                                 | UI HTML (also `{path}/`)                |
| `GET`    | `{path}/ui.js`                    | —                                 | UI script bundle                        |
| `GET`    | `{path}/ui.css`                   | —                                 | UI stylesheet                           |
| `GET`    | `{path}/openapi-routes`           | —                                 | `{ routes: {method,path,summary?,source}[], discoveredAt }` (merged: OAS + hand-written handlers; OAS wins on duplicates; `source` is `'openapi'` or `'handler'`) |
| `GET`    | `{path}/openapi.json`             | —                                 | Raw OpenAPI JSON document (only when configured; `404` otherwise) |
| `GET`    | `{path}/overrides`                | —                                 | `{ overrides: StickyOverride[] }`       |
| `POST`   | `{path}/overrides`                | `{ matcher, mode, description? }` | `201 { id, override }`                  |
| `DELETE` | `{path}/overrides`                | —                                 | `{ cleared: N }`                        |
| `DELETE` | `{path}/overrides/:id`            | —                                 | `200` or `404`                          |
| `GET`    | `{path}/scenarios`                | —                                 | `{ scenarios: [{ name, count, created }] }` |
| `POST`   | `{path}/scenarios`                | `{ name, overrides? }`            | `201 { scenario }` (snapshots current if `overrides` omitted) |
| `GET`    | `{path}/scenarios/:name`          | —                                 | `{ scenario: { name, overrides[] } }` or `404` |
| `DELETE` | `{path}/scenarios/:name`          | —                                 | `200` or `404`                          |
| `POST`   | `{path}/scenarios/:name/load`     | —                                 | `{ loaded: N }` or `404`                |

Curl examples:

```sh
# add a sticky 500 to one route
curl -sS -X POST http://127.0.0.1:8000/databehave/overrides \
  -H 'content-type: application/json' \
  -d '{"matcher":{"kind":"exact","method":"GET","path":"/api/v1/health"},"mode":{"kind":"http-status","status":500}}'

# list active overrides
curl -sS http://127.0.0.1:8000/databehave/overrides

# clear everything
curl -sS -X DELETE http://127.0.0.1:8000/databehave/overrides

# save the current overrides as a scenario, then load it
curl -sS -X POST http://127.0.0.1:8000/databehave/scenarios \
  -H 'content-type: application/json' -d '{"name":"all-500"}'
curl -sS -X POST http://127.0.0.1:8000/databehave/scenarios/all-500/load
```

## Caching

`GET {path}/openapi.json` is served with `Cache-Control: no-store`.
The OpenAPI document is the contract the admin UI's route picker
displays — caching is incorrect when the JSONC config is reloaded
between requests in dev.

`GET {path}/openapi-routes` (the merged OAS + hand-written list) is
freshly assembled per request and unconditionally non-cacheable;
no caching headers are emitted.

## Error envelope

Admin REST responses use a single error shape:

```jsonc
{ "error": "<machine code>", "detail": "<human-readable, optional>" }
```

| Status | Example body | When |
| ------ | ------------ | --- |
| `400`  | `{"error":"invalid_json"}` | POST body could not be parsed as JSON. |
| `400`  | `{"error":"validation_failed","detail":"matcher.kind must be 'exact'"}` | Body parsed but failed schema validation. |
| `404`  | `{"error":"not_found"}` | Scenario name / override id missing. |
| `405`  | `{"error":"method_not_allowed"}` | Path matched but method is not registered. |
| `500`  | `{"error":"internal_error","detail":"<message>"}` | Unhandled exception in admin code (the message is the underlying `Error.message`). |

The envelope is identical to the [non-admin error envelope](../errors.md)
so a single client-side handler can decode both kinds of responses.

## `400 invalid x-mock-* header`

When admin-mode is enabled with `headers: true` (the default) and a
request carries an `x-mock-*` header that fails parsing, the inject
hook returns `400` **before** the underlying route runs:

```text
HTTP/1.1 400 Bad Request
content-type: application/json
x-mock-injected: header-error

{"error":"invalid x-mock-* header","detail":"<parse error>"}
```

The `x-mock-injected: header-error` response header is the
observability signal that the rejection came from header parsing
rather than the user's handler returning a 400 of its own — see
[headers.md#x-mock-injected-response-header](./headers.md#x-mock-injected-response-header).
