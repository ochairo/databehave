# 401 — Unauthorized

The request did not satisfy any declared OpenAPI security requirement. `requestValidationPlugin` checks credential
presence and the expected scheme shape; it does not verify token authenticity or implement authorization.
The response uses `application/problem+json` with `status: 401` and may include `WWW-Authenticate`.

Check the operation's effective `security` declaration and provide the required headers, query parameters or cookies.
Alternatives in the security array are OR choices; schemes within one requirement must all be satisfied.
Do not use this mock conformance check as production authentication.

See [request validation](../../packages/openapi/README.md).
