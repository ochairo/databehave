# Stability Contract

This document defines what `databehave` guarantees across versions. It is the
single source of truth when deciding whether a change is `PATCH`, `MINOR`, or
`MAJOR` under [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Before 1.0, a minor release may contain breaking changes with a migration guide. The upcoming 0.2 release
uses this rule. The PATCH/MINOR/MAJOR compatibility guarantees below apply to stable releases from 1.0.

## Public surface

The **public surface** consists of the declared package entry points: the root DSL and standard convenience
functions, `/runtime` for runtime and descriptor contracts, `/standard` for the official composition, and
`/plugin` for the optional application-host adapter. `/internal` is an exported low-level compatibility surface;
new extensions should use `/runtime`. Source-file deep imports are not supported. API reports in `etc/` cover
each entry point. `SchemaNode` is an open kind contract; `StandardSchemaNode` is the built-in node union.

Public API reports and `test/public-surface.test.ts` check these exports. A change
to that snapshot is, by definition, at least a `MINOR` release (additive) or
`MAJOR` (removal / rename / signature change).

## Versioning rules

| Bump      | Trigger                                                                                                                                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PATCH** | Bug fix that preserves: (a) the inferred TS types, (b) thrown error types, (c) the byte-for-byte output of `mock(schema, { seed })` for every schema that was already valid under the previous version. Documentation, JSDoc, comments, and dependency bumps that do not change the above. |
| **MINOR** | Additive change to the public surface (new schema kind, new modifier, new option). Existing seeds keep producing the same output. New axes or generator paths that change RNG consumption for schemas that *opt in* to the new feature are allowed.                       |
| **MAJOR** | Anything that changes (a) public TypeScript signatures in a non-additive way, (b) the runtime IR shape, (c) the RNG consumption sequence for schemas that did not opt in to a new feature, (d) the set or wording of thrown error types in a way callers may pattern-match on. |

## Determinism contract

For a fixed schema, all generation options, deterministic descriptor implementations and their contract versions,
seeded output follows the compatibility rules below. Changing a custom plugin implementation or its mutable state
is outside the standard library's guarantee. The upcoming 0.2 migration is a breaking release; retain old fixtures
when comparing it with 0.1.

For stable releases within one major version:

```
mock(schema, { seed: S })   in V.x.y   ===   mock(schema, { seed: S })   in V.x.z
mock(schema, { seed: S })   in V.x.y   ===   mock(schema, { seed: S })   in V.y.z       (y >= x)
mock(schema, { seed: S })   in V.0     may differ from   mock(schema, { seed: S })   in V+1.0
```

i.e. `MAJOR` is the only level allowed to perturb seeded output. The cross-`MINOR`
guarantee is the reason that schema-builder additions (e.g. a new `decimal()`
overload) must never re-route control flow for schemas that did not opt in.

The contract assumes fixed Node.js/ECMAScript engine and numeric behavior. The upcoming release supports Node.js
24 and 26, but support on both majors does not promise byte-equal output between them. Gaussian sampling uses
transcendental math and may differ across engines/platforms. Custom callbacks and PRNGs must preserve determinism.

### `expectStable` vs `replay`

`expectStable(schema, opts)` is a **diagnostic**, not a determinism
guarantee. It runs the schema *twice* with the same seed and compares
the outputs structurally — useful for catching obvious non-determinism
(`Date.now()`, `Math.random()`, `Set` iteration order) but two
iterations cannot prove the entire RNG sequence is fixed.

`replay(schema, opts)` binds the selected runtime, snapshots schema metadata and options, and exposes the required
contract identities. Use it with stored expected values for regression tests. It keeps callbacks and their closures
in process; it cannot freeze closure state or preserve an old plugin implementation across releases. Root `replay`
uses `standardRuntime`; custom schemas use `runtime.replay`. Neither helper proves cross-version compatibility.

## "Fail loud" policy

Modifiers that have no meaningful semantics for a given schema kind throw
`SchemaConflictError` **at schema-build time**, not at sample time. Examples:

- `.weighted(...)` on `decimal(...)` (decimals are continuous; no discrete weights make sense)
- `.weighted(...)` on `union(...)` (use `discriminated(...)` for branch shaping)
- `.weighted(...)` / `.normal(...)` / `.typically(...)` on `obj(...)`, `arr(...)`, `tuple(...)`

When the type system blocks the call at compile time, the runtime throw is the
safety net for users on `// @ts-ignore`, dynamic schema construction, or
plain JS. The error always includes a recovery hint pointing to the correct
alternative.

## Extension contract (IR)

`IR_VERSION` is explicitly `2`, independent of the package version. `runtime.serializeSchema(schema)` writes
`{ $databehaveVersion: 2, contracts: { kinds, behaviors }, node }`. Each required contract records its exact
`id` and positive integer `version`; registration order is part of the runtime composition, not the envelope.
Deserialization validates unknown input recursively and rejects missing, extra, duplicate or incompatible required
contracts. An unrelated registered descriptor is allowed; an unrelated claimed envelope contract is not.

`runtime.fromIR(unknown)` validates an in-process node against the selected runtime. It does not supply missing
plugins or convert persisted envelopes. Traversal and reconstruction use each kind's public callbacks, preserving
custom nested kinds without editing a closed switch. Consumers must register every kind/behavior used by a schema.
Callbacks may exist in in-process IR; serialization rejects closures, cycles and lossy JSON data.

Version 1 envelopes require the explicit [migration procedure](../../../MIGRATION.md#schema-and-generation).
Do not change only the version marker. See [schema extensions](extending.md) for descriptors and serialization.

## Error class hierarchy

```
DataBehaveError              (root; never thrown directly)
├── SchemaConflictError      (schema build-time / generator unsolvable conflict)
└── ConformError             (validator failure; carries `issues: Issue[]`)
```

`Issue.code` is part of the public surface and follows the same versioning
rules as the rest of the public API. The standard catalog lives in the open
`IssueCode` type (`src/foundation/errors.ts`) and is snapshot-locked by
`test/foundation/issue-codes.test.ts`:

- Adding a new code is **MINOR** (and the snapshot test must be extended in
  the same commit).
- Renaming, removing, or changing the meaning of an existing code is
  **MAJOR** (release notes must list the old → new mapping).

Plugins may emit namespaced string codes. Their owners define their compatibility policy; consumers must handle
unknown codes rather than assume the standard catalog is exhaustive. While the package is below 1.0, intentional
breaking changes are documented in the upcoming minor release's migration notes.

### Issue messages are diagnostic-only

The `Issue.message` field is a human-readable diagnostic and is **NOT** part
of the SemVer contract. Message wording, punctuation, and embedded numeric
limits may change in **any** release — including `PATCH`. Tests, runtime
branching, and any other programmatic consumer **must** match on `Issue.code`
(stable per the catalog above) and `Issue.path` (stable per the schema
definition order); never on `Issue.message`.

The same rule applies to `ConformError.message`, which is composed from the
underlying issues' messages.

## Deprecation policy

A symbol may be marked deprecated (JSDoc tag) in any `MINOR`. The symbol must
keep working for at least one subsequent `MINOR` release. Removal happens in a
`MAJOR`. Deprecation messages always name the replacement.
