/**
 * Unit tests for the in-server OAS mock generator (`generateFromOasSchema`).
 *
 * Output is deterministic placeholder data — each branch asserts the
 * exact value the generator emits so callers can pin test fixtures
 * without reading the source.
 */
import { describe, expect, it } from 'vitest'

import { generateFromOasSchema } from '../src/openapi/generate.js'
import type { OasDoc, OasNode } from '../src/openapi/walker.js'

const DOC: OasDoc = {
  components: {
    schemas: {
      Self: {
        type: 'object',
        properties: { next: { $ref: '#/components/schemas/Self' } },
      },
      Leaf: { type: 'string' },
    },
  },
}

const gen = (node: OasNode): unknown => generateFromOasSchema(node, DOC)

describe('generateFromOasSchema (OAS-only mock generator)', () => {
  it('honours `example` verbatim when present', () => {
    expect(gen({ type: 'string', example: 'hello' })).toBe('hello')
  })

  it('honours the first `examples[]` entry', () => {
    expect(gen({ type: 'integer', examples: [42, 99] })).toBe(42)
  })

  it('returns the first `enum` member', () => {
    expect(gen({ enum: ['a', 'b', 'c'] })).toBe('a')
  })

  it('honours `const`', () => {
    expect(gen({ const: 'fixed' })).toBe('fixed')
  })

  it('emits the deterministic string placeholder', () => {
    expect(gen({ type: 'string' })).toBe('string')
  })

  it('emits format-aware string placeholders', () => {
    expect(gen({ type: 'string', format: 'date' })).toBe('2024-01-01')
    expect(gen({ type: 'string', format: 'date-time' })).toBe(
      '2024-01-01T00:00:00Z',
    )
    expect(gen({ type: 'string', format: 'email' })).toBe('user@example.com')
    expect(gen({ type: 'string', format: 'uuid' })).toBe(
      '00000000-0000-4000-8000-000000000000',
    )
    expect(gen({ type: 'string', format: 'uri' })).toBe('https://example.com/')
  })

  it('emits 0 for integers/numbers without `minimum`', () => {
    expect(gen({ type: 'integer' })).toBe(0)
    expect(gen({ type: 'number' })).toBe(0)
  })

  it('honours `minimum` for integers/numbers', () => {
    expect(gen({ type: 'integer', minimum: 5 })).toBe(5)
  })

  it('emits `false` for booleans', () => {
    expect(gen({ type: 'boolean' })).toBe(false)
  })

  it('emits an array of one item by default', () => {
    expect(gen({ type: 'array', items: { type: 'string' } })).toEqual(['string'])
  })

  it('honours `minItems` for repetition', () => {
    expect(
      gen({ type: 'array', items: { type: 'integer' }, minItems: 3 }),
    ).toEqual([0, 0, 0])
  })

  it('walks object `properties`', () => {
    expect(
      gen({
        type: 'object',
        properties: { id: { type: 'integer' }, name: { type: 'string' } },
      }),
    ).toEqual({ id: 0, name: 'string' })
  })

  it('treats OAS 3.1 `["string","null"]` as the concrete branch (never null)', () => {
    expect(gen({ type: ['string', 'null'] })).toBe('string')
  })

  it('treats OAS 3.0 `nullable: true` the same — concrete branch wins', () => {
    expect(gen({ type: 'string', nullable: true })).toBe('string')
  })

  it('emits `null` for `type: null`', () => {
    expect(gen({ type: 'null' })).toBeNull()
  })

  it('shallow-merges object branches under `allOf`', () => {
    expect(
      gen({
        allOf: [
          { type: 'object', properties: { a: { type: 'integer' } } },
          { type: 'object', properties: { b: { type: 'boolean' } } },
        ],
      }),
    ).toEqual({ a: 0, b: false })
  })

  it('picks the first branch under `oneOf`', () => {
    expect(
      gen({ oneOf: [{ type: 'integer', minimum: 7 }, { type: 'string' }] }),
    ).toBe(7)
  })

  it('picks the first branch under `anyOf`', () => {
    expect(gen({ anyOf: [{ type: 'string' }, { type: 'integer' }] })).toBe(
      'string',
    )
  })

  it('resolves intra-document `$ref`', () => {
    expect(gen({ $ref: '#/components/schemas/Leaf' })).toBe('string')
  })

  it('breaks `$ref` cycles by emitting `{}` on the second hit', () => {
    const v = gen({ $ref: '#/components/schemas/Self' }) as {
      next?: Record<string, unknown>
    }
    expect(v.next).toEqual({})
  })

  it('throws on a remote `$ref`', () => {
    expect(() =>
      generateFromOasSchema({ $ref: 'https://example.com/x.json' }, DOC),
    ).toThrow(/remote \$ref not supported/)
  })

  it('throws on a `$ref` shape other than `#/components/schemas/*`', () => {
    expect(() =>
      generateFromOasSchema({ $ref: '#/definitions/Foo' }, DOC),
    ).toThrow(/unsupported \$ref/)
  })

  it('throws when the `$ref` target is missing', () => {
    expect(() =>
      generateFromOasSchema({ $ref: '#/components/schemas/Missing' }, DOC),
    ).toThrow(/\$ref not found/)
  })

  it('throws on an unknown type', () => {
    expect(() => gen({ type: 'mystery' as never })).toThrow(
      /unsupported OpenAPI node/,
    )
  })

  it('treats an empty schema (`{}`) as `{}`', () => {
    expect(gen({})).toEqual({})
  })

  it('is deterministic — same input → same output', () => {
    const node: OasNode = {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        tags: { type: 'array', items: { type: 'string' }, minItems: 2 },
      },
    }
    expect(gen(node)).toEqual(gen(node))
  })

  it('accepts a `seed` option without changing output (reserved for future use)', () => {
    const node: OasNode = { type: 'string' }
    expect(generateFromOasSchema(node, {}, { seed: 1 })).toBe(
      generateFromOasSchema(node, {}, { seed: 999 }),
    )
  })
})
