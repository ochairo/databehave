/**
 * Unit tests for the small pure helpers used by the browser admin
 * panel. The admin/ui/** modules are excluded from coverage (browser
 * bundle, exercised end-to-end by Playwright), so these tests guard
 * the *logic* (base64 round-trip, schema sampler, etc.) against
 * regression without bringing JSDOM into the node suite.
 */
import { describe, expect, it } from 'vitest'

import { utf8ToBase64, base64ToUtf8, isAscii } from '../../src/admin/ui/utils/base64.js'
import { sanitiseMarkdown } from '../../src/admin/ui/utils/sanitise-markdown.js'
import { exampleFromSchema } from '../../src/admin/ui/utils/example-from-schema.js'
import { METHOD_COLORS, modeDotColor } from '../../src/admin/ui/utils/colors.js'
import { buildOperations, groupOperations, opKey, overrideCountsByOp, createStore } from '../../src/admin/ui/store.js'
import type { OpenApiDoc, RouteSummary, StickyOverride } from '../../src/admin/ui/types.js'

describe('ui/utils/base64', () => {
  it('round-trips ASCII and non-ASCII strings', () => {
    for (const s of ['hello', 'Resource was modified during the operation and cannot be reapplied.', '🚀💥']) {
      expect(base64ToUtf8(utf8ToBase64(s))).toBe(s)
    }
  })
  it('isAscii detects non-ASCII', () => {
    expect(isAscii('plain')).toBe(true)
    expect(isAscii('café')).toBe(false)
  })
})

describe('ui/utils/sanitise-markdown', () => {
  it('returns empty string for undefined', () => {
    expect(sanitiseMarkdown(undefined)).toBe('')
  })
  it('escapes HTML', () => {
    expect(sanitiseMarkdown('<script>x</script>')).toContain('&lt;script&gt;')
  })
  it('renders backticks as <code>', () => {
    expect(sanitiseMarkdown('use `foo` here')).toContain('<code>foo</code>')
  })
  it('splits paragraphs', () => {
    const out = sanitiseMarkdown('one\n\ntwo')
    expect(out).toContain('<p>one</p>')
    expect(out).toContain('<p>two</p>')
  })
})

describe('ui/utils/example-from-schema', () => {
  const doc: OpenApiDoc = { components: { schemas: { User: { type: 'object', properties: { id: { type: 'string' } } } } } }
  it('honors example and default', () => {
    expect(exampleFromSchema({ type: 'string', example: 'hi' }, null)).toBe('hi')
    expect(exampleFromSchema({ type: 'string', default: 'd' }, null)).toBe('d')
  })
  it('honors enum first value', () => {
    expect(exampleFromSchema({ type: 'string', enum: ['a', 'b'] }, null)).toBe('a')
  })
  it('emits primitive defaults', () => {
    expect(exampleFromSchema({ type: 'string' }, null)).toBe('string')
    expect(exampleFromSchema({ type: 'integer' }, null)).toBe(0)
    expect(exampleFromSchema({ type: 'boolean' }, null)).toBe(true)
  })
  it('resolves $ref via doc', () => {
    const ex = exampleFromSchema({ $ref: '#/components/schemas/User' }, doc) as Record<string, unknown>
    expect(ex.id).toBe('string')
  })
  it('handles array of items', () => {
    expect(exampleFromSchema({ type: 'array', items: { type: 'integer' } }, null)).toEqual([0])
  })
  it('handles oneOf / anyOf / allOf', () => {
    expect(exampleFromSchema({ oneOf: [{ type: 'string' }] }, null)).toBe('string')
    expect(exampleFromSchema({ anyOf: [{ type: 'integer' }] }, null)).toBe(0)
    const merged = exampleFromSchema({
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } } },
        { type: 'object', properties: { b: { type: 'integer' } } },
      ],
    }, null) as Record<string, unknown>
    expect(merged).toEqual({ a: 'string', b: 0 })
  })
  it('returns null past max depth', () => {
    expect(exampleFromSchema({ type: 'string' }, null, 99)).toBeNull()
  })
  it('returns null for undefined schema', () => {
    expect(exampleFromSchema(undefined, null)).toBeNull()
  })
})

describe('ui/utils/colors', () => {
  it('has a color per common method', () => {
    expect(METHOD_COLORS.GET).toBeTruthy()
    expect(METHOD_COLORS.POST).toBeTruthy()
  })
  it('maps mode kinds to severity', () => {
    expect(modeDotColor('http-status')).toBe('#cf222e')
    expect(modeDotColor('delay')).toBe('#bf8700')
    expect(modeDotColor('custom-body')).toBe('#0969da')
  })
})

describe('ui/store', () => {
  const routes: RouteSummary[] = [
    { method: 'GET', path: '/api/v1/health', summary: 'health' },
    { method: 'POST', path: '/api/v1/widgets/copy' },
  ]
  const doc: OpenApiDoc = {
    paths: { '/api/v1/widgets/copy': { post: { tags: ['widgets'], summary: 'copy' } } },
  }

  it('opKey normalises method case', () => {
    expect(opKey('get', '/x')).toBe('GET /x')
  })

  it('buildOperations groups by tag when present, falls back to first path segment', () => {
    const ops = buildOperations(routes, doc)
    expect(ops).toHaveLength(2)
    const ship = ops.find((o) => o.path === '/api/v1/widgets/copy')
    expect(ship?.groupLabel).toBe('widgets')
    const health = ops.find((o) => o.path === '/api/v1/health')
    expect(health?.groupLabel).toBe('api')
  })

  it('buildOperations preserves route summary when op has none', () => {
    const ops = buildOperations(routes, null)
    expect(ops[0]?.op.summary).toBe('health')
  })

  it('groupOperations sorts alphabetically and within group by path then method', () => {
    const ops = buildOperations([
      { method: 'POST', path: '/zoo/y' },
      { method: 'GET', path: '/zoo/x' },
      { method: 'GET', path: '/animals/a' },
    ], null)
    const groups = groupOperations(ops, new Map())
    expect(groups.map((g) => g.label)).toEqual(['animals', 'zoo'])
    expect(groups[1]?.ops.map((o) => o.path)).toEqual(['/zoo/x', '/zoo/y'])
  })

  it('overrideCountsByOp counts only exact matchers', () => {
    const overrides: StickyOverride[] = [
      { id: '1', matcher: { kind: 'exact', method: 'GET', path: '/x' }, mode: { kind: 'http-status', status: 500 }, createdAt: 'now' },
      { id: '2', matcher: { kind: 'global' }, mode: { kind: 'http-status', status: 500 }, createdAt: 'now' },
      { id: '3', matcher: { kind: 'path', path: '/y' }, mode: { kind: 'http-status', status: 500 }, createdAt: 'now' },
      { id: '4', matcher: { kind: 'exact', method: 'GET', path: '/x' }, mode: { kind: 'http-status', status: 500 }, createdAt: 'now' },
    ]
    const counts = overrideCountsByOp(overrides)
    expect(counts.get('GET /x')).toBe(2)
    expect(counts.size).toBe(1)
  })

  it('createStore notifies subscribers on set; unsubscribe stops notifications', () => {
    const store = createStore('en')
    let seen = 0
    const off = store.subscribe(() => { seen++ })
    store.set({ search: 'x' })
    expect(seen).toBe(1)
    expect(store.get().search).toBe('x')
    off()
    store.set({ search: 'y' })
    expect(seen).toBe(1)
  })
})
