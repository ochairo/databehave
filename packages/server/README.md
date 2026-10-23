# @databehave/server

HTTP contracts and explicit HTTP plugins for Databehave. The package has no schema,
OpenAPI, admin, UI-build or CLI dependency.

```ts
import { createHost } from '@databehave/core'
import {
  httpPlugin, routesPlugin, corsPlugin, accessLogPlugin, nodeHttpPlugin,
} from '@databehave/server'

const host = createHost({ plugins: [
  httpPlugin(),
  routesPlugin({ 'GET /hello': () => ({ status: 200, json: { hello: 'world' } }) }),
  corsPlugin({ origin: () => '*' }),
  accessLogPlugin(),
  nodeHttpPlugin({ host: '127.0.0.1', port: 3000 }),
] })
await host.start()
// await host.close() when the application shuts down.
```

For in-process requests, omit the listener and call
`host.get(httpCapability).fetch(new Request('http://localhost/hello'))` after startup.

External plugins declare `requires: [httpCapability]` and register route sources,
middleware or bind guards during `setup`. Pass `ctx.order` as the contribution order;
this preserves explicit composition order independently of capability dependency order.
Route sources materialize once after every plugin has prepared. Explicit routes replace
generated routes with the same key; equal-priority duplicates fail with both owners.
Exact paths precede parameterized paths. Parameterized ties use composition order and
then declaration order.

`http.resolveRoute(method, path)` uses the same precedence and HEAD fallback as dispatch. A route contribution's
`cors` field can override application CORS, or be `false` when its owner supplies the policy. General CORS only
handles resolved routes; preflights resolve the `Access-Control-Request-Method` target. Unknown paths receive no
implicit CORS authorization. This keeps feature-owned admin restrictions effective in either composition order.

The middleware pipeline runs preflight, validation, interception, the selected handler,
response decoration, and final observation. Short circuits and error responses receive
decoration once. Error handlers are bounded; an error-handler failure yields a generic
500. Observation cannot replace a response. HEAD calls an explicit HEAD handler or GET
fallback once, retains `request.method === 'HEAD'`, exposes `effectiveMethod`, and strips
the body after decoration. One request produces one observation.

`terminateTransport()` produces a terminal transport outcome for Node listeners.
Fetch cannot destroy a connection and reports `UnsupportedTransportError`. Request
signals cancel on disconnect or host shutdown. Dispatch is admitted only after HTTP's open
phase and rejects already-aborted callers before executing middleware or handlers. The HTTP
runtime stops admission synchronously, cancels work, then waits for handlers and returned
response bodies (EOF, error, or completed cancellation) before dependent resources are disposed.
HEAD-suppressed bodies are cancelled. Callers must consume or cancel returned bodies.

Configure the shared shutdown budget with `httpPlugin({ drainTimeoutMs: 1000 })` (1000 ms
by default). The deadline begins when admission stops and covers both logical requests and
Node connections; it is not restarted for each drain. The listener force-closes remaining
connections at that deadline. Uncooperative handlers or body cancellation report a failed
close instead of claiming a clean drain; callbacks cannot be forcibly stopped by JavaScript.
The former `nodeHttpPlugin({ drainTimeoutMs })` option moves to `httpPlugin`.

Node validates exactly one Host header and the origin-form request target before dispatch.
Host must use the actual listener port and match its binding, local socket address, or a
loopback alias for a loopback endpoint. For custom DNS use
`nodeHttpPlugin({ allowedHosts: ['app.example.test'] })`; entries are explicit hostnames or
IP literals, without ports, schemes, credentials, paths, or wildcards. Forwarded headers do
not grant authority. Malformed requests receive 400; unapproved authorities receive 421.
In-process Fetch requests remain trusted caller-supplied requests.

Incoming Node bodies are pulled in bounded chunks. Cancelling a body stops intake without
destroying the response socket, allowing early validation errors to reach uploading clients.
Incomplete uploads receive `Connection: close`, but remain readable while a response stream
consumes them. Explicit cancellation arms the rejection cleanup deadline immediately. Otherwise,
response-source completion stops remaining input and arms cleanup before waiting for the response
to flush. There is no ordinary response-write timeout; an uncancelled stalled duplex exchange
remains backpressured until completion, disconnection or bounded host shutdown. Fully read bodies
retain normal keep-alive behavior.

Feature packages use this same public boundary:

- [OpenAPI](../openapi/README.md): catalogs, selectable generators, validation and mock status policy.
- [Admin](../admin/README.md): opt-in fault injection, UI/API and scenarios.
- [CLI](../cli/README.md): explicit ESM composition and process lifecycle.
- [Core](../core/README.md): capability dependencies and lifecycle.

The upcoming 0.2 release removes the former JSONC configuration and monolithic `createServer` API.
See the [migration guide](../../MIGRATION.md) for the replacement of each option.

Requires Node.js 24.22.1+ (24.x) or 26.12.1+ (26.x); supported majors are 24 and 26. Start with the
[runnable HTTP example](../../examples/http.mjs) and [plugin author guide](../../docs/plugins.md).
