/**
 * Unit tests for `src/openapi/translate.ts`.
 *
 * Mirrors the keyword matrix exercised by `validate.test.ts`, but
 * asserts on the produced `@databehave/schema` IR — either by
 * inspecting the `_node` (kind / fields / mods) directly or by piping
 * the IR through `mock(ir, { seed: 0 })` and checking the shape /
 * value. We pick whichever is clearer per case.
 */
import { describe, expect, it } from 'vitest'

import { translateOasToIR } from '../src/openapi/translate.js'
import type { OasDoc, OasNode } from '../src/openapi/walker.js'

const EMPTY_DOC: OasDoc = {}

const node = (n: { _node: unknown }): { kind: string; [k: string]: unknown } =>
  n._node as { kind: string; [k: string]: unknown }

describe('translate — primitive types', () => {
  it('string → StringSchema', async () => {
    const ir = await translateOasToIR({ type: 'string' }, EMPTY_DOC)
    expect(node(ir).kind).toBe('string')
  })
  it('integer → number with int=true', async () => {
    const ir = await translateOasToIR({ type: 'integer' }, EMPTY_DOC)
    expect(node(ir)).toMatchObject({ kind: 'number', int: true })
  })
  it('number → number with int=false', async () => {
    const ir = await translateOasToIR({ type: 'number' }, EMPTY_DOC)
    expect(node(ir)).toMatchObject({ kind: 'number', int: false })
  })
  it('boolean → boolean', async () => {
    const ir = await translateOasToIR({ type: 'boolean' }, EMPTY_DOC)
    expect(node(ir).kind).toBe('boolean')
  })
  it('null type → null', async () => {
    const ir = await translateOasToIR({ type: 'null' } as unknown as OasNode, EMPTY_DOC)
    expect(node(ir).kind).toBe('null')
  })
  it('nullable: true wraps with mods.nullable', async () => {
    const ir = await translateOasToIR({ type: 'string', nullable: true }, EMPTY_DOC)
    const n = node(ir) as { kind: string; mods?: { nullable?: boolean } }
    expect(n.kind).toBe('string')
    expect(n.mods?.nullable).toBe(true)
  })
  it('OAS 3.1 ["string","null"] picks non-null + nullable mod', async () => {
    const ir = await translateOasToIR(
      { type: ['string', 'null'] } as unknown as OasNode,
      EMPTY_DOC,
    )
    const n = node(ir) as { kind: string; mods?: { nullable?: boolean } }
    expect(n.kind).toBe('string')
    expect(n.mods?.nullable).toBe(true)
  })
})

describe('translate — strings: minLength / maxLength / pattern / format', () => {
  it('min/maxLength land on the IR', async () => {
    const ir = await translateOasToIR(
      { type: 'string', minLength: 2, maxLength: 7 },
      EMPTY_DOC,
    )
    expect(node(ir)).toMatchObject({ kind: 'string', min: 2, max: 7 })
  })
  it('pattern with own maxLength', async () => {
    const ir = await translateOasToIR(
      { type: 'string', pattern: '^[a-z]+$', maxLength: 16 },
      EMPTY_DOC,
    )
    expect(node(ir)).toMatchObject({ kind: 'string', pattern: '^[a-z]+$', max: 16 })
  })
  it('pattern without maxLength throws (ReDoS footgun guard)', async () => {
    await expect(
      translateOasToIR({ type: 'string', pattern: '^[a-z]+$' }, EMPTY_DOC),
    ).rejects.toThrow(/pattern requires maxLength/)
  })
  it('pattern length above 1024 throws (ReDoS cap)', async () => {
    const huge = 'a'.repeat(1025)
    await expect(
      translateOasToIR(
        { type: 'string', pattern: huge, maxLength: 4 },
        EMPTY_DOC,
      ),
    ).rejects.toThrow(/exceeds cap of 1024/)
  })
  it('invalid pattern throws at translate time', async () => {
    await expect(
      translateOasToIR(
        { type: 'string', pattern: '[unterminated', maxLength: 4 },
        EMPTY_DOC,
      ),
    ).rejects.toThrow(/invalid pattern/)
  })
  it('format: date / date-time / email / uuid / uri map onto StringFormat', async () => {
    const cases: Array<[string, string]> = [
      ['date', 'date'],
      ['date-time', 'datetime'],
      ['email', 'email'],
      ['uuid', 'uuid'],
      ['uri', 'url'],
    ]
    for (const [oas, expected] of cases) {
      const ir = await translateOasToIR({ type: 'string', format: oas }, EMPTY_DOC)
      expect((node(ir) as unknown as { format: string }).format).toBe(expected)
    }
  })
})

