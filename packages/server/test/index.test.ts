/**
 * Surface contract for the public barrel (`src/index.ts`).
 *
 * Pins both the *presence* of each documented export and (via
 * `expectTypeOf`) the *shape* of the runtime entry points, so an
 * accidental rename, signature change, or deletion breaks a focused
 * test instead of an opaque downstream build.
 */
import { describe, expect, expectTypeOf, it } from 'vitest'

import * as serverExports from '../src/index.js'
import type {
  Config,
  ListenHandle,
  Server,
} from '../src/index.js'

describe('public entry (src/index.ts)', () => {
  it('exports the documented runtime API', () => {
    const expected = [
      'defineConfig',
      'createServer',
      'seedFor',
      'loadConfig',
      'resolveStatus',
    ] as const
    for (const name of expected) {
      expect(typeof (serverExports as Record<string, unknown>)[name]).toBe('function')
    }
  })

  it('does not re-export `@databehave/schema` (server is standalone)', () => {
    // `@databehave/server` runs standalone for OAS-only consumers.
    // Schema DSL names (`obj`, `str`, `mock`, ...) live in
    // `@databehave/schema` and must be imported from there directly.
    const passthrough = ['obj', 'str', 'int', 'bool', 'arr', 'mock'] as const
    for (const name of passthrough) {
      expect((serverExports as Record<string, unknown>)[name]).toBeUndefined()
    }
  })

  it('pins the public function signatures via `expectTypeOf`', () => {
    // Type-only assertions (no runtime evaluation of `serverExports.*`) so a
    // server instance isn't built just to read its type. Catches
    // accidental signature drift (renamed argument, widened return)
    // without paying runtime cost.
    expectTypeOf<typeof serverExports.defineConfig>()
      .parameter(0)
      .toEqualTypeOf<Config>()
    expectTypeOf<typeof serverExports.createServer>()
      .parameter(0)
      .toEqualTypeOf<Config>()
    expectTypeOf<
      ReturnType<typeof serverExports.createServer>
    >().toEqualTypeOf<Server>()
    expectTypeOf<
      Awaited<ReturnType<Server['listen']>>
    >().toEqualTypeOf<ListenHandle>()
  })
})
