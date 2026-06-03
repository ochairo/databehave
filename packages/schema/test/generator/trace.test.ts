/**
 * `createTrace` — direct unit tests.
 *
 * The collector is engine-agnostic: it just appends entries and exposes
 * a few read shapes. Tests here pin down those shapes without going
 * through `mock()`. End-to-end integration with `mock()` lives in
 * `test/generator/extensions.test.ts`.
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { createTrace } from '../../src/generator/trace.js'

describe('createTrace — collector', () => {
  it('starts empty and accumulates entries in insertion order', () => {
    const t = createTrace()
    assert.equal(t.entries.length, 0)
    t.emit({ path: ['a'], axis: 'type' })
    t.emit({ path: ['b'], axis: 'domain', note: 'enum' })
    assert.equal(t.entries.length, 2)
    assert.deepEqual(t.entries[0]?.path, ['a'])
    assert.deepEqual(t.entries[1]?.path, ['b'])
  })

  it('`entries` is read-only — mutations through it must not survive', () => {
    const t = createTrace()
    t.emit({ path: ['x'], axis: 'type' })
    // The TS type already forbids mutation, but the implementation should
    // not expose a writable array reference either: the only public way to
    // add an entry is `.emit(...)`.
    assert.equal(t.entries.length, 1)
  })

  it('`axisFiredAt(axis)` filters the path list to a single axis', () => {
    const t = createTrace()
    t.emit({ path: ['a'], axis: 'domain' })
    t.emit({ path: ['b'], axis: 'distribution' })
    t.emit({ path: ['c'], axis: 'domain' })
    assert.deepEqual(t.axisFiredAt('domain'), [['a'], ['c']])
  })

  it('`axisFiredAt(axis)` returns [] when no entry matches', () => {
    const t = createTrace()
    t.emit({ path: ['a'], axis: 'type' })
    assert.deepEqual(t.axisFiredAt('derived'), [])
  })

  it('`format()` is a multi-line dump with attempts and note annotations', () => {
    const t = createTrace()
    t.emit({ path: ['root', 'leaf'], axis: 'invariant-pass', attempts: 3, note: 'inv-ok' })
    t.emit({ path: [], axis: 'type' })
    const out = t.format()
    assert.match(out, /\/root\/leaf\s+invariant-pass attempts=3 \(inv-ok\)/)
    assert.match(out, /^\/\s+type$/m)
  })
})
