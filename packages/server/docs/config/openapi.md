# `openapi`

Path (relative to the config file) to an OpenAPI 3.x document.
**JSON only** — convert YAML first via `yq -o=json openapi.yaml > openapi.json`.
When set, the walker registers fallback handlers for every
`paths.*.<method>` not declared in `endpoints`.

See [../openapi/fallback.md](../openapi/fallback.md) for walker behaviour.
