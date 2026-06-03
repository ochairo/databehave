# Overrides

## Matchers

```jsonc
{ "kind": "exact",  "method": "POST", "path": "/api/v1/example" }  // METHOD + path
{ "kind": "path",   "path":   "/api/v1/example" }                  // any method
{ "kind": "global" }                                                // every route
```

Resolution priority (first match wins): `exact` → `path` → `global`.

## Sticky override resolution

For each request, the dispatcher consults sources in this order — first
hit wins:

1. `x-mock-*` request headers (per-request, never stored).
2. Sticky `exact` override (METHOD + path).
3. Sticky `path` override (any method).
4. Sticky `global` override.
5. Existing `mockMode` resolution (see [../config/mock-mode.md](../config/mock-mode.md)).
6. Passthrough — the real handler runs.
