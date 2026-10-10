# 413 — Payload too large

The declared request body exceeded `requestValidationPlugin({ maxBodyBytes })`. The default limit is 102400 UTF-8
bytes. The limit is enforced while reading, before JSON parsing, and overflow cancels the request streams before EOF.
The response uses `application/problem+json` with `status: 413`.

Reduce the body or explicitly configure a larger limit if the API requires it. `maxBodyBytes` must be a nonnegative
safe integer; zero permits only empty bodies. Character count may differ from UTF-8 byte count. The Node transport
closes an incomplete upload's connection after the rejection, so clients must not assume that connection is reusable.

See [request validation](../../packages/openapi/README.md) and [Node body handling](../../packages/server/README.md).