describe('translate — numerics', () => {
  it('minimum / maximum land on the IR', async () => {
    const ir = await translateOasToIR(
      { type: 'integer', minimum: 1, maximum: 5 },
      EMPTY_DOC,
    )
    expect(node(ir)).toMatchObject({ kind: 'number', int: true, min: 1, max: 5 })
  })
  it('exclusiveMinimum / exclusiveMaximum collapse to min/max', async () => {
    const ir = await translateOasToIR(
      { exclusiveMinimum: 0, exclusiveMaximum: 9, type: 'integer' } as unknown as OasNode,
      EMPTY_DOC,
    )
    expect(node(ir)).toMatchObject({ kind: 'number', min: 0, max: 9 })
  })
})

describe('translate — array / items / minItems / maxItems', () => {
  it('items + minItems/maxItems', async () => {
    const ir = await translateOasToIR(
      { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
      EMPTY_DOC,
    )
    const n = node(ir) as { kind: string; item: { kind: string }; minLength?: number; maxLength?: number }
    expect(n.kind).toBe('array')
    expect(n.item.kind).toBe('string')
    expect(n.minLength).toBe(1)
    expect(n.maxLength).toBe(4)
  })
})

describe('translate — object: properties / required / optional', () => {
  it('required keys stay required, others get optional mod', async () => {
    const ir = await translateOasToIR(
      {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
      },
      EMPTY_DOC,
    )
    const n = node(ir) as {
      kind: string
      fields: Record<string, { kind: string; mods?: { optional?: boolean } }>
    }
    expect(n.kind).toBe('object')
    expect(n.fields.id?.mods?.optional).not.toBe(true)
    expect(n.fields.name?.mods?.optional).toBe(true)
  })
})

describe('translate — $ref', () => {
  const doc: OasDoc = {
    components: {
      schemas: {
        Pet: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
        },
      },
    },
  }
  it('intra-document $ref resolves', async () => {
    const ir = await translateOasToIR(
      { $ref: '#/components/schemas/Pet' } as unknown as OasNode,
      doc,
    )
    const n = node(ir) as { kind: string; fields: Record<string, unknown> }
    expect(n.kind).toBe('object')
    expect(n.fields).toHaveProperty('name')
  })
  it('intra-document $ref cycle throws', async () => {
    const cyclic: OasDoc = {
      components: {
        schemas: {
          A: { $ref: '#/components/schemas/B' } as unknown as OasNode,
          B: { $ref: '#/components/schemas/A' } as unknown as OasNode,
        },
      },
    }
    await expect(
      translateOasToIR(
        { $ref: '#/components/schemas/A' } as unknown as OasNode,
        cyclic,
      ),
    ).rejects.toThrow(/\$ref cycle detected/)
  })
  it('remote http(s) $ref throws (FAIL LOUD)', async () => {
    await expect(
      translateOasToIR(
        { $ref: 'https://example.com/schemas/Foo' } as unknown as OasNode,
        EMPTY_DOC,
      ),
    ).rejects.toThrow(/unsupported \$ref/)
  })
  it('missing $ref target throws', async () => {
    await expect(
      translateOasToIR(
        { $ref: '#/components/schemas/Missing' } as unknown as OasNode,
        EMPTY_DOC,
      ),
    ).rejects.toThrow(/\$ref not found/)
  })
})

