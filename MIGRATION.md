# Migrating to plugin composition

This is an intentional breaking API/configuration change. The previous JSONC assembly path and
`createServer(config)` API are removed. Existing scenario files are not automatically rewritten.

The upcoming release requires Node.js 24.22.1+ (24.x) or 26.12.1+ (26.x), with Node.js 24 and 26 in the supported test matrix.
Upgrade applications using Node.js 18, 20 or 22 before migrating. See the [release guide](docs/releasing.md)
for runtime support and the [plugin author guide](docs/plugins.md) for extension ownership and lifecycle.

## Configuration and CLI

Install `@databehave/cli` and the plugins you actually use. Replace `databehave-server config.jsonc`
with `databehave config.mjs`. Export a factory, rather than a shared array of stateful plugin instances.
Use `.mjs`, or `.js` inside an ESM package. Compile TypeScript configuration before invoking the CLI.

```js
import { readFile } from 'node:fs/promises'
import { defineConfig } from '@databehave/cli'
import { httpPlugin, nodeHttpPlugin, corsPlugin, accessLogPlugin } from '@databehave/server'
import {
  openapiPlugin, placeholderGeneratorPlugin, requestValidationPlugin,
} from '@databehave/openapi'
import { faultInjectionPlugin, adminPlugin, fileScenariosStore } from '@databehave/admin'

export default defineConfig(async () => {
  const document = await readFile(new URL('./openapi.json', import.meta.url), 'utf8')
  return {
    plugins: [
      httpPlugin(),
      placeholderGeneratorPlugin(),
      openapiPlugin({ document }),
      requestValidationPlugin({ maxBodyBytes: 102400 }),
      corsPlugin(),
      accessLogPlugin({ format: 'pretty' }),
      faultInjectionPlugin(),
      adminPlugin({ openapiBody: () => document, scenarios: fileScenariosStore({ dir: './mock-scenarios' }) }),
      nodeHttpPlugin({ host: '127.0.0.1', port: 8000 }),
    ],
  }
})
```

ESM owns relative imports and file resolution. Use `new URL('./file', import.meta.url)` for paths relative to the
configuration. Use explicit `process.env` access and validation for environment-dependent options. No recursive
string interpolation or automatic handler/module resolution remains.

| Previous entry | New owner |
| --- | --- |
| `server.host`, `server.port` | `nodeHttpPlugin({ host, port })` |
| `endpoints`, static endpoint responses | `routesPlugin({ 'GET /path': handler })`, including ordinary imported handlers |
| `basePath` | Explicit complete route keys, or a user-owned route factory |
| `openapi` file path | Read the document in configuration; pass its JSON text to `openapiPlugin` |
| Default OpenAPI mock values | `placeholderGeneratorPlugin()` |
| `schema.enabled`, `schema.seed` | `schemaGeneratorPlugin` from `@databehave/openapi/schema` with an explicitly composed schema runtime |
| `schema.locale`, `schema.arrayCount` | Removed ignored options; express constraints in the schema |
| `validation.request`, `validation.maxBodyBytes` | Add `requestValidationPlugin({ maxBodyBytes })`, or omit it |
| `cors` | `corsPlugin(options)`; express allowlist policy through the typed origin callback |
| `log` | `accessLogPlugin({ format, colors, filter, write })`; filter admin traffic explicitly if desired |
| `mockMode` | `mockModePlugin(options)` from `@databehave/openapi` |
| `admin.enabled` | Explicit `faultInjectionPlugin()` and `adminPlugin()` |
| `admin.headers`, `admin.allowDestroy` | `faultInjectionPlugin({ headers, allowDestroy })` |
| `admin.path`, `admin.ui`, `admin.bind`, `admin.cors` | `adminPlugin(options)` |
| `admin.scenariosDir` | `adminPlugin({ scenarios: fileScenariosStore({ dir }) })`; omit `scenarios` to disable persistence |
| `admin.openBrowserOnStart`, CLI `--open` | Optional `openAdminBrowserPlugin()` from `@databehave/admin` |
| `hooks` | A plugin registers middleware at a named HTTP stage |
| `run`, `defineConfig` from server | `run`, `defineConfig` from `@databehave/cli` |

## Programmatic HTTP and extension ownership

```js
import { createHost } from '@databehave/core'
import { httpPlugin, httpCapability, routesPlugin } from '@databehave/server'

const app = createHost({ plugins: [
  httpPlugin(),
  routesPlugin({ 'GET /hello': () => ({ json: { hello: 'world' } }) }),
] })
await app.start()
try {
  const response = await app.get(httpCapability).fetch(new Request('http://local/hello'))
  console.log(await response.json())
} finally {
  await app.close()
}
```

There is no listener unless a listener plugin is present. Register routes, middleware and bind guards during
setup. Register route-source descriptors before the host seals registration; prepare their data in `prepare`.
HTTP materializes sources once during activation. Query the resolved route catalog after activation.

HTTP stages are preflight, validation, interception, handler, decoration and observation. Each stage uses explicit
plugin composition order independently of dependency sorting. An error hook can supply an error response;
a failing error hook falls back to a generic 500. A failing decorator is not called recursively. Observation
runs once and cannot replace the response. All responses, including validation errors and preflight responses,
now receive decoration. HEAD invokes its explicit handler or effective GET handler once, retaining the original
method for observation, and strips the final body.

CORS applies to resolved routes. Preflight resolution uses `Access-Control-Request-Method`; unknown target routes
are not implicitly authorized. Contributions may set `cors` to a route-specific policy or `false` when the owner
supplies its own policy. Admin owns its preflight and response policy independently of general application CORS.

