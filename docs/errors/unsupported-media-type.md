# 415 — Unsupported media type

An operation declares a JSON-only request body, but the request supplies a nonempty `Content-Type` other than
`application/json`. `requestValidationPlugin` returns `application/problem+json` with `status: 415` before reading
the body. Media type parameters such as `; charset=utf-8` are ignored for this comparison.

Send `Content-Type: application/json` with valid JSON, or correct the OpenAPI media declaration when the operation
actually accepts another format. The current guard applies to JSON-only declarations; it is not a general media
negotiation implementation. A missing content type can still enter JSON parsing and produce
[400](malformed-body.md) for malformed JSON.

See [request validation](../../packages/openapi/README.md).
