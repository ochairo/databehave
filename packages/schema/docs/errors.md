# Error catalogue

Every error class `@databehave/schema` exports, with throw site and
canonical reference. The full class bodies, signatures, and
runnable examples live in
[foundation/types.md#error-hierarchy](./foundation/types.md#error-hierarchy);
this page is the aggregator for top-level discoverability.

The kit follows a **fail-loud** policy: capability-matrix
violations on builder construction throw at schema-build time, not
on the first `mock()` / `parse()` call. See
[stability.md#fail-loud-policy](./stability.md#fail-loud-policy) for
the policy statement.

## Class hierarchy

```
Error
  └── DataBehaveError                (abstract; never thrown directly)
        ├── ConformError             (validator failure; carries `issues: Issue[]`)
        └── SchemaConflictError      (schema is unsatisfiable / misused)
```

Source:
[`src/foundation/errors.ts`](../src/foundation/errors.ts).

## Classes

| Class | Purpose | Throw sites | Reference |
| --- | --- | --- | --- |
| [`DataBehaveError`](./foundation/types.md#databehaveerror) | Abstract root. Subclasses carry `path` (an array of string/number segments) and optional `hint`. | n/a (abstract — never thrown directly). | [`src/foundation/errors.ts:24-37`](../src/foundation/errors.ts) |
| [`ConformError`](./foundation/types.md#conformerror) | Validator rejected a value. Carries `issues: readonly Issue[]`; the error's own `path` is always `[]` because each issue carries its own. | [`parse(schema, value)`](./validator/api.md#parseschema-value) | [`src/foundation/errors.ts:39-58`](../src/foundation/errors.ts) |
| [`SchemaConflictError`](./foundation/types.md#schemaconflicterror) | Schema is unsatisfiable or misused. Build-time on capability-matrix violations; runtime on impossible bounds, exhausted invariants or exhausted dataset collision retries. | builder constructors (e.g. `obj({...}).weighted(...)`); [`mock()`](./generator/sampling.md#mock); [`mockDataset()`](./dataset/mock-dataset.md#collisions) | [`src/foundation/errors.ts`](../src/foundation/errors.ts) |

## Supporting types

| Type | Purpose | Reference |
| --- | --- | --- |
| [`Issue`](./foundation/types.md#issue) | One conformance failure: `{ path, code, message, expected?, received? }`. Standard codes are stable; `IssueCode` also accepts plugin-defined strings. Match `code` and `path`; `message` is diagnostic-only. | [`src/foundation/errors.ts`](../src/foundation/errors.ts) |
| [`SafeParseResult<T>`](./validator/api.md#safeparseresultt) | Discriminated alternative to throwing — `{ ok: true, value }` or `{ ok: false, error: ConformError }`. | [`src/validator/parse.ts:17-19`](../src/validator/parse.ts) |

## Catching library failures

`ConformError` reports collected value issues; `SchemaConflictError` reports builder or sampling conflicts.
Invalid registries, metadata and IR contracts can throw `TypeError`; invalid sampling probabilities can throw
`RangeError`. `safeParse` converts conformance issues to a result, not arbitrary runtime or plugin failures.
During validation, standard derived/invariant callbacks that throw become `derived.callback-threw` or
`invariant.callback-threw` issues. During generation, callback errors propagate. External descriptors own
their error behavior, so `DataBehaveError` is not an exhaustive discriminator for runtime failures.

```ts
import { DataBehaveError, parse, str } from '@databehave/schema'

try {
  parse(str().min(3), 'no')
} catch (e) {
  if (e instanceof DataBehaveError) {
    console.error('databehave failure at', e.path.join('.'), e.message)
  } else {
    throw e // registry, metadata, options or plugin failure
  }
}
```

For symptom-driven guidance on common build/runtime conflicts see
[stability.md#fail-loud-policy](./stability.md#fail-loud-policy) and
[generator/sampling.md#rejection-sampling](./generator/sampling.md#rejection-sampling).
