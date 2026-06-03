/**
 * Validator — exhaustive behavior tests for `parse` / `safeParse`.
 *
 * These tests verify the *semantics* of validation rather than just exercise
 * lines. Each block asserts the precise issue path and message produced when
 * a value violates a rule, and verifies that valid values pass through
 * unchanged (or, where applicable, with defaults applied).
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import {
  arr,
  bool,
  ConformError,
  decimal,
  discriminated,
  enum_,
  int,
  literal,
  null_,
  num,
  obj,
  parse,
  safeParse,
  str,
  tuple,
  union,
} from '../../src/index.js'

// ────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────

const expectIssue = <S extends Parameters<typeof safeParse>[0]>(
  schema: S,
  value: unknown,
  match: { path?: readonly (string | number)[]; messagePart: string },
): void => {
  const r = safeParse(schema, value)
  assert.equal(r.ok, false, `expected validation to fail for ${JSON.stringify(value)}`)
  if (r.ok) return
  const found = r.error.issues.find(
    (i) =>
      i.message.includes(match.messagePart) &&
      (match.path === undefined || JSON.stringify(i.path) === JSON.stringify(match.path)),
  )
  assert.ok(
    found,
    `no issue matched ${JSON.stringify(match)} in ${JSON.stringify(r.error.issues)}`,
  )
}

// ────────────────────────────────────────────────────────────────────────
// string
// ────────────────────────────────────────────────────────────────────────

describe('parse — string', () => {
  it('passes a plain string through unchanged', () => {
    assert.equal(parse(str(), 'hello'), 'hello')
  })

  it('rejects non-string types with `expected string`', () => {
    expectIssue(str(), 42, { messagePart: 'expected string' })
    expectIssue(str(), true, { messagePart: 'expected string' })
    expectIssue(str(), {}, { messagePart: 'expected string' })
  })

  it('enforces min length', () => {
    expectIssue(str().min(3), 'ab', { messagePart: 'length < min 3' })
    assert.equal(parse(str().min(3), 'abc'), 'abc')
  })

  it('enforces max length', () => {
    expectIssue(str().max(2), 'abc', { messagePart: 'length > max 2' })
    assert.equal(parse(str().max(2), 'ab'), 'ab')
  })

  it('enforces a regex pattern (string and RegExp accepted at build time)', () => {
    const s = str().pattern(/^[A-Z]{3}$/)
    assert.equal(parse(s, 'ABC'), 'ABC')
    expectIssue(s, 'abc', { messagePart: 'does not match' })

    const sFromString = str().pattern('^\\d+$')
    assert.equal(parse(sFromString, '42'), '42')
    expectIssue(sFromString, '4a', { messagePart: 'does not match' })
  })
})

// ────────────────────────────────────────────────────────────────────────
// number / int
// ────────────────────────────────────────────────────────────────────────

describe('parse — number / int', () => {
  it('accepts a finite number', () => {
    assert.equal(parse(num(), 3.14), 3.14)
  })

  it('rejects NaN and non-number types', () => {
    expectIssue(num(), Number.NaN, { messagePart: 'expected number' })
    expectIssue(num(), '3', { messagePart: 'expected number' })
  })

  it('enforces inclusive min/max', () => {
    const s = num().min(0).max(10)
    assert.equal(parse(s, 0), 0)
    assert.equal(parse(s, 10), 10)
    expectIssue(s, -1, { messagePart: '< min 0' })
    expectIssue(s, 11, { messagePart: '> max 10' })
  })

  it('int() rejects non-integers', () => {
    assert.equal(parse(int(), 7), 7)
    expectIssue(int(), 7.5, { messagePart: 'expected integer' })
  })
})

// ────────────────────────────────────────────────────────────────────────
// decimal
// ────────────────────────────────────────────────────────────────────────

describe('parse — decimal', () => {
  const d = decimal(10, 2)

  it('accepts a well-formed numeric string with allowed scale', () => {
    assert.equal(parse(d, '123.45'), '123.45')
    assert.equal(parse(d, '-7'), '-7')
  })

  it('rejects non-string types', () => {
    expectIssue(d, 123.45, { messagePart: 'expected decimal string' })
  })

  it('rejects malformed numeric strings', () => {
    expectIssue(d, 'abc', { messagePart: 'not a numeric string' })
    expectIssue(d, '1.2.3', { messagePart: 'not a numeric string' })
    expectIssue(d, '1e3', { messagePart: 'not a numeric string' })
  })

  it('rejects values whose scale exceeds the declared scale', () => {
    expectIssue(d, '1.234', { messagePart: 'scale 3 exceeds declared scale 2' })
  })
})

// ────────────────────────────────────────────────────────────────────────
// boolean / null
// ────────────────────────────────────────────────────────────────────────

describe('parse — boolean / null', () => {
  it('accepts true / false', () => {
    assert.equal(parse(bool(), true), true)
    assert.equal(parse(bool(), false), false)
  })

  it('rejects non-boolean', () => {
    expectIssue(bool(), 'true', { messagePart: 'expected boolean' })
    expectIssue(bool(), 0, { messagePart: 'expected boolean' })
  })

  it('null_() accepts null and rejects everything else', () => {
    assert.equal(parse(null_(), null), null)
    expectIssue(null_(), undefined, { messagePart: 'required' })
    expectIssue(null_(), 0, { messagePart: 'expected null' })
  })
})

// ────────────────────────────────────────────────────────────────────────
// literal / enum
// ────────────────────────────────────────────────────────────────────────

describe('parse — literal / enum', () => {
  it('literal accepts only its exact value', () => {
    assert.equal(parse(literal('alpha'), 'alpha'), 'alpha')
    expectIssue(literal('alpha'), 'beta', { messagePart: 'expected literal "alpha"' })
    expectIssue(literal(42), 42.0001, { messagePart: 'expected literal 42' })
  })

  it('enum accepts only its declared members', () => {
    const e = enum_(['a', 'b', 'c'] as const)
    assert.equal(parse(e, 'b'), 'b')
    expectIssue(e, 'd', { messagePart: 'not in enum' })
  })
})

// ────────────────────────────────────────────────────────────────────────
// array
// ────────────────────────────────────────────────────────────────────────

describe('parse — array', () => {
  it('rejects non-array values', () => {
    expectIssue(arr(int()), 'not-array', { messagePart: 'expected array' })
    expectIssue(arr(int()), { length: 3 }, { messagePart: 'expected array' })
  })

  it('enforces exact length', () => {
    const s = arr(int()).length(3)
    assert.deepEqual(parse(s, [1, 2, 3]), [1, 2, 3])
    expectIssue(s, [1, 2], { messagePart: 'length 2 ≠ required 3' })
  })

  it('enforces minLength / maxLength', () => {
    expectIssue(arr(int()).min(2), [1], { messagePart: 'length < minLength 2' })
    expectIssue(arr(int()).max(2), [1, 2, 3], { messagePart: 'length > maxLength 2' })
  })

  it('reports per-element issues with the element index in the path', () => {
    const r = safeParse(arr(int()), [1, 'oops', 3])
    assert.equal(r.ok, false)
    if (r.ok) return
    const e = r.error.issues.find((i) => i.path[0] === 1)
    assert.ok(e, 'expected an issue at index 1')
  })

  it('returns a new array (does not alias the input)', () => {
    const input = [1, 2, 3]
    const out = parse(arr(int()), input)
    assert.deepEqual(out, input)
    assert.notEqual(out, input)
  })
})

// ────────────────────────────────────────────────────────────────────────
// object
// ────────────────────────────────────────────────────────────────────────

describe('parse — object', () => {
  const User = obj({ id: int(), name: str() })

  it('accepts a well-formed object and returns a copy keyed by schema fields only', () => {
    const v = parse(User, { id: 1, name: 'a', extra: 'dropped' } as unknown as {
      id: number
      name: string
    })
    assert.deepEqual(v, { id: 1, name: 'a' })
  })

  it('rejects non-object and arrays', () => {
    expectIssue(User, 'x', { messagePart: 'expected object' })
    expectIssue(User, [], { messagePart: 'expected object' })
  })

  it('reports missing required fields with the field name in the path', () => {
    const r = safeParse(User, { id: 1 } as unknown)
    assert.equal(r.ok, false)
    if (r.ok) return
    const m = r.error.issues.find((i) => i.path[0] === 'name')
    assert.ok(m, 'expected missing-name issue')
    assert.match(m!.message, /required/)
  })

  it('skips optional fields when undefined and no default', () => {
    const Profile = obj({ id: int(), nickname: str().optional() })
    const out = parse(Profile, { id: 1 })
    assert.deepEqual(out, { id: 1 })
  })

  it('applies default values for undefined fields with .default()', () => {
    const Config = obj({ retries: int().default(3), name: str() })
    const out = parse(Config, { name: 'x' } as unknown as { name: string; retries: number })
    assert.deepEqual(out, { name: 'x', retries: 3 })
  })

  it('accepts null for fields marked nullable', () => {
    const s = obj({ tag: str().nullable() })
    assert.deepEqual(parse(s, { tag: null }), { tag: null })
  })

  it('rejects null for non-nullable fields', () => {
    const s = obj({ tag: str() })
    expectIssue(s, { tag: null }, { messagePart: 'unexpected null' })
  })

  it('reports nested issues with full path', () => {
    const Nested = obj({ user: obj({ id: int() }) })
    const r = safeParse(Nested, { user: { id: 'x' } } as unknown)
    assert.equal(r.ok, false)
    if (r.ok) return
    const e = r.error.issues[0]!
    assert.deepEqual(e.path, ['user', 'id'])
  })
})

// ────────────────────────────────────────────────────────────────────────
// tuple
// ────────────────────────────────────────────────────────────────────────

describe('parse — tuple', () => {
  const t = tuple(int(), str(), bool())

  it('accepts a fixed-length, type-correct tuple', () => {
    assert.deepEqual(parse(t, [1, 'a', true]), [1, 'a', true])
  })

  it('rejects non-array values', () => {
    expectIssue(t, { 0: 1, 1: 'a', 2: true }, { messagePart: 'expected tuple' })
  })

  it('flags a length mismatch but still validates the shared prefix', () => {
    const r = safeParse(t, [1, 'a'])
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.ok(r.error.issues.some((i) => i.message.includes('tuple length')))
  })

  it('reports per-position issues by index', () => {
    const r = safeParse(t, ['x', 'a', true])
    assert.equal(r.ok, false)
    if (r.ok) return
    const e = r.error.issues.find((i) => i.path[0] === 0)
    assert.ok(e)
  })
})

// ────────────────────────────────────────────────────────────────────────
// union
// ────────────────────────────────────────────────────────────────────────

describe('parse — union', () => {
  const u = union(int(), str())

  it('passes when at least one option matches', () => {
    assert.equal(parse(u, 1), 1)
    assert.equal(parse(u, 'a'), 'a')
  })

  it('reports the union-mismatch summary plus the closest branch issues', () => {
    const r = safeParse(u, true)
    assert.equal(r.ok, false)
    if (r.ok) return
    // First issue is the union-level summary, remaining issues come from
    // the best-matching branch (here either `int` or `str`, both report a
    // single type error since `value` is a boolean).
    assert.ok(r.error.issues.length >= 1)
    assert.match(r.error.issues[0]!.message, /matches none/)
    if (r.error.issues.length > 1) {
      assert.match(r.error.issues[1]!.message, /expected (int|string|number)/)
    }
  })
})

// ────────────────────────────────────────────────────────────────────────
// domain axis (.in([...]))
// ────────────────────────────────────────────────────────────────────────

describe('parse — domain axis', () => {
  it('rejects values outside an .in([...]) closed set', () => {
    const s = str().in(['us', 'eu', 'jp'])
    assert.equal(parse(s, 'us'), 'us')
    expectIssue(s, 'br', { messagePart: 'value not in domain' })
  })
})

// ────────────────────────────────────────────────────────────────────────
// modifiers
// ────────────────────────────────────────────────────────────────────────

describe('parse — modifiers', () => {
  it('optional + undefined returns undefined', () => {
    assert.equal(parse(str().optional(), undefined), undefined)
  })

  it('default returns the default when value is undefined', () => {
    assert.equal(parse(int().default(7), undefined), 7)
  })

  it('non-optional + undefined produces a `required` issue', () => {
    expectIssue(int(), undefined, { messagePart: 'required' })
  })
})

// ────────────────────────────────────────────────────────────────────────
// parse vs safeParse contracts
// ────────────────────────────────────────────────────────────────────────

describe('parse vs safeParse — contracts', () => {
  it('parse throws ConformError on failure and returns the value on success', () => {
    assert.throws(() => parse(int(), 'x'), ConformError)
    assert.equal(parse(int(), 7), 7)
  })

  it('safeParse never throws and returns a discriminated result', () => {
    const ok = safeParse(int(), 1)
    assert.equal(ok.ok, true)
    if (ok.ok) assert.equal(ok.value, 1)

    const fail = safeParse(int(), 'x')
    assert.equal(fail.ok, false)
    if (!fail.ok) {
      assert.ok(fail.error instanceof ConformError)
      assert.ok(fail.error.issues.length >= 1)
    }
  })

  it('ConformError.message summarises a single issue inline', () => {
    try {
      parse(int(), 'x')
      assert.fail('expected throw')
    } catch (e) {
      assert.ok(e instanceof ConformError)
      assert.match((e as Error).message, /expected number/)
    }
  })

  it('ConformError.message lists multiple issues when more than one fails', () => {
    const r = safeParse(obj({ a: int(), b: str() }), { a: 'x', b: 1 } as unknown)
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.match(r.error.message, /2 issues/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// describe() — the `expected=…` text built for `required` issues.
// Each schema kind formats its expected differently; these tests ensure
// the validator surfaces a useful description rather than `[object Object]`.
// ────────────────────────────────────────────────────────────────────────

describe('parse — required-issue describes the expected schema kind', () => {
  const expectedFor = (schema: Parameters<typeof safeParse>[0]): string => {
    const r = safeParse(schema, undefined)
    if (r.ok) throw new Error('expected validation failure')
    const issue = r.error.issues.find((i) => i.message === 'required')
    assert.ok(issue, 'no required issue')
    return issue!.expected ?? ''
  }

  it('decimal → "decimal(p, s)"', () => {
    assert.match(expectedFor(decimal(10, 2)), /^decimal\(10, 2\)$/)
  })

  it('enum → "enum [a, b, c]"', () => {
    assert.match(expectedFor(enum_(['a', 'b', 'c'] as const)), /^enum \[a, b, c\]$/)
  })

  it('array → "array<…>"', () => {
    assert.match(expectedFor(arr(int())), /^array</)
  })

  it('object → "object{a, b, …}"', () => {
    assert.match(expectedFor(obj({ a: int(), b: str() })), /^object\{a, b\}$/)
  })

  it('literal → "literal …"', () => {
    assert.match(expectedFor(literal('alpha')), /^literal "alpha"$/)
  })

  it('primitive (number) → bare kind name', () => {
    assert.equal(expectedFor(int()), 'number')
  })

  it('primitive (boolean) → bare kind name', () => {
    assert.equal(expectedFor(bool()), 'boolean')
  })
})

// ────────────────────────────────────────────────────────────────────────
// Behavioral axes — `correlate`, `derivedFrom`, lookup domain.
// The validator must enforce the same invariants the generator does, so a
// round-trip `mock → parse` never sees a value the generator wouldn't have
// produced.
// ────────────────────────────────────────────────────────────────────────

describe('parse — behavioral axes', () => {
  it('enforces single-record invariants attached via `.correlate(...)`', () => {
    const Box = obj({ w: int(), h: int() }).correlate((b) => b.w >= b.h)
    assert.doesNotThrow(() => parse(Box, { w: 5, h: 3 }))
    expectIssue(Box, { w: 3, h: 5 }, { messagePart: 'invariant[0] failed' })
  })

  it("reports a thrown invariant callback as an issue (doesn't propagate)", () => {
    const Row = obj({ a: int() }).correlate(() => {
      throw new Error('inv-boom')
    })
    expectIssue(Row, { a: 1 }, { messagePart: 'invariant[0] threw: inv-boom' })
  })

  it('enforces a `lookup` domain against a sibling field at parse time', () => {
    const Row = obj({
      region: str().in(['us', 'eu']),
      currency: str().in({
        kind: 'lookup',
        fromField: 'region',
        map: { us: ['USD'], eu: ['EUR'] },
      }),
    })
    assert.doesNotThrow(() => parse(Row, { region: 'us', currency: 'USD' }))
    expectIssue(
      Row,
      { region: 'us', currency: 'EUR' },
      { messagePart: 'not in lookup domain' },
    )
  })

  it('enforces `derivedFrom` by recomputing and comparing the supplied value', () => {
    const Row = obj({
      qty: int(),
      price: int(),
      total: int().derivedFrom(
        (ctx) => (ctx.parent['qty'] as number) * (ctx.parent['price'] as number),
      ),
    })
    assert.doesNotThrow(() => parse(Row, { qty: 3, price: 4, total: 12 }))
    expectIssue(
      Row,
      { qty: 3, price: 4, total: 99 },
      { messagePart: 'derived value does not match' },
    )
  })

  it("reports a thrown derivedFrom callback as an issue (doesn't propagate)", () => {
    const Row = obj({
      total: int().derivedFrom(() => {
        throw new Error('boom')
      }),
    })
    expectIssue(Row, { total: 0 }, { messagePart: 'derived callback threw: boom' })
  })
})

// ────────────────────────────────────────────────────────────────────────
// `derivedFrom` deep-comparison — exhaustive shape matrix.
// Each case ships a schema whose *shape* check trivially passes for the
// supplied value, leaving the `derivedFrom` deep-equal as the only thing
// that decides ok/not-ok. This exercises the validator's structural
// equality across objects, arrays, and primitive shapes.
// ────────────────────────────────────────────────────────────────────────

describe('parse — derivedFrom structural equality', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const cases: Array<{ name: string; schema: any; supplied: unknown; ok: boolean }> = [
    {
      name: 'matching object',
      schema: obj({ v: obj({ a: int(), b: int() }).derivedFrom(() => ({ a: 1, b: 2 })) }),
      supplied: { a: 1, b: 2 },
      ok: true,
    },
    {
      name: 'object value differs',
      schema: obj({ v: obj({ a: int() }).derivedFrom(() => ({ a: 1 })) }),
      supplied: { a: 2 },
      ok: false,
    },
    {
      name: 'object key-count differs (extra key in derived)',
      schema: obj({ v: obj({ a: int() }).derivedFrom(() => ({ a: 1, b: 2 })) }),
      supplied: { a: 1 },
      ok: false,
    },
    {
      name: 'matching array',
      schema: obj({ v: arr(int()).derivedFrom(() => [1, 2, 3]) }),
      supplied: [1, 2, 3],
      ok: true,
    },
    {
      name: 'array length differs',
      schema: obj({ v: arr(int()).derivedFrom(() => [1, 2, 3]) }),
      supplied: [1, 2],
      ok: false,
    },
  ]
  /* eslint-enable @typescript-eslint/no-explicit-any */
  for (const c of cases) {
    it(`${c.name} → ${c.ok ? 'accepted' : 'rejected'}`, () => {
      const r = safeParse(c.schema, { v: c.supplied })
      assert.equal(r.ok, c.ok, r.ok ? '' : r.error.message)
    })
  }
})

