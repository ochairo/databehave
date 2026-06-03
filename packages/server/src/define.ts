import type { Config } from './types.js'

/**
 * Recursively freeze a value so mutation throws in strict mode.
 * Skips functions (handlers stay callable, and freezing their
 * own properties is rarely useful) and respects already-frozen
 * branches to avoid revisiting cycles.
 */
const deepFreeze = <T>(value: T, seen: WeakSet<object> = new WeakSet()): T => {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value as object)) return value
  seen.add(value as object)
  if (Object.isFrozen(value)) return value
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (v !== null && typeof v === 'object') deepFreeze(v, seen)
  }
  Object.freeze(value)
  return value
}

/**
 * Identity helper providing TypeScript intellisense at the config
 * call site. Equivalent to `(config: Config) => config`.
 *
 * In non-production environments the returned config is **deep**-frozen
 * so accidental mutation — including `config.routes['GET /x'] = …`
 * or pushing into `cors.allowMethods` — throws loudly in tests instead
 * of corrupting the server silently. Production skips the freeze to
 * avoid breaking callers that legitimately patch the object after
 * `defineConfig()` for env-specific wiring.
 *
 * Handler functions inside `routes` are intentionally left mutable
 * (they're rebuilt per call anyway) — freeze stops at function
 * boundaries.
 *
 * Usage:
 * ```ts
 * import { defineConfig } from '@databehave/server'
 * export default defineConfig({ routes: { ... } })
 * ```
 */
export const defineConfig = (config: Config): Config => {
  if (process.env.NODE_ENV !== 'production') {
    deepFreeze(config)
  }
  return config
}

/** @internal exported for the JSON config loader to apply the same protection. */
export const _deepFreezeForDev = <T>(value: T): T => {
  if (process.env.NODE_ENV !== 'production') deepFreeze(value)
  return value
}
