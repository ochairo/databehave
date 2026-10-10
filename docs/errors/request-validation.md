# 422 — Request validation failed

The request was readable but failed the operation's OpenAPI conformance rules. Examples include a missing required
body or parameter, an incorrect type, an out-of-range value or a string constraint violation.
The response uses `application/problem+json` with `status: 422` and a `violations` array.

Inspect each violation's `path`, `keyword` and diagnostic `message`, then correct the request or the API declaration.
Body validation preserves JSON types; query, path and header parameters are coerced to their declared primitive types
before checking. Required-body presence is enforced even when no body schema is declared. Regex patterns require a
finite nonnegative integer `maxLength` on the same schema node; overlong values fail the length check before matching.

See [request validation](../../packages/openapi/README.md). Malformed JSON produces [400](malformed-body.md) instead.
