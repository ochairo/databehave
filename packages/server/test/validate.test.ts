import { describe, expect, it } from 'vitest'

import { compileValidator } from '../src/validation/validate.js'
import type { OasDoc, OasNode } from '../src/openapi/walker.js'

const EMPTY_DOC: OasDoc = {}

const compile = (schema: OasNode, doc: OasDoc = EMPTY_DOC) =>
  compileValidator(schema, doc)

describe('validate — primitive types', () => {
  it('accepts and rejects strings', () => {
    const v = compile({ type: 'string' })
    expect(v('hello', '/x')).toEqual([])
    expect(v(42, '/x')).toEqual([
      { path: '/x', keyword: 'type', message: 'expected string' },
    ])
  })
  it('integer rejects non-integer numbers', () => {
    const v = compile({ type: 'integer' })
    expect(v(3, '/x')).toEqual([])
    expect(v(3.5, '/x')[0]?.keyword).toBe('type')
  })
  it('number accepts ints and floats', () => {
    const v = compile({ type: 'number' })
    expect(v(3.5, '/x')).toEqual([])
    expect(v(3, '/x')).toEqual([])
  })
  it('boolean rejects strings', () => {
    const v = compile({ type: 'boolean' })
    expect(v(true, '/x')).toEqual([])
    expect(v('true', '/x')[0]?.keyword).toBe('type')
  })
  it('null with nullable: true accepts null', () => {
    const v = compile({ type: 'string', nullable: true })
    expect(v(null, '/x')).toEqual([])
  })
  it('OAS 3.1 ["string","null"] accepts null', () => {
    const v = compile({ type: ['string', 'null'] } as unknown as OasNode)
    expect(v(null, '/x')).toEqual([])
    expect(v(1, '/x')[0]?.keyword).toBe('type')
  })
  it('array type validates items', () => {
    const v = compile({ type: 'array', items: { type: 'string' } })
    expect(v(['a', 'b'], '/x')).toEqual([])
    expect(v(['a', 1], '/x').map((x) => x.path)).toEqual(['/x/1'])
  })
  it('object validates required + properties', () => {
    const v = compile({
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' }, age: { type: 'integer' } },
    })
    expect(v({ name: 'a' }, '/x')).toEqual([])
    const errs = v({ age: 1.5 }, '/x')
    expect(errs.some((e) => e.keyword === 'required')).toBe(true)
    expect(errs.some((e) => e.keyword === 'type')).toBe(true)
  })
})

describe('validate — additionalProperties', () => {
  it('false rejects extras', () => {
    const v = compile({
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: false,
    })
    const errs = v({ a: 'ok', b: 1 }, '/x')
    expect(errs.some((e) => e.keyword === 'additionalProperties')).toBe(true)
  })
  it('schema validates extras', () => {
    const v = compile({
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: { type: 'integer' },
    })
    expect(v({ a: 'ok', b: 1 }, '/x')).toEqual([])
    expect(v({ a: 'ok', b: 'bad' }, '/x')[0]?.path).toBe('/x/b')
  })
})

describe('validate — enum / pattern / format', () => {
  it('enum match / mismatch', () => {
    const v = compile({ enum: ['a', 'b', 1] } as unknown as OasNode)
    expect(v('a', '/x')).toEqual([])
    expect(v(1, '/x')).toEqual([])
    expect(v('z', '/x')[0]?.keyword).toBe('enum')
  })
  it('pattern match / mismatch', () => {
    const v = compile({ type: 'string', pattern: '^[a-z]+$', maxLength: 16 })
    expect(v('abc', '/x')).toEqual([])
    expect(v('ABC', '/x')[0]?.keyword).toBe('pattern')
  })
  it('format: date', () => {
    const v = compile({ type: 'string', format: 'date' })
    expect(v('2026-06-02', '/x')).toEqual([])
    expect(v('2026-13-99', '/x')[0]?.keyword).toBe('format')
  })
  it('format: date-time', () => {
    const v = compile({ type: 'string', format: 'date-time' })
    expect(v('2026-06-02T12:34:56Z', '/x')).toEqual([])
    expect(v('2026-06-02 12:34', '/x')[0]?.keyword).toBe('format')
  })
  it('format: email', () => {
    const v = compile({ type: 'string', format: 'email' })
    expect(v('a@b.co', '/x')).toEqual([])
    expect(v('not-email', '/x')[0]?.keyword).toBe('format')
  })
  it('format: uuid', () => {
    const v = compile({ type: 'string', format: 'uuid' })
    expect(v('11111111-2222-3333-4444-555555555555', '/x')).toEqual([])
    expect(v('xxx', '/x')[0]?.keyword).toBe('format')
  })
  it('format: uri', () => {
    const v = compile({ type: 'string', format: 'uri' })
    expect(v('https://example.com/x', '/x')).toEqual([])
    expect(v('not a uri', '/x')[0]?.keyword).toBe('format')
  })
})