// ────────────────────────────────────────────────────────────────────────
// `describe()` — text for the `expected=...` field on `required` issues
// for composite/derived kinds not covered by the primitive table above.
// ────────────────────────────────────────────────────────────────────────

describe('parse — required-issue describes composite kinds', () => {
  const expectedFor = (
    schema: Parameters<typeof safeParse>[0],
    fieldName = 'v',
  ): string => {
    const r = safeParse(obj({ [fieldName]: schema }), {} as unknown)
    if (r.ok) throw new Error('expected validation failure')
    const issue = r.error.issues.find((i) => i.message === 'required')
    assert.ok(issue, 'no required issue')
    return issue!.expected ?? ''
  }

  it('tuple → "tuple[N]"', () => {
    assert.match(expectedFor(tuple(int(), str())), /^tuple\[2\]$/)
  })

  it('union → "union(...)"', () => {
    assert.match(expectedFor(union(int(), str())), /^union\(/)
  })

  it('discriminated → "discriminated(key: a | b | …)"', () => {
    const D = discriminated('kind', {
      a: obj({ kind: literal('a') }),
      b: obj({ kind: literal('b') }),
    })
    assert.match(expectedFor(D), /^discriminated\(kind: a \| b\)$/)
  })

  it('decimal → "decimal(precision, scale)"', () => {
    assert.match(expectedFor(decimal(10, 2)), /^decimal\(10, 2\)$/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// `safeStringify` (internal) — used to format `expected` on derivedFrom
// mismatch issues. JSON.stringify can throw on BigInt or circular refs;
// the catch arm falls back to `String(v)`.
// ─────────────────────────────────────────────────────────────────────

describe('parse — derivedFrom mismatch with non-JSON-serializable expected', () => {
  it('does not crash when the derived callback returns a BigInt', () => {
    // `int().derivedFrom(...)` is typed for numbers; we deliberately route a
    // BigInt through `unknown` so the validator's `safeStringify` must handle
    // a value that JSON.stringify refuses to serialize.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const schema = obj({
      v: (int() as any).derivedFrom(() => 1n) as ReturnType<typeof int>,
    })
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const r = safeParse(schema, { v: 42 })
    assert.equal(r.ok, false)
    if (r.ok) return
    const issue = r.error.issues.find((i) =>
      i.message.startsWith('derived value does not match'),
    )
    assert.ok(issue)
    // Fallback path: `expected` is `String(1n)` → "1", not a JSON string.
    assert.equal(issue!.expected, '1')
  })
})
