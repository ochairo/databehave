/**
 * Trace collector — records which axis fired at each path during a
 * single `mock()` call.
 *
 * The trace is a read-only audit of the generator's decisions: every
 * produced value is annotated with the axis that won.
 *
 * Usage:
 *
 *   const trace = createTrace()
 *   const value = mock(schema, { seed: 's', trace })
 *   console.log(trace.entries)  // → TraceEntry[]
 */

/**
 * Which axis decided a value at a given path.
 *
 *   - `default`        : pure value (`undefined` slot in optional/default)
 *   - `optional-skip`  : optional field rolled `undefined`
 *   - `nullable-null`  : nullable field rolled `null`
 *   - `derived`        : produced by `derivedFrom(...)`
 *   - `occasionally`   : forced by an `occasionally(...)` override
 *   - `eventually`     : forced by an `eventually(...)` override (modulo `index`)
 *   - `invariant-pass` : sampled then accepted by all `invariant(...)`
 *   - `invariant-fail` : retry exhausted before invariants held
 *   - `domain`         : sampled from `in([...])` candidate set
 *   - `distribution`   : sampled via `weighted|normal|typically`
 *   - `type`           : fell through to type-default sampling
 */
export type TraceAxis =
  | 'default'
  | 'optional-skip'
  | 'nullable-null'
  | 'derived'
  | 'occasionally'
  | 'eventually'
  | 'invariant-pass'
  | 'invariant-fail'
  | 'domain'
  | 'distribution'
  | 'type'

export type TraceEntry = {
  readonly path: readonly (string | number)[]
  readonly axis: TraceAxis
  /** Attempts taken before invariants accepted (only meaningful when invariants run). */
  readonly attempts?: number
  /** Free-form annotation (e.g. distribution kind, picked literal). */
  readonly note?: string
}

export type TraceCollector = {
  /** Append a single entry. Called by the engine — do not call from user code. */
  readonly emit: (entry: TraceEntry) => void
  /** Read-only view of entries collected so far. */
  readonly entries: readonly TraceEntry[]
  /** All paths where a specific axis fired. */
  readonly axisFiredAt: (axis: TraceAxis) => readonly (readonly (string | number)[])[]
  /** Pretty multi-line dump (one entry per line, JSON-pointer-style paths). */
  readonly format: () => string
}

export const createTrace = (): TraceCollector => {
  const entries: TraceEntry[] = []
  return {
    emit(entry) {
      entries.push(entry)
    },
    get entries() {
      return entries
    },
    axisFiredAt(axis) {
      return entries.filter((e) => e.axis === axis).map((e) => e.path)
    },
    format() {
      return entries
        .map((e) => {
          const ptr = '/' + e.path.map((p) => String(p)).join('/')
          const attempts = e.attempts !== undefined ? ` attempts=${e.attempts}` : ''
          const note = e.note !== undefined ? ` (${e.note})` : ''
          return `${ptr.padEnd(40)} ${e.axis}${attempts}${note}`
        })
        .join('\n')
    },
  }
}
