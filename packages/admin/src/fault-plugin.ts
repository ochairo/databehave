import { capability, type Plugin } from '@databehave/core'
import { httpCapability } from '@databehave/server'
import type { ErrorMode, OverrideMatcher, StickyOverride } from './admin-types.js'
import { createOverridesStore } from './overrides-store.js'
import { createInjectHook } from './inject.js'

/** Typed input for one new sticky fault. */
export interface FaultOverrideInput {
  readonly matcher: OverrideMatcher
  readonly mode: ErrorMode
  readonly description?: string
}

/** Narrow state boundary used by admin and alternative control plugins. */
export interface FaultControl {
  add(input: FaultOverrideInput): StickyOverride
  remove(id: string): boolean
  list(): readonly StickyOverride[]
  clear(): number
  /** Validates the entire input before a single atomic replacement. */
  replace(input: unknown): readonly StickyOverride[]
  /** Registration only; prevents control endpoints from injecting themselves. */
  excludePathPrefix(path: string): void
}

export const faultControlCapability = capability<FaultControl>('databehave.fault-control', 1)

/** Per-request fault policy; sticky state is instance-local and owned by this plugin. */
export interface FaultInjectionOptions {
  readonly headers?: boolean
  readonly allowDestroy?: boolean
  readonly bypassPathPrefixes?: readonly string[]
}

/** Enable fault interception independently of the admin UI and persistence. */
export const faultInjectionPlugin = (options: FaultInjectionOptions = {}): Plugin => ({
  id: 'databehave.fault-injection', apiVersion: 1,
  requires: [httpCapability], provides: [faultControlCapability],
  setup(ctx) {
    const store = createOverridesStore()
    const bypass = [...(options.bypassPathPrefixes ?? [])]
    let sealed = false
    ctx.onSeal(() => { sealed = true })
    ctx.provide(faultControlCapability, {
      add: store.add, remove: store.remove, list: store.list, clear: store.clear, replace: store.replace,
      excludePathPrefix(path) {
        if (sealed) throw new Error('Fault exclusions are sealed')
        bypass.push(path)
      },
    })
    ctx.use(httpCapability).registerMiddleware({
      owner: 'databehave.fault-injection', order: ctx.order, stage: 'interception',
      handle: createInjectHook({ store, bypassPathPrefixes: bypass,
        ...(options.headers !== undefined ? { headers: options.headers } : {}),
        ...(options.allowDestroy !== undefined ? { allowDestroy: options.allowDestroy } : {}),
      }),
    })
  },
})