describe('translate — combinators', () => {
  it('oneOf → union of branches', async () => {
    const ir = await translateOasToIR(
      { oneOf: [{ type: 'string' }, { type: 'integer' }] } as unknown as OasNode,
      EMPTY_DOC,
    )
    const n = node(ir) as { kind: string; options: Array<{ kind: string }> }
    expect(n.kind).toBe('union')
    expect(n.options.map((o) => o.kind).sort()).toEqual(['number', 'string'])
  })
  it('anyOf → union of branches', async () => {
    const ir = await translateOasToIR(
      { anyOf: [{ type: 'string' }, { type: 'boolean' }] } as unknown as OasNode,
      EMPTY_DOC,
    )
    const n = node(ir) as { kind: string; options: Array<{ kind: string }> }
    expect(n.kind).toBe('union')
    expect(n.options).toHaveLength(2)
  })
  it('allOf shallow-merges object branches', async () => {
    const ir = await translateOasToIR(
      {
        allOf: [
          { type: 'object', required: ['a'], properties: { a: { type: 'string' } } },
          { type: 'object', required: ['b'], properties: { b: { type: 'integer' } } },
        ],
      } as unknown as OasNode,
      EMPTY_DOC,
    )
    const n = node(ir) as { kind: string; fields: Record<string, { kind: string }> }
    expect(n.kind).toBe('object')
    expect(Object.keys(n.fields).sort()).toEqual(['a', 'b'])
  })
  it('discriminator with mapping → discriminated branches keyed by tag', async () => {
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
    const ir = await translateOasToIR(
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
    const n = node(ir) as {
      kind: string
      key: string
      branches: Record<string, { kind: string; fields: Record<string, { kind: string; value?: unknown }> }>
    }
    expect(n.kind).toBe('discriminated')
    expect(n.key).toBe('kind')
    expect(Object.keys(n.branches).sort()).toEqual(['cat', 'dog'])
    expect(n.branches.cat?.fields.kind?.kind).toBe('literal')
    expect(n.branches.cat?.fields.kind?.value).toBe('cat')
    expect(n.branches.dog?.fields.kind?.value).toBe('dog')
  })
})

describe('translate — example / examples / const / enum precedence', () => {
  it('example wins over enum / oneOf / type', async () => {
    const ir = await translateOasToIR(
      {
        type: 'string',
        example: 'EX',
        enum: ['A', 'B'],
        oneOf: [{ type: 'integer' }],
      } as unknown as OasNode,
      EMPTY_DOC,
    )
    expect(node(ir)).toMatchObject({ kind: 'literal', value: 'EX' })
  })
  it('examples[0] wins when example absent', async () => {
    const ir = await translateOasToIR(
      { type: 'string', examples: ['EXAM', 'OTHER'], enum: ['Z'] } as unknown as OasNode,
      EMPTY_DOC,
    )
    expect(node(ir)).toMatchObject({ kind: 'literal', value: 'EXAM' })
  })
  it('enum wins over const / $ref / type', async () => {
    const ir = await translateOasToIR(
      {
        type: 'string',
        enum: ['x', 'y'],
        const: 'never',
      } as unknown as OasNode,
      EMPTY_DOC,
    )
    const n = node(ir) as { kind: string; values: readonly unknown[] }
    expect(n.kind).toBe('enum')
    expect(n.values).toEqual(['x', 'y'])
  })
  it('const wins over $ref / oneOf / type', async () => {
    const ir = await translateOasToIR(
      {
        type: 'string',
        const: 5,
        oneOf: [{ type: 'string' }],
      } as unknown as OasNode,
      EMPTY_DOC,
    )
    expect(node(ir)).toMatchObject({ kind: 'literal', value: 5 })
  })
  it('$ref wins over oneOf / anyOf / type-fallback', async () => {
    const doc: OasDoc = {
      components: {
        schemas: { Tag: { type: 'string', minLength: 2, maxLength: 4 } },
      },
    }
    const ir = await translateOasToIR(
      {
        $ref: '#/components/schemas/Tag',
        oneOf: [{ type: 'integer' }],
      } as unknown as OasNode,
      doc,
    )
    expect(node(ir)).toMatchObject({ kind: 'string', min: 2, max: 4 })
  })
  it('allOf wins over oneOf / anyOf / type-fallback', async () => {
    const ir = await translateOasToIR(
      {
        type: 'string',
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'object', properties: { b: { type: 'integer' } } },
        ],
        oneOf: [{ type: 'integer' }],
      } as unknown as OasNode,
      EMPTY_DOC,
    )
    expect(node(ir).kind).toBe('object')
  })
  it('oneOf wins over anyOf / type-fallback', async () => {
    const ir = await translateOasToIR(
      {
        type: 'string',
        oneOf: [{ type: 'integer' }, { type: 'boolean' }],
        anyOf: [{ type: 'string' }],
      } as unknown as OasNode,
      EMPTY_DOC,
    )
    expect(node(ir).kind).toBe('union')
  })
  it('non-primitive enum collapses to union of literals', async () => {
    const ir = await translateOasToIR(
      { enum: [{ a: 1 }, { a: 2 }] } as unknown as OasNode,
      EMPTY_DOC,
    )
    const n = node(ir) as { kind: string; options: Array<{ kind: string }> }
    expect(n.kind).toBe('union')
    expect(n.options).toHaveLength(2)
    expect(n.options[0]?.kind).toBe('object')
  })
  it('object example literalizes recursively', async () => {
    const ir = await translateOasToIR(
      { type: 'object', example: { a: 1, b: 'x' } } as unknown as OasNode,
      EMPTY_DOC,
    )
    const n = node(ir) as { kind: string; fields: Record<string, { kind: string; value: unknown }> }
    expect(n.kind).toBe('object')
    expect(n.fields.a?.value).toBe(1)
    expect(n.fields.b?.value).toBe('x')
  })
  it('array example literalizes as tuple', async () => {
    const ir = await translateOasToIR(
      { type: 'array', example: [1, 'two'] } as unknown as OasNode,
      EMPTY_DOC,
    )
    const n = node(ir) as { kind: string; items: Array<{ kind: string; value: unknown }> }
    expect(n.kind).toBe('tuple')
    expect(n.items.map((i) => i.value)).toEqual([1, 'two'])
  })
})

