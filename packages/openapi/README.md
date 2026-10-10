# @databehave/openapi

Requires Node.js 24 or 26; supported majors are 24 and 26. See the
[plugin author guide](../../docs/plugins.md) and [migration guide](../../MIGRATION.md).

Explicit OpenAPI catalog, generation, request validation and mock-status plugins for Databehave.
The default entry point never imports the schema package at runtime or in its public declarations.

```ts
import { readFile } from 'node:fs/promises'
import { createHost } from '@databehave/core'
import { httpPlugin, nodeHttpPlugin } from '@databehave/server'
import {
  openapiPlugin, placeholderGeneratorPlugin, requestValidationPlugin, mockModePlugin,
} from '@databehave/openapi'

const host = createHost({ plugins: [
  httpPlugin(),
  placeholderGeneratorPlugin(),
  openapiPlugin({ document: await readFile('./openapi.json', 'utf8') }),
  requestValidationPlugin({ maxBodyBytes: 102400 }),
  mockModePlugin({ allowHeaderOverride: true }),
  nodeHttpPlugin({ port: 3000 }),
] })
await host.start()
// await host.close() when the application shuts down.
```

`document` is raw JSON text. Filesystem/network loading belongs to the application; YAML must be converted before
composition. Parsing and generator compilation happen during preparation, before HTTP materializes routes or opens
listeners. The operation catalog owns method/path matching and response status selection. Exact paths precede
parameterized paths; parameterized ties retain document declaration order. HTTP explicit routes replace generated
routes with the same key.

`openapiCapability` provides the parsed document, operations, `find(method, path)` and
`body(operation, status, request)`. Responses use 200 when declared, otherwise the lowest declared 2xx, defaulting
to 200 if none is declared. Only exact numeric status keys and `application/json` response schemas generate bodies.
204, 205 and 304 have no generated body. Unsupported nonnumeric/default/range statuses do not select a schema.
GET/HEAD without a schema use `{}`; other methods use `{ success: true, message: null }`.

Placeholder generation uses deterministic structural values such as `"string"`, `0` and `false`.
Unsupported placeholder schemas report `onWalkError` and fall back to a stub. Permissive success schemas report
`onEmptySchema`. A response is compiled once per operation/status; injection and ordinary routes share its generator.

For schema generation, replace `placeholderGeneratorPlugin()` with the optional adapter:

```ts
import * as builders from '@databehave/schema'
import { createSchemaRuntime, standardKinds, standardBehaviors } from '@databehave/schema'
import { schemaGeneratorPlugin } from '@databehave/openapi/schema'

const runtime = createSchemaRuntime({ kinds: standardKinds, behaviors: standardBehaviors })
const provider = schemaGeneratorPlugin({ builders, runtime, seed: 'stable' })
```

The adapter receives builders and a runtime explicitly. It never resolves another schema implementation internally.
`seed` accepts a number, `'stable'` (default: operation, sorted query and path parameters), or `'random'` (per request).
Schema generation rejects unsupported response schemas during startup, including schemas for injected error statuses.
The translator retains bounds, formats, nullable/optional fields, object/array/union/discriminator shapes, local
references and examples. Request conformance remains separate: generation is not a validator. Exclusive numeric
bounds retain the existing inclusive approximation in generation; conformance enforces exclusive bounds exactly.

An external provider can provide `openapiGeneratorCapability` using the public core `Plugin` protocol, or a different
`Capability<OpenApiGenerator>` selected with `openapiPlugin({ document, generator: token })`.
Its `compile(schema, { document, operation, status })` returns a request body function, optionally asynchronously.
`failureMode: 'throw'` rejects startup; `'fallback'` emits diagnostics and preserves stub behavior.
Do not also include a second provider for the same capability.

Request validation is opt-in through `requestValidationPlugin()`. It retains body/parameter conformance, parameter
coercion, local references, size checks and presence checks for declared security schemes. HEAD fallback validates the
GET contract. Failures produce problem JSON with 400/401/413/415/422; HTTP applies decorators and observes the outcome.
Security checks establish declared credential presence, not token authenticity.

Problem response references: [400](../../docs/errors/malformed-body.md),
[401](../../docs/errors/unauthorized.md), [413](../../docs/errors/payload-too-large.md),
[415](../../docs/errors/unsupported-media-type.md), [422](../../docs/errors/request-validation.md).

Declared request bodies are read incrementally with a UTF-8 byte limit before JSON parsing. `maxBodyBytes` defaults
to 102400 and must be a nonnegative safe integer; zero permits no body bytes. Overflow returns 413 before EOF and
cancels both validation and original request streams; read failures or aborts return 400. Successful validation leaves
the original body readable by the handler. Required-body presence is checked even without a schema, including declared
OPTIONS bodies. JSON media declarations still require valid JSON without a schema; non-JSON bodies retain presence
and size checks. A `pattern` requires a finite nonnegative integer `maxLength` on the same schema node; oversized
strings report a length violation without executing that regex.

`mockModePlugin()` enables status selection by method/path override, path override, then default status. Incoming
status headers require `allowHeaderOverride: true`. Health paths bypass injection/tagging. A selected numeric status
uses the same catalog and generator as normal responses; a missing body schema uses `{ error: true, status }`.

Migration changes: import these features from `@databehave/openapi`, compose an explicit provider, and pass JSON text
through `document`. Generated routes now return their selected declared success status (201 stays 201; 204/205 are
empty), root operations are registered, HEAD/OPTIONS operations are supported, malformed non-object documents are
rejected early, and error-status generation follows the selected provider. Removed JSONC `enabled`, `locale` and
`arrayCount` schema knobs are not part of this API; the latter two had no generation effect.
