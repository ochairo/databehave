# Writing plugins

Start with the [runnable plugin example](../examples/plugin.mjs). The
[core API](../packages/core/README.md) specifies the complete host lifecycle.
Plugins are trusted application code. Capability declarations describe dependencies and value types;
they do not sandbox code or limit filesystem, network or process access.

## Choose the feature owner

| Extension | Public contract |
| --- | --- |
| Application service | `capability<T>(name, version)` and `Plugin` from `@databehave/core` |
| HTTP route or middleware | `httpCapability` from `@databehave/server` |
| Schema kind or behavior | `defineKind`, `defineBehavior`, `createSchemaRuntime` from `@databehave/schema/runtime` |
| OpenAPI response generation | `openapiGeneratorCapability`, or a selected `Capability<OpenApiGenerator>` |
| Scenario storage | `ScenariosStore` from `@databehave/admin` |

Use package-qualified capability names and a positive integer contract version. Consumers declare tokens in
`requires`, providers in `provides`; setup publishes values through `ctx.provide`, and hooks consume them through
`ctx.use`. Identity is name plus version, so separately imported copies can match. Duplicate providers, missing
requirements, invalid versions and cycles fail before setup. Different versions can coexist when explicitly composed.

## Registration and resource ownership

Create fresh plugin instances for each application. The host snapshots identifiers and callback references,
retaining method receivers. Mutable receiver and closure state still belongs to the plugin.

1. `setup` is synchronous: publish capabilities and register routes, middleware or other contributions. Do not
   acquire resources or perform I/O. Register a synchronous `ctx.onSeal` callback to close a feature-owned registry.
2. `prepare` loads data and compiles feature configuration. Register each acquired resource's cleanup immediately
   with `ctx.defer`. All preparation finishes before activation.
3. `activate` resolves prepared contributions. HTTP materializes registered route sources once in this phase.
4. `open` admits external work. Register ingress with `ctx.ownIngress({ stopAccepting, drainAndClose })`; do not
   register the same resource again as an ordinary disposer.

Dependencies determine hook order, while `ctx.order` retains the original plugin composition index. Pass that index
to HTTP contributions so dependency sorting does not silently change request policy. HTTP stages run preflight,
validation, interception, handler, decoration and observation; see the [HTTP contract](../packages/server/README.md).
Contributions must be registered before sealing, including descriptors whose data will be prepared later.

Close stops admission synchronously, aborts the lifetime signal, waits for the active startup hook, drains ingress,
then disposes other resources in reverse acquisition order. Hooks must observe cancellation and ingress must bound
its drain. A hook may register resources acquired before its completion even after cancellation; late ingress is
stopped immediately. Detached acquisitions after hook completion are unsupported. Cleanup continues after failures
and reports them in `AggregateError`. `start` and `close` are idempotent; a closed or failed host cannot restart.
Use `try/finally` around application work and create a new host to retry.

## Schema extensions

Standalone schema runtimes are synchronous and require no application host. Compose explicit `kinds` and `behaviors`
arrays; the official standard descriptors use the same contracts as external descriptors. A kind owns metadata,
generation, validation, children and reconstruction. A behavior owns applicability, merge semantics, middleware and
serialization. Recurse through the supplied context so nested operations retain the selected runtime.

Use runtime methods for custom schemas; root `mock`, `parse`, `safeParse`, `mockDataset` and `replay` bind the standard
composition. IR version 2 records exact required kind/behavior contracts. Serialization rejects closures and lossy
JSON data; replay retains executable callbacks in process and cannot make mutable callbacks deterministic.
The [schema extension guide](../packages/schema/docs/extending.md) documents scoped sampling and typed descriptors;
the [schema example](../examples/schema.mjs) demonstrates public runtime composition. Host applications can opt into
`schemaPlugin` and `schemaCapability` from `@databehave/schema/plugin`.

## Check the contract

Exercise missing/duplicate dependencies, contribution ordering, startup failure, cancellation and repeated close.
For HTTP plugins, check both an in-process Fetch request and the [Node transport example](../examples/http.mjs).
For schema extensions, check nested generation and validation, traversal/reconstruction, replay, and IR round-trip
with both matching and missing contracts. Keep seeds, options, descriptor implementations and runtime conditions
fixed when comparing generated values. Build and test against the public package entry points.