describe('translate — IR is mockable end-to-end', () => {
  it('produces deterministic mock output', async () => {
    const ir = await translateOasToIR(
      {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', minLength: 4, maxLength: 4 },
          n: { type: 'integer', minimum: 1, maximum: 1 },
        },
      },
      EMPTY_DOC,
    )
    const m = await import('@databehave/schema')
    const a = m.mock(ir, { seed: 0 })
    const b = m.mock(ir, { seed: 0 })
    expect(a).toEqual(b)
    expect(a).toHaveProperty('id')
    expect((a as { n: number }).n).toBe(1)
  })
})

describe('translate — UNSUPPORTED keywords FAIL LOUD', () => {
  const cases: Array<[string, OasNode]> = [
    ['if', { if: {} } as unknown as OasNode],
    ['then', { then: {} } as unknown as OasNode],
    ['else', { else: {} } as unknown as OasNode],
    ['unevaluatedProperties', { unevaluatedProperties: false } as unknown as OasNode],
    ['unevaluatedItems', { unevaluatedItems: false } as unknown as OasNode],
    ['dependentSchemas', { dependentSchemas: {} } as unknown as OasNode],
    ['dependentRequired', { dependentRequired: {} } as unknown as OasNode],
    ['propertyNames', { propertyNames: { type: 'string' } } as unknown as OasNode],
    ['patternProperties', { patternProperties: {} } as unknown as OasNode],
    ['contentEncoding', { contentEncoding: 'base64' } as unknown as OasNode],
    ['contentMediaType', { contentMediaType: 'application/json' } as unknown as OasNode],
  ]
  it.each(cases)('%s throws unsupported keyword', async (name, n) => {
    await expect(translateOasToIR(n, EMPTY_DOC)).rejects.toThrow(
      new RegExp(`unsupported JSON Schema keyword: ${name}`),
    )
  })
  it('remote http(s) $ref throws unsupported $ref (re-asserted under unsupported group)', async () => {
    await expect(
      translateOasToIR(
        { $ref: 'http://example.com/schemas/Foo' } as unknown as OasNode,
        EMPTY_DOC,
      ),
    ).rejects.toThrow(/unsupported \$ref/)
  })
})