Transport destruction is an HTTP terminal outcome through `terminateTransport()`. Fetch-only callers receive
`UnsupportedTransportError`; a Node listener drops the actual connection. Fault delays/hangs obey cancellation.
Configure `httpPlugin({ drainTimeoutMs })` (default 1000), moving this option from `nodeHttpPlugin`.
HTTP owns both in-process request work and returned response streams through completion or cancellation.
Shutdown stops admission, aborts work and drains before plugin resource disposal. Socket and logical drains share
the deadline measured from shutdown start. Expiry reports a cleanup failure and remaining sockets are closed;
trusted callbacks that ignore cancellation cannot be forcibly stopped. Pre-aborted requests do not invoke handlers.
Node input remains readable through response production, including streaming echoes. Canceled uploads start bounded
rejection cleanup immediately; otherwise remaining input is stopped after response-source completion. Ordinary duplex
responses have backpressure and shutdown bounds, without an implicit response-write timeout.

The Node listener validates request authority before dispatch. Host must match the configured listener hostname,
its local address, an applicable loopback alias, or an explicit `nodeHttpPlugin({ allowedHosts: ['mock.example'] })`
entry, using the actual listener port. Extra entries are hostnames without schemes, ports or wildcards. Absolute-form,
network-path and backslash-containing request targets are rejected. Forwarded headers do not grant authority.

Request validation enforces its byte limit while reading and rejects failed or aborted body reads. Required-body
presence no longer depends on a schema being supplied. `maxBodyBytes` must be a nonnegative safe integer; zero permits
only empty bodies. Pattern checks skip inputs exceeding their declared `maxLength`, which must be a nonnegative
finite integer. An oversized streaming request receives a rejection before EOF and its connection is closed after
the response, rather than draining an unlimited upload.

## Schema and generation

The standalone schema runtime is synchronous. Compose `standardKinds` and `standardBehaviors` with your own
public descriptors using `createSchemaRuntime`. Official kinds and behaviors use the same registry protocol.
Custom kinds own generation, validation, traversal and reconstruction; behaviors own applicability, merge,
phase participation and serialization. No subclass of an internal builder is necessary.

Domain and distribution behaviors compose through scoped sampling candidates and fallback. Replacing distribution
selection also affects constrained domains. A continuation override affects only that invocation and its downstream
behaviors; child generation receives its own scope. Union validation delegates null and undefined acceptance to its
branches, including external kinds, and `literal(null)` accepts its own generated value.

Plugin and schema registration support class methods and private receiver state. Definitions snapshot identifiers
and callback references; reassigning the original callback does not replace it in an existing host/runtime. Mutable
receiver and closure state remains the extension's responsibility.

The optional `@databehave/schema/plugin` entry supplies a schema runtime capability to applications that need it.
It is separate from the standalone runtime. See the [schema plugin guide](packages/schema/docs/extending.md)
and [runnable schema example](examples/schema.mjs).

Serialized IR now records required kind/behavior contract versions. Missing or incompatible plugins fail
explicitly; closure-bearing behavior cannot be serialized. Version 1 envelopes are rejected by deserialization.
For standard schemas whose metadata is still valid, explicitly validate the old node and write a new file:

```js
import { readFile, writeFile } from 'node:fs/promises'
import { standardRuntime } from '@databehave/schema/standard'

const legacy = JSON.parse(await readFile('./schema.v1.json', 'utf8'))
if (legacy?.$databehaveVersion !== 1) throw new Error('Expected version 1 IR')
const schema = standardRuntime.fromIR(legacy.node)
await writeFile('./schema.v2.json', JSON.stringify(standardRuntime.serializeSchema(schema), null, 2), { flag: 'wx' })
```

Invalid metadata fails before writing. Recreate unsupported schema semantics through current builders; never
change only the envelope version. Keep the original file for rollback. No automatic wire-format conversion runs.
Seeded results depend on the schema, options, plugin implementations/versions and runtime numeric behavior.
Standard modifier/derived/cadence short circuits still bypass invariant sampling; this precedence is intentional.

OpenAPI selects operations/statuses in one catalog shared by generated routes and injected-status bodies.
The selected declared success status is returned (for example 201), rather than forcing schema-backed responses
to 200. Responses for 204/205 have no body. Root `/` operations are supported. Placeholder and schema-backed
generation remain explicit alternatives; selecting a strict schema provider never silently downgrades to placeholders.

## Admin and saved scenarios

Admin remains opt-in and loopback-only by default. Configure `bind: 'any'` explicitly to expose it elsewhere.
Loopback binding is not authentication. Capability interfaces do not sandbox trusted plugins or confine their I/O.

Scenario persistence is an explicit `ScenariosStore` supplied to admin. `fileScenariosStore({ dir })` is the standard
adapter; another plugin can supply an in-memory or external implementation through the same public contract. Admin
validates retrieved data before activation. Storage adapters own I/O and atomic writes; plugins acquiring resources
for an adapter register their cleanup with the host. Omitting a store disables scenario endpoints.

The admin route list comes from the resolved HTTP catalog, including routes contributed by external plugins.
OpenAPI JSON is optional display metadata. Valid existing unversioned scenario files remain readable; new saves
include the supported version. The entire scenario is validated before save or atomic replacement of live
fault state. Invalid or unsupported data leaves existing state/files unchanged. No automatic migration modifies
user scenario directories. Back up data before changing versions.

Restrictive admin CORS now rejects disallowed `Origin` headers before reads or mutations, including simple requests
that do not preflight. Allowlist responses reflect one permitted origin. General application CORS cannot widen this
policy. Origin-less local clients remain supported; this does not add authentication.
