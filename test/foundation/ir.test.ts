/**
 * `withMods` — direct unit tests for the IR-level modifier merger.
 *
 * Builder fluent chains (.optional(), .nullable(), .default(), .describe(),
 * axis modifiers) all funnel through `withMods`. Each contract:
 *
 *   - immutability: returns a *new* node (never mutates the input)
 *   - patch overlays existing `mods` (right-hand wins for scalars)
 *   - `axes` patches are *deep-merged* via `mergeAxes`, not overwritten
 *   - identity-preserving when `patch.axes` is `undefined`
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import type { SchemaNode } from '../../src/foundation/ir.js'
import { withMods } from '../../src/foundation/ir.js'

describe('withMods', () => {
  const base: SchemaNode = { kind: 'string', format: 'plain' }

  it('returns a new node (does not mutate the input)', () => {
    const next = withMods(base, { optional: true })
    assert.notEqual(next, base)
    assert.equal((base as { mods?: unknown }).mods, undefined)
  })

  it('overlays scalar patches over existing modifiers', () => {
    const a = withMods(base, { optional: true, description: 'first' })
    const b = withMods(a, { description: 'second' })
    assert.equal(b.mods?.optional, true)
    assert.equal(b.mods?.description, 'second')
  })

  it('preserves the original axes when the patch has none', () => {
    const a = withMods(base, { axes: { invariants: [() => true] } })
    const b = withMods(a, { optional: true })
    assert.equal(b.mods?.axes?.invariants?.length, 1)
  })

  it('deep-merges axes when both sides have them (mergeAxes semantics)', () => {
    const a = withMods(base, { axes: { invariants: [() => true] } })
    const b = withMods(a, { axes: { invariants: [() => false] } })
    assert.equal(b.mods?.axes?.invariants?.length, 2, 'invariants concatenate')
  })

  it('preserves the core kind/payload of the node', () => {
    const a = withMods(base, { nullable: true })
    assert.equal(a.kind, 'string')
    assert.equal((a as { format?: string }).format, 'plain')
  })
})
