# 400 — Malformed request

`requestValidationPlugin` could not parse a declared JSON request body, or the body stream failed or was aborted
while being read. The response uses `application/problem+json` with `status: 400` and a diagnostic `detail`.

Send valid JSON with `Content-Type: application/json` and complete the upload. If JSON is valid, inspect client
cancellation or upload failures. An empty required body instead produces [422](request-validation.md), and exceeding
the byte limit produces [413](payload-too-large.md). JSON parsing also applies when the declaration has no schema.

See [request validation](../../packages/openapi/README.md) for composition and body handling.