describe('validate — combinators', () => {
  it('oneOf requires exactly one match', () => {
    const v = compile({
      oneOf: [{ type: 'string' }, { type: 'integer' }],
    })
    expect(v('a', '/x')).toEqual([])
    expect(v(1, '/x')).toEqual([])
    expect(v(true, '/x')[0]?.keyword).toBe('oneOf')
  })
  it('anyOf passes when one branch passes', () => {
    const v = compile({
      anyOf: [{ type: 'string' }, { type: 'integer' }],
    })
    expect(v(1, '/x')).toEqual([])
    expect(v(true, '/x')[0]?.keyword).toBe('anyOf')
  })
  it('allOf concatenates constraints', () => {
    const v = compile({
      allOf: [{ type: 'string' }, { minLength: 3 } as unknown as OasNode],
    })
    expect(v('abcd', '/x')).toEqual([])
    expect(v('a', '/x').some((e) => e.keyword === 'minLength')).toBe(true)
  })
  it('discriminator dispatches by tag', () => {
    const doc: OasDoc = {
      components: {
        schemas: {
          Cat: {
            type: 'object',
            required: ['kind', 'meow'],
            properties: { kind: { type: 'string' }, meow: { type: 'string' } },
          },
          Dog: {
            type: 'object',
            required: ['kind', 'bark'],
            properties: { kind: { type: 'string' }, bark: { type: 'string' } },
          },
        },
      },
    }
    const v = compileValidator(
      {
        oneOf: [
          { $ref: '#/components/schemas/Cat' },
          { $ref: '#/components/schemas/Dog' },
        ],
        discriminator: {
          propertyName: 'kind',
          mapping: {
            cat: '#/components/schemas/Cat',
            dog: '#/components/schemas/Dog',
          },
        },
      } as unknown as OasNode,
      doc,
    )
    expect(v({ kind: 'cat', meow: 'mrr' }, '/x')).toEqual([])
    expect(v({ kind: 'dog', meow: 'wrong' }, '/x').length).toBeGreaterThan(0)
  })
  it('discriminator unknown tag falls back to oneOf branch matching', () => {
    const doc: OasDoc = {
      components: {
        schemas: {
          Cat: {
            type: 'object',
            required: ['kind'],
            properties: { kind: { type: 'string' }, meow: { type: 'string' } },
          },
          Dog: {
            type: 'object',
            required: ['kind'],
            properties: { kind: { type: 'string' }, bark: { type: 'string' } },
          },
        },
      },
    }
    const v = compileValidator(
      {
        oneOf: [
          { $ref: '#/components/schemas/Cat' },
          { $ref: '#/components/schemas/Dog' },
        ],
        discriminator: {
          propertyName: 'kind',
          mapping: { cat: '#/components/schemas/Cat' },
        },
      } as unknown as OasNode,
      doc,
    )
    // tag 'unknown' is not in mapping; both Cat/Dog satisfy schema → ambiguous → discriminator violation.
    const errs = v({ kind: 'unknown' }, '/x')
    expect(errs.some((e) => e.keyword === 'discriminator')).toBe(true)
  })
  it('oneOf with more than one passing branch reports ambiguity', () => {
    const v = compile({
      oneOf: [{ type: 'string' }, { type: 'string', minLength: 0 } as OasNode],
    })
    const errs = v('hello', '/x')
    expect(errs.some((e) => e.keyword === 'oneOf' && /matched 2/.test(e.message))).toBe(
      true,
    )
  })
  it('discriminator on non-object value emits violation', () => {
    const doc: OasDoc = {
      components: { schemas: { Cat: { type: 'object' } } },
    }
    const v = compileValidator(
      {
        oneOf: [{ $ref: '#/components/schemas/Cat' }],
        discriminator: { propertyName: 'kind' },
      } as unknown as OasNode,
      doc,
    )
    expect(v(42, '/x').some((e) => e.keyword === 'discriminator')).toBe(true)
  })
  it('discriminator with tag missing or not a string emits violation', () => {
    const doc: OasDoc = {
      components: { schemas: { Cat: { type: 'object' } } },
    }
    const v = compileValidator(
      {
        oneOf: [{ $ref: '#/components/schemas/Cat' }],
        discriminator: { propertyName: 'kind' },
      } as unknown as OasNode,
      doc,
    )
    const errs = v({ kind: 42 }, '/x')
    expect(
      errs.some(
        (e) =>
          e.keyword === 'discriminator' &&
          /missing or not a string/.test(e.message),
      ),
    ).toBe(true)
  })
})

