import type { Operation, RouteSummary, ScenarioSummary, StickyOverride, OpenApiDoc } from './types.js'

export interface UiState {
  search: string
  methods: Set<string>
  activeOnly: boolean
  rightPanelOpen: boolean
  helpOpen: boolean
  globalOpen: boolean
  expandedKey: string | null
  /** Operation row that is selected for keyboard nav (may differ from expanded). */
  focusedKey: string | null
  routes: RouteSummary[]
  doc: OpenApiDoc | null
  overrides: StickyOverride[]
  scenarios: ScenarioSummary[]
  loading: boolean
}

type Listener = (s: UiState) => void

const defaultState = (): UiState => ({
  search: '',
  methods: new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
  activeOnly: false,
  rightPanelOpen: false,
  helpOpen: false,
  globalOpen: false,
  expandedKey: null,
  focusedKey: null,
  routes: [],
  doc: null,
  overrides: [],
  scenarios: [],
  loading: true,
})

export const opKey = (method: string, path: string): string =>
  `${method.toUpperCase()} ${path}`

/**
 * Tiny pub/sub store backed by a Set of listeners. Subscribers are
 * notified synchronously on every `set(...)`. Returns an `unsubscribe`
 * fn from `subscribe(...)`. No diffing — components are expected to
 * either re-render the whole subtree they own or compare what they
 * care about themselves.
 *
 * Accepts (and ignores) any positional arg — kept for backward
 * compatibility with callers that used to pass the dropped `Lang`.
 */
export const createStore = (..._args: unknown[]) => {
  void _args
  let state: UiState = defaultState()
  const listeners = new Set<Listener>()

  const get = (): UiState => state
  const set = (patch: Partial<UiState>): void => {
    state = { ...state, ...patch }
    for (const fn of listeners) fn(state)
  }
  const subscribe = (fn: Listener): (() => void) => {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }
  return { get, set, subscribe }
}

export type Store = ReturnType<typeof createStore>

/** Build the Operation list once routes + doc are loaded. */
export const buildOperations = (
  routes: RouteSummary[],
  doc: OpenApiDoc | null,
): Operation[] => {
  const out: Operation[] = []
  for (const r of routes) {
    const op = doc?.paths?.[r.path]?.[r.method.toLowerCase()] ?? {}
    const tag = op.tags?.[0]
    const fallback = r.path.split('/').filter(Boolean)[0] ?? 'other'
    const groupLabel = tag ?? fallback
    out.push({
      method: r.method.toUpperCase(),
      path: r.path,
      op: { ...op, ...(r.summary && !op.summary ? { summary: r.summary } : {}) },
      groupKey: groupLabel.toLowerCase(),
      groupLabel,
      source: r.source ?? 'openapi',
    })
  }
  return out
}

export interface OperationGroup {
  key: string
  label: string
  ops: Operation[]
}

export const groupOperations = (
  ops: Operation[],
  overrideCounts: Map<string, number>,
): OperationGroup[] => {
  const groups = new Map<string, OperationGroup>()
  for (const op of ops) {
    const g = groups.get(op.groupKey) ?? { key: op.groupKey, label: op.groupLabel, ops: [] as Operation[] }
    g.ops.push(op)
    groups.set(op.groupKey, g)
  }
  for (const g of groups.values()) {
    g.ops.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)))
  }
  void overrideCounts // overrideCounts is consumed by the renderer; signature kept for clarity
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label))
}

/** Count active overrides per opKey (exact matchers only). path/global apply broadly so are not tied to a single row. */
export const overrideCountsByOp = (overrides: StickyOverride[]): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const o of overrides) {
    if (o.matcher.kind !== 'exact') continue
    const k = opKey(o.matcher.method, o.matcher.path)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return counts
}
