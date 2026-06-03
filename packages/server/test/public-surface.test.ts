/**
 * Phase 11 — API surface lock for @databehave/server.
 *
 * Locks the consumer-visible exports. Adding a name is non-breaking
 * (extend the list); removing or renaming is a SemVer MAJOR change
 * (see `docs/stability.md`).
 *
 * `@databehave/server` is standalone — schema DSL names live in
 * `@databehave/schema` and must be imported from there directly.
 */
import { describe, it, expect } from 'vitest'

import * as ServerExports from '../src/index.js'

const EXPECTED_EXPORTS: readonly string[] = [
  // factories
  'createServer',
  'defineConfig',
  'run',
  'seedFor',
  // config loader
  'loadConfig',
  // mock-mode
  'resolveStatus',
].slice().sort()

const ALL_EXPECTED: readonly string[] = [...EXPECTED_EXPORTS].slice().sort()

describe('public API surface — `@databehave/server` root entry', () => {
  it('exports match the locked list (SemVer MAJOR to change)', () => {
    const actual = Object.keys(ServerExports as unknown as Record<string, unknown>)
      .filter((k) => k !== 'default')
      .slice()
      .sort()
    expect(actual).toEqual(ALL_EXPECTED)
  })

  it('exposes the documented @databehave/server-specific factories', () => {
    for (const name of EXPECTED_EXPORTS) {
      expect(ServerExports, `missing public export: ${name}`).toHaveProperty(name)
    }
  })

  it('does not re-export the `@databehave/schema` DSL surface', () => {
    // server is standalone — schema names must be imported directly
    // from `@databehave/schema` by the consumer.
    const schemaNames = ['obj', 'str', 'int', 'bool', 'mock', 'parse']
    for (const name of schemaNames) {
      expect(
        ServerExports,
        `unexpected schema re-export: ${name}`,
      ).not.toHaveProperty(name)
    }
  })
})
