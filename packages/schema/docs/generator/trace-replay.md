# Trace & replay

Two helpers wrap [`mock(...)`](./sampling.md#mock) for debugging and
regression testing:

- **`createTrace()`** — append-only audit collector. Every produced
  value is annotated with the axis that won during sampling.
- **`replay(...)` / `expectStable(...)`** — deterministic snapshots:
  bind a fixed `(seed, input)` pair and assert that two calls yield
  deep-equal output.

Both build on top of `mock(...)`'s deterministic contract; neither
introduces side effects of its own.

Source:
[`src/generator/trace.ts`](../../src/generator/trace.ts),
[`src/generator/replay.ts`](../../src/generator/replay.ts).

---

## `createTrace()`

```ts
import { createTrace, mock, obj, int, str } from '@databehave/schema'

const Doc = obj({
  id:   int().min(1),
  slug: str().pattern(/^[a-z]+$/),
}).invariant(d => (d as { id: number }).id < 100)

const trace = createTrace()
mock(Doc, { seed: 'demo', trace })

trace.entries          // readonly TraceEntry[]
trace.axisFiredAt('invariant-pass')  // every path where invariants accepted
console.log(trace.format())          // pretty multi-line dump
```

Signature:

```ts
const createTrace: () => TraceCollector
```

The trace records one entry per leaf-or-composite decision the
generator makes — useful for verifying that a `.weighted` actually
fires, that `eventually` lands on the expected indices, or that an
invariant is exhausting its budget.

The collector is append-only. There is no `reset()` — discard the
collector and create a new one if you need a fresh run.

Source:
[`src/generator/trace.ts`](../../src/generator/trace.ts).

## `TraceAxis`

```ts
type TraceAxis =
  | 'default'         // .default short-circuit fired (modifierProbs.default)
  | 'optional-skip'   // .optional short-circuit fired (modifierProbs.optional)
  | 'nullable-null'   // .nullable short-circuit fired (modifierProbs.nullable)
  | 'derived'         // value came from derivedFrom — sampling skipped
  | 'occasionally'    // .occasionally(...) override won
  | 'eventually'      // .eventually(...) cadence override won
  | 'invariant-pass'  // sampled and accepted by all .invariant(...) callbacks
  | 'invariant-fail'  // rejection budget (MAX_ATTEMPTS) exhausted
  | 'domain'          // sampled from .in([...]) candidate set
  | 'distribution'    // sampled via .weighted / .normal / .typically
  | 'type'            // fell through to type-default sampling
```

The 11 axes mirror the [axis priority
order](./sampling.md#axis-priority). Composite kinds
(`object` / `array` / `tuple` / `union` / `discriminated`) are bucketed
under `'type'` — their children re-enter the pipeline and emit their
own per-path entries.

Source:
[`src/generator/trace.ts`](../../src/generator/trace.ts) (`TraceAxis`
union).

## `TraceEntry`

```ts
type TraceEntry = {
  readonly path:      readonly (string | number)[]
  readonly axis:      TraceAxis
  readonly attempts?: number  // populated when invariants ran
  readonly note?:     string  // free-form annotation (rare; reserved)
}
```

Each entry carries:

- `path` — JSON-pointer-style address into the produced tree (string
  keys for objects, numeric indices for arrays/tuples).
- `axis` — which axis won at this path.
- `attempts` — only meaningful for `'invariant-pass'` /
  `'invariant-fail'`; counts the rejection-sample iterations.
- `note` — reserved for future per-axis annotations (currently unused
  by the engine).

Source:
[`src/generator/trace.ts`](../../src/generator/trace.ts) (`TraceEntry`).

## `TraceCollector`

```ts
type TraceCollector = {
  readonly emit:        (entry: TraceEntry) => void
  readonly entries:     readonly TraceEntry[]
  readonly axisFiredAt: (axis: TraceAxis) => readonly (readonly (string | number)[])[]
  readonly format:      () => string
}
```

- `emit(entry)` — called by the engine. Do not call from user code.
- `entries` — append-only view. Stable read order matches sampling
  order.
- `axisFiredAt(axis)` — convenience filter; returns the paths where a
  specific axis fired.
- `format()` — pretty multi-line dump. Each line:
  `'/path/parts'.padEnd(40) + axis + (attempts? note?)`.

A trace is purely an observer: passing one to `mock()` does not
perturb the produced value (the same `seed` still yields the same
output).

Source:
[`src/generator/trace.ts`](../../src/generator/trace.ts) (`TraceCollector`,
`createTrace` implementation).

## `replay(schema, options)`

```ts
import { replay, obj, str } from '@databehave/schema'

const make = replay(obj({ name: str() }), { seed: 'pinned' })
const a = make()
const b = make()
// a deep-equals b — guaranteed across calls and across processes.

make.options  // Readonly<MockOptions> — deep-frozen copy
```

Signature:

```ts
const replay: <S extends Schema>(schema: S, options?: MockOptions) => Replay<S>

type Replay<S extends Schema> = {
  (): Infer<S>
  readonly options: Readonly<MockOptions>
}
```

`replay(...)` deep-freezes a copy of the supplied options (so callers
cannot mutate `options.input` through nested references later) and
returns a callable bound to those frozen options. Calling it twice
always yields deep-equal values; the `.options` accessor exposes the
frozen view for assertions.

Source:
[`src/generator/replay.ts`](../../src/generator/replay.ts).

## `expectStable(schema, options)`

```ts
import { expectStable, obj, str } from '@databehave/schema'

const Doc = obj({
  // BAD: derivedFrom must be pure — Date.now breaks determinism.
  // ts: str().derivedFrom(() => String(Date.now())),
  ts: str().derivedFrom(ctx => `req:${(ctx.input as { now: string }).now}`),
})

expectStable(Doc, { seed: 's', input: { now: '2026-06-01' } })
//   ↑ throws Error('expectStable: generator produced different values …')
//     when a callback reads Date.now / Math.random / network.
```

Signature:

```ts
const expectStable: <S extends Schema>(schema: S, options?: MockOptions) => Infer<S>
```

`expectStable(...)` runs the generator twice with identical inputs and
asserts deep equality via `node:util#isDeepStrictEqual`. On match it
returns the produced value; on divergence it throws a plain `Error`
naming the most likely culprit (a non-deterministic `derivedFrom`
callback). Use it as a regression test in any suite that exercises
user-defined callbacks.

Source:
[`src/generator/replay.ts`](../../src/generator/replay.ts) (`expectStable`).
