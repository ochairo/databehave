/**
 * In-memory sticky overrides registry. Lost on process restart by
 * design — this tool is for ad-hoc dev sessions, not persistence.
 *
 * Resolution priority (first hit wins): `exact` > `path` > `global`.
 * When two stickies live at the same priority level, the **last** one
 * added wins (and a warning is logged) so the dev's most-recent click
 * in the UI is always the active rule.
 */
import { randomUUID } from 'node:crypto'

import type { ErrorMode, StickyMatcher, StickyOverride } from './admin-types.js'

export interface OverridesStoreLogger {
  warn(message: string): void
  info?(message: string): void
}

export interface OverridesStore {
  add(input: {
    matcher: StickyMatcher
    mode: ErrorMode
    description?: string
  }): StickyOverride
  remove(id: string): boolean
  list(): readonly StickyOverride[]
  clear(): number
  resolve(method: string, path: string): StickyOverride | undefined
}

export const createOverridesStore = (
  logger: OverridesStoreLogger = console
): OverridesStore => {
  // Insertion-ordered. `Map.values()` yields oldest → newest, so
  // when iterating we keep track of the *last* hit per priority bucket.
  const byId = new Map<string, StickyOverride>()

  const sameMatcher = (a: StickyMatcher, b: StickyMatcher): boolean => {
    if (a.kind !== b.kind) return false
    if (a.kind === 'exact' && b.kind === 'exact') {
      return (
        a.method.toUpperCase() === b.method.toUpperCase() && a.path === b.path
      )
    }
    if (a.kind === 'path' && b.kind === 'path') return a.path === b.path
    return a.kind === 'global' && b.kind === 'global'
  }

  const describeMatcher = (m: StickyMatcher): string => {
    if (m.kind === 'exact') return `${m.method.toUpperCase()} ${m.path}`
    if (m.kind === 'path') return `* ${m.path}`
    return '* (global)'
  }

  const add: OverridesStore['add'] = ({ matcher, mode, description }) => {
    // Detect same-matcher collision so the warning is informative.
    for (const existing of byId.values()) {
      if (sameMatcher(existing.matcher, matcher)) {
        logger.warn(
          `[mock-server/overrides] duplicate matcher ${describeMatcher(
            matcher
          )} ` +
            `— new rule shadows ${existing.id} (last-wins). Remove the old one if unintended.`
        )
      }
    }
    const override: StickyOverride = {
      id: randomUUID(),
      matcher:
        matcher.kind === 'exact'
          ? {
              kind: 'exact',
              method: matcher.method.toUpperCase(),
              path: matcher.path,
            }
          : matcher.kind === 'global' && matcher.methods && matcher.methods.length > 0
            ? {
                kind: 'global',
                methods: matcher.methods.map((m) => m.toUpperCase()),
              }
            : matcher.kind === 'global'
              ? { kind: 'global' }
              : matcher,
      mode,
      createdAt: new Date().toISOString(),
      ...(description !== undefined ? { description } : {}),
    }
    byId.set(override.id, override)
    return override
  }

  const remove: OverridesStore['remove'] = (id) => byId.delete(id)

  const list: OverridesStore['list'] = () => [...byId.values()]

  const clear: OverridesStore['clear'] = () => {
    const n = byId.size
    byId.clear()
    return n
  }

  const resolve: OverridesStore['resolve'] = (method, path) => {
    const m = method.toUpperCase()
    // Walk newest → oldest so the last-added rule wins per bucket.
    const all = [...byId.values()].reverse()
    let exactHit: StickyOverride | undefined
    let pathHit: StickyOverride | undefined
    let globalHit: StickyOverride | undefined
    for (const o of all) {
      if (o.matcher.kind === 'exact') {
        if (!exactHit && o.matcher.method === m && o.matcher.path === path) {
          exactHit = o
        }
      } else if (o.matcher.kind === 'path') {
        if (!pathHit && o.matcher.path === path) pathHit = o
      } else {
        if (
          !globalHit
          && (!o.matcher.methods
            || o.matcher.methods.length === 0
            || o.matcher.methods.includes(m))
        ) {
          globalHit = o
        }
      }
    }
    return exactHit ?? pathHit ?? globalHit
  }

  return { add, remove, list, clear, resolve }
}
