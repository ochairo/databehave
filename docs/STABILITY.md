# Stability Contract

This document defines what `databehave` guarantees across versions. It is the
single source of truth when deciding whether a change is `PATCH`, `MINOR`, or
`MAJOR` under [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Public surface

The **public surface** is exactly the symbols re-exported from `src/index.ts`
plus the runtime shape of `SchemaNode` (the serialised IR). Anything reachable
only through deeper paths (`databehave/src/...`, `_internal`, identifiers
prefixed with `_`) is **internal** and may change in any release, including
`PATCH`.

The set of public symbols is locked by `test/public-surface.test.ts`. A change
to that snapshot is, by definition, at least a `MINOR` release (additive) or
`MAJOR` (removal / rename / signature change).

## Versioning rules

| Bump      | Trigger                                                                                                                                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PATCH** | Bug fix that preserves: (a) the inferred TS types, (b) thrown error types, (c) the byte-for-byte output of `mock(schema, { seed })` for every schema that was already valid under the previous version. Documentation, JSDoc, comments, and dependency bumps that do not change the above. |
| **MINOR** | Additive change to the public surface (new schema kind, new modifier, new option). Existing seeds keep producing the same output. New axes or generator paths that change RNG consumption for schemas that *opt in* to the new feature are allowed.                       |
| **MAJOR** | Anything that changes (a) public TypeScript signatures in a non-additive way, (b) the runtime IR shape, (c) the RNG consumption sequence for schemas that did not opt in to a new feature, (d) the set or wording of thrown error types in a way callers may pattern-match on. |

## Determinism contract

For every `(schema, options)` pair valid in version `V`:

```
mock(schema, { seed: S })   in V.x.y   ===   mock(schema, { seed: S })   in V.x.z
mock(schema, { seed: S })   in V.x.y   ===   mock(schema, { seed: S })   in V.y.z       (y >= x)
mock(schema, { seed: S })   in V.0     may differ from   mock(schema, { seed: S })   in V+1.0
```

i.e. `MAJOR` is the only level allowed to perturb seeded output. The cross-`MINOR`
guarantee is the reason that schema-builder additions (e.g. a new `decimal()`
overload) must never re-route control flow for schemas that did not opt in.

The contract holds for a fixed `Node.js` major + ECMAScript engine. Output
across Node majors is *not* guaranteed and is unlikely to differ because the
PRNG uses only `Math.floor`, integer math, and `(>>> 0)` bit ops — but it is
not enforced by tests.

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

## Plugin contract (IR)

The serialised IR (`SchemaNode`) carries an implicit version equal to the
package `MAJOR`. Plugins that read IR via `walkSchema` / `fromIR` are
guaranteed:

1. Within a `MAJOR`, every `SchemaNode` shape they previously matched continues
   to match (new kinds may be added).
2. Across `MAJOR`, a release note enumerates the changed IR shapes and the
   plugin-author migration path.

Plugins should default-case unknown `kind` values to forward-compat with
`MINOR` additions.

## Error class hierarchy

```
DataBehaveError              (root; never thrown directly)
├── SchemaConflictError      (schema build-time / generator unsolvable conflict)
└── ConformError             (validator failure; carries `issues: Issue[]`)
```

`Issue.code` is part of the public surface and follows the same versioning
rules as the rest of `index.ts`.

## Deprecation policy

A symbol may be marked `@deprecated` in any `MINOR`. The symbol must keep
working for at least one subsequent `MINOR` release. Removal happens in a
`MAJOR`. Deprecation messages always name the replacement.