describe('translate — defensive', () => {
  it('non-object node throws', async () => {
    await expect(
      translateOasToIR('not an object' as unknown as OasNode, EMPTY_DOC),
    ).rejects.toThrow(/schema node must be an object/)
  })
  it('open / typeless node falls back to obj({})', async () => {
    const ir = await translateOasToIR({} as OasNode, EMPTY_DOC)
    expect(node(ir).kind).toBe('object')
  })
  it('array example with empty array becomes empty tuple', async () => {
    const ir = await translateOasToIR(
      { example: [] } as unknown as OasNode,
      EMPTY_DOC,
    )
    expect(node(ir).kind).toBe('tuple')
  })
  it('items implies array type when type is omitted', async () => {
    const ir = await translateOasToIR(
      { items: { type: 'integer' } } as unknown as OasNode,
      EMPTY_DOC,
    )
    expect(node(ir).kind).toBe('array')
  })
})

describe('translate — additionalProperties (no-op for generation)', () => {
  it('additionalProperties: false → IR has only declared properties; mock has only declared keys', async () => {
    const ir = await translateOasToIR(
      {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', minLength: 4, maxLength: 4 } },
        additionalProperties: false,
      } as unknown as OasNode,
      EMPTY_DOC,
    )
    const n = node(ir) as { kind: string; fields: Record<string, unknown> }
    expect(n.kind).toBe('object')
    expect(Object.keys(n.fields)).toEqual(['id'])
    const m = await import('@databehave/schema')
    const out = m.mock(ir, { seed: 0 }) as Record<string, unknown>
    expect(Object.keys(out)).toEqual(['id'])
  })
  it('additionalProperties: true → only declared keys (open-object generator no-op)', async () => {
    const ir = await translateOasToIR(
      {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', minLength: 4, maxLength: 4 } },
        additionalProperties: true,
      } as unknown as OasNode,
      EMPTY_DOC,
    )
    const n = node(ir) as { kind: string; fields: Record<string, unknown> }
    expect(Object.keys(n.fields)).toEqual(['id'])
    const m = await import('@databehave/schema')
    const out = m.mock(ir, { seed: 0 }) as Record<string, unknown>
    expect(Object.keys(out)).toEqual(['id'])
  })
  it('additionalProperties: schema (string) → translator accepts without throwing', async () => {
    await expect(
      translateOasToIR(
        {
          type: 'object',
          properties: { id: { type: 'string', minLength: 1, maxLength: 4 } },
          additionalProperties: { type: 'string' },
        } as unknown as OasNode,
        EMPTY_DOC,
      ),
    ).resolves.toBeDefined()
  })
  it('additionalProperties: nested schema with unsupported keyword FAILS LOUD', async () => {
    await expect(
      translateOasToIR(
        {
          type: 'object',
          properties: { id: { type: 'string', minLength: 1, maxLength: 4 } },
          additionalProperties: { type: 'string', if: {} },
        } as unknown as OasNode,
        EMPTY_DOC,
      ),
    ).rejects.toThrow(/unsupported JSON Schema keyword: if/)
  })
})