describe('validate — $ref', () => {
  it('resolves intra-doc $ref', () => {
    const doc: OasDoc = {
      components: {
        schemas: {
          Name: { type: 'string', minLength: 1 },
        },
      },
    }
    const v = compileValidator(
      { $ref: '#/components/schemas/Name' } as OasNode,
      doc,
    )
    expect(v('a', '/x')).toEqual([])
    expect(v('', '/x')[0]?.keyword).toBe('minLength')
  })
  it('throws on $ref cycle at build time', () => {
    const doc: OasDoc = {
      components: {
        schemas: {
          A: { $ref: '#/components/schemas/B' },
          B: { $ref: '#/components/schemas/A' },
        },
      },
    }
    expect(() =>
      compileValidator({ $ref: '#/components/schemas/A' } as OasNode, doc),
    ).toThrow(/cycle/i)
  })
  it('throws on remote $ref at build time', () => {
    expect(() =>
      compile({ $ref: 'https://example.com/x.json' } as OasNode),
    ).toThrow(/remote|external|http/i)
  })
})

describe('validate — build-time guards', () => {
  it('throws on unsupported keyword (if)', () => {
    expect(() =>
      compile({ if: { type: 'string' } } as unknown as OasNode),
    ).toThrow(/unsupported/i)
  })
  it('throws on ReDoS-sized pattern (>1024 chars)', () => {
    const big = 'a'.repeat(1025)
    expect(() =>
      compile({ type: 'string', pattern: big }),
    ).toThrow(/pattern/i)
  })
  it('throws on invalid regex', () => {
    expect(() =>
      compile({ type: 'string', pattern: '(', maxLength: 16 }),
    ).toThrow()
  })
  it('throws when nesting exceeds depth cap', () => {
    let node: OasNode = { type: 'string' }
    for (let i = 0; i < 70; i++) {
      node = { type: 'array', items: node }
    }
    expect(() => compile(node)).toThrow(/depth/i)
  })
  it('throws when properties map declares a polluted key', () => {
    const evil = JSON.parse('{"__proto__": {"type":"string"}}') as Record<string, OasNode>
    expect(() =>
      compile({ type: 'object', properties: evil }),
    ).toThrow(/forbidden property name/i)
  })
  it('throws on $ref pointing at a non-existent component', () => {
    expect(() =>
      compileValidator({ $ref: '#/components/schemas/Missing' } as OasNode, {}),
    ).toThrow(/not found/i)
  })
})

