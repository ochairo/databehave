/**
 * databehave error hierarchy. All errors carry a JSON-pointer style `path` so that
 * deeply nested failures can be reported precisely.
 *
 * ```
 *               Error
 *                 └── DataBehaveError (abstract)
 *                       ├── ConformError       (runtime input did not conform)
 *                       └── SchemaConflictError (schema is unsatisfiable / misused)
 * ```
 *
 * Catch `DataBehaveError` to filter library-originated failures from generic
 * `Error`s (e.g. callback bugs in `derivedFrom`/`invariant` are not wrapped).
 */

export type Issue = {
  readonly path: readonly (string | number)[]
  readonly message: string
  readonly expected?: string
  readonly received?: unknown
}

/**
 * Abstract root of all errors thrown by databehave itself.
 *
 * @remarks
 *   Callbacks supplied by the user (e.g. `derivedFrom`, `invariant`) are
 *   reported as {@link Issue}s rather than wrapped: the original `Error` is
 *   surfaced in the issue's `message` and re-thrown only at the boundary.
 */
export abstract class DataBehaveError extends Error {
  /** JSON-pointer style location where the error originated. */
  abstract readonly path: readonly (string | number)[]
  /** Optional recovery hint, surfaced in the message and as a property. */
  abstract readonly hint?: string
}

/**
 * Thrown by {@link parse} when a value does not conform to a schema.
 * Use {@link safeParse} to receive a result rather than an exception.
 */
export class ConformError extends DataBehaveError {
  readonly issues: readonly Issue[]
  /** Root-relative — issues carry their own per-field paths. */
  readonly path: readonly (string | number)[] = []
  readonly hint?: string

  constructor(issues: readonly Issue[]) {
    const summary =
      issues.length === 1
        ? formatIssue(issues[0]!)
        : `${issues.length} issues:\n${issues.map((i) => '  - ' + formatIssue(i)).join('\n')}`
    super(summary)
    this.name = 'ConformError'
    this.issues = issues
  }
}

/**
 * Thrown when an axis combination is unsatisfiable
 * (e.g. invariants conflict with distribution, derived returns an
 * out-of-domain value, or primitive bounds are impossible such as
 * `int().min(10).max(5)`).
 *
 * Also thrown at schema-build time when a modifier does not apply to the
 * schema kind (e.g. `obj({...}).weighted([...])`). See the capability
 * matrix in `docs/STABILITY.md`.
 */
export class SchemaConflictError extends DataBehaveError {
  readonly path: readonly (string | number)[]
  readonly hint?: string

  constructor(message: string, path: readonly (string | number)[] = [], hint?: string) {
    super(hint ? `${message} (hint: ${hint})` : message)
    this.name = 'SchemaConflictError'
    this.path = path
    if (hint !== undefined) this.hint = hint
  }
}

const formatIssue = (i: Issue): string => {
  const p = i.path.length === 0 ? '(root)' : i.path.map((s) => String(s)).join('.')
  const expected = i.expected !== undefined ? ` expected=${i.expected}` : ''
  const received =
    'received' in i
      ? ` received=${safeStringify(i.received)}`
      : ''
  return `${p}: ${i.message}${expected}${received}`
}

const safeStringify = (v: unknown): string => {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