describe('translate — full precedence ladder mirrors generate.ts', () => {
  it('example > examples[0] > enum[0] > const > $ref > allOf > oneOf[0] > anyOf[0] > type-fallback', async () => {
    const doc: OasDoc = {
      components: {
        schemas: { Tag: { type: 'string', minLength: 2, maxLength: 4 } },
      },
    }
    // example wins over everything below it.
    {
      const ir = await translateOasToIR(
        {
          type: 'integer',
          example: 'EX',
          examples: ['EXAM'],
          enum: ['A'],
          const: 'C',
          $ref: '#/components/schemas/Tag',
          allOf: [{ type: 'object', properties: { a: { type: 'string' } } }],
          oneOf: [{ type: 'integer' }],
          anyOf: [{ type: 'boolean' }],
        } as unknown as OasNode,
        doc,
      )
      expect(node(ir)).toMatchObject({ kind: 'literal', value: 'EX' })
    }
    // examples[0] wins when example absent.
    {
      const ir = await translateOasToIR(
        {
          type: 'integer',
          examples: ['EXAM'],
          enum: ['A'],
          const: 'C',
          $ref: '#/components/schemas/Tag',
          oneOf: [{ type: 'integer' }],
          anyOf: [{ type: 'boolean' }],
        } as unknown as OasNode,
        doc,
      )
      expect(node(ir)).toMatchObject({ kind: 'literal', value: 'EXAM' })
    }
    // enum[0] wins when example/examples absent.
    {
      const ir = await translateOasToIR(
        {
          type: 'integer',
          enum: ['A', 'B'],
          const: 'C',
          $ref: '#/components/schemas/Tag',
          oneOf: [{ type: 'integer' }],
          anyOf: [{ type: 'boolean' }],
        } as unknown as OasNode,
        doc,
      )
      expect(node(ir).kind).toBe('enum')
    }
    // const wins when enum absent.
    {
      const ir = await translateOasToIR(
        {
          type: 'integer',
          const: 'C',
          $ref: '#/components/schemas/Tag',
          oneOf: [{ type: 'integer' }],
          anyOf: [{ type: 'boolean' }],
        } as unknown as OasNode,
        doc,
      )
      expect(node(ir)).toMatchObject({ kind: 'literal', value: 'C' })
    }
    // $ref wins when const absent.
    {
      const ir = await translateOasToIR(
        {
          type: 'integer',
          $ref: '#/components/schemas/Tag',
          allOf: [{ type: 'object', properties: { a: { type: 'string' } } }],
          oneOf: [{ type: 'integer' }],
          anyOf: [{ type: 'boolean' }],
        } as unknown as OasNode,
        doc,
      )
      expect(node(ir)).toMatchObject({ kind: 'string', min: 2, max: 4 })
    }
    // allOf wins when $ref absent.
    {
      const ir = await translateOasToIR(
        {
          type: 'integer',
          allOf: [{ type: 'object', properties: { a: { type: 'string' } } }],
          oneOf: [{ type: 'integer' }],
          anyOf: [{ type: 'boolean' }],
        } as unknown as OasNode,
        EMPTY_DOC,
      )
      expect(node(ir).kind).toBe('object')
    }
    // oneOf wins when allOf absent.
    {
      const ir = await translateOasToIR(
        {
          type: 'integer',
          oneOf: [{ type: 'string' }],
          anyOf: [{ type: 'boolean' }],
        } as unknown as OasNode,
        EMPTY_DOC,
      )
      expect(node(ir).kind).toBe('union')
    }
    // anyOf wins when oneOf absent.
    {
      const ir = await translateOasToIR(
        {
          type: 'integer',
          anyOf: [{ type: 'boolean' }, { type: 'string' }],
        } as unknown as OasNode,
        EMPTY_DOC,
      )
      expect(node(ir).kind).toBe('union')
    }
    // type-fallback when nothing higher present.
    {
      const ir = await translateOasToIR({ type: 'integer' }, EMPTY_DOC)
      expect(node(ir)).toMatchObject({ kind: 'number', int: true })
    }
  })
})