describe('validate — numeric / length / array bounds', () => {
  it('minLength / maxLength', () => {
    const v = compile({ type: 'string', minLength: 2, maxLength: 4 })
    expect(v('abc', '/x')).toEqual([])
    expect(v('a', '/x')[0]?.keyword).toBe('minLength')
    expect(v('abcde', '/x')[0]?.keyword).toBe('maxLength')
  })
  it('minimum / maximum / exclusive', () => {
    const v = compile({
      type: 'number',
      minimum: 0,
      maximum: 10,
      exclusiveMinimum: 0,
      exclusiveMaximum: 10,
    } as OasNode)
    expect(v(5, '/x')).toEqual([])
    expect(v(0, '/x')[0]?.keyword).toBe('exclusiveMinimum')
    expect(v(10, '/x')[0]?.keyword).toBe('exclusiveMaximum')
    expect(v(-1, '/x').some((e) => e.keyword === 'minimum')).toBe(true)
    expect(v(11, '/x').some((e) => e.keyword === 'maximum')).toBe(true)
  })
  it('minItems / maxItems', () => {
    const v = compile({ type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 })
    expect(v(['a'], '/x')).toEqual([])
    expect(v([], '/x')[0]?.keyword).toBe('minItems')
    expect(v(['a', 'b', 'c'], '/x')[0]?.keyword).toBe('maxItems')
  })
})

describe('validate — runtime safety', () => {
  it('reports prototype-pollution own-key as a violation', () => {
    const v = compile({
      type: 'object',
      properties: { a: { type: 'string' } },
    })
    const polluted = JSON.parse('{"__proto__":{"polluted":true},"a":"ok"}') as unknown
    const errs = v(polluted, '/x')
    expect(errs.some((e) => e.keyword === 'prototypePollution')).toBe(true)
  })
  it('does not flag inherited keys (only own)', () => {
    const v = compile({ type: 'object', properties: {} })
    expect(v({}, '/x').some((e) => e.keyword === 'prototypePollution')).toBe(
      false,
    )
  })
  it('throws at build time when `pattern` is set without an own `maxLength`', () => {
    expect(() =>
      compile({ type: 'string', pattern: '^a+$' }),
    ).toThrow(/pattern requires maxLength on the same schema \(footgun: ReDoS\) at #/)
  })
  it('builds and validates when both `pattern` and `maxLength` are set on the same node', () => {
    const v = compile({ type: 'string', pattern: '^a+$', maxLength: 64 })
    expect(v('aaa', '/x')).toEqual([])
    expect(v('zzz', '/x')[0]?.keyword).toBe('pattern')
  })
  it('does NOT inherit `maxLength` from a parent schema (must live next to pattern)', () => {
    expect(() =>
      compile({
        type: 'object',
        // parent has maxLength but child pattern does not — must throw.
        maxLength: 64,
        properties: { name: { type: 'string', pattern: '^a+$' } },
      } as unknown as OasNode),
    ).toThrow(/pattern requires maxLength/)
  })
  it('deepEqual returns false (no stack overflow) when input nests deeper than the cap', () => {
    // Build a > 64-level deeply-nested input and compare against a flat
    // enum entry. Implementation should bottom out at the cap and treat
    // as not-equal so the caller emits a 422 (not crash the process).
    type Nested = { next?: Nested }
    const root: Nested = {}
    let cur: Nested = root
    for (let i = 0; i < 200; i++) {
      const child: Nested = {}
      cur.next = child
      cur = child
    }
    const v = compile({ enum: [{}] } as unknown as OasNode)
    // The deeply-nested object is NOT structurally equal to `{}` (which
    // has no `next` key). Caller must not stack-overflow.
    const errs = v(root, '/x')
    expect(errs[0]?.keyword).toBe('enum')
  })
  it('discriminator violation message redacts the user-supplied tag', () => {
    const doc: OasDoc = {
      components: {
        schemas: {
          Cat: {
            type: 'object',
            required: ['kind'],
            properties: { kind: { type: 'string' } },
          },
          Dog: {
            type: 'object',
            required: ['kind'],
            properties: { kind: { type: 'string' } },
          },
        },
      },
    }
    const v = compileValidator(
      {
        oneOf: [
          { $ref: '#/components/schemas/Cat' },
          { $ref: '#/components/schemas/Dog' },
        ],
        discriminator: {
          propertyName: 'kind',
          mapping: { cat: '#/components/schemas/Cat' },
        },
      } as unknown as OasNode,
      doc,
    )
    const errs = v({ kind: '<script>alert(1)</script>' }, '/x')
    const disc = errs.find((e) => e.keyword === 'discriminator')
    expect(disc?.message).toContain('[redacted]')
    expect(disc?.message).not.toContain('script')
    expect(disc?.message).not.toContain('alert')
  })
})
