/**
 * Error hierarchy — formatting and contract.
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { ConformError, SchemaConflictError, parse, safeParse, int, obj, str } from '../../src/index.js'

describe('ConformError', () => {
  it('is a real Error subclass with name="ConformError"', () => {
    const e = new ConformError([{ path: ['x'], message: 'bad' }])
    assert.ok(e instanceof Error)
    assert.equal(e.name, 'ConformError')
  })

  it('formats a single issue inline as "path: message expected=… received=…"', () => {
    try {
      parse(int(), 'oops')
      assert.fail('expected throw')
    } catch (e) {
      assert.ok(e instanceof ConformError)
      const msg = (e as Error).message
      assert.match(msg, /\(root\)/)
      assert.match(msg, /expected number/)
      assert.match(msg, /received="oops"/)
    }
  })

  it('renders the root path as "(root)"', () => {
    const e = new ConformError([{ path: [], message: 'wrong' }])
    assert.match(e.message, /\(root\)/)
  })

  it('renders nested paths as dot-joined strings', () => {
    const e = new ConformError([{ path: ['user', 'id'], message: 'bad' }])
    assert.match(e.message, /user\.id/)
  })

  it('preserves array index segments in path', () => {
    const e = new ConformError([{ path: ['items', 2, 'name'], message: 'bad' }])
    assert.match(e.message, /items\.2\.name/)
  })

  it('summarises multiple issues with a count and bullet list', () => {
    const r = safeParse(obj({ a: int(), b: str() }), { a: 'x', b: 1 } as unknown)
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.match(r.error.message, /^2 issues/)
    assert.ok(r.error.message.split('\n').length >= 3)
  })

  it('safeStringify falls back to String(v) for values that cannot be JSON-encoded', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const e = new ConformError([{ path: [], message: 'bad', received: circular }])
    // Must not throw; must contain some representation of the value.
    assert.ok(typeof e.message === 'string')
    assert.match(e.message, /received=/)
  })

  it('omits "expected=" and "received=" when not provided', () => {
    const e = new ConformError([{ path: ['x'], message: 'plain' }])
    assert.ok(!/expected=/.test(e.message))
    assert.ok(!/received=/.test(e.message))
  })
})

describe('SchemaConflictError', () => {
  it('has name="SchemaConflictError" and exposes path/hint', () => {
    const e = new SchemaConflictError('boom', ['a', 'b'], 'narrow bounds')
    assert.equal(e.name, 'SchemaConflictError')
    assert.deepEqual(e.path, ['a', 'b'])
    assert.equal(e.hint, 'narrow bounds')
  })

  it('appends the hint to the message in parentheses', () => {
    const e = new SchemaConflictError('boom', [], 'try less')
    assert.match(e.message, /boom \(hint: try less\)/)
  })

  it('omits hint formatting when no hint is given', () => {
    const e = new SchemaConflictError('boom')
    assert.equal(e.message, 'boom')
    assert.equal(e.hint, undefined)
  })
})
