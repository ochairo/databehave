/**
 * Snapshot lock for the `Issue.code` catalog.
 *
 * `Issue.code` is part of the SemVer contract (see `docs/stability.md`):
 * a code may only be added in a `MINOR` release, and only renamed /
 * removed / re-meaned in a `MAJOR`. This test enumerates every code
 * the validator emits across a representative schema corpus and pins
 * the result against `EXPECTED_CODES`.
 *
 * Catalog-update protocol (read before changing this list):
 *
 *   1. A *new* code is being added (a `MINOR`-level intentional
 *      change): add it to the alphabetised `EXPECTED_CODES` list AND
 *      to the `IssueCode` union in `src/foundation/errors.ts` in the
 *      same commit. Bump the package `MINOR`.
 *   2. An *existing* code is being renamed or removed (a `MAJOR`):
 *      update the list, update `IssueCode`, AND add a release-note
 *      entry naming the old → new mapping for downstream consumers.
 *      Bump the package `MAJOR`.
 *   3. The set or wording of `Issue.message` may change at any time
 *      and is intentionally NOT pinned here — message wording is
 *      diagnostic-only.
 *
 * If this test fails with no intentional catalog change in the same
 * diff, it indicates an unintentional regression: a parse path that
 * used to emit one code now emits another (or none). Fix the parse
 * path, do not "fix" the test.
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import {
  arr,
  bool,
  decimal,
  discriminated,
  enum_,
  int,
  literal,
  null_,
  num,
  obj,
  safeParse,
  str,
  tuple,
  union,
} from '../../src/index.js'
import type { IssueCode } from '../../src/index.js'

/**
 * Every code that the validator can emit. Alphabetised. Adding /
 * renaming / removing requires a SemVer bump per the protocol above.
 */
const EXPECTED_CODES: readonly IssueCode[] = [
  'array.expected',
  'array.length-mismatch',
  'array.too-long',
  'array.too-short',
  'boolean.expected',
  'decimal.expected',
  'decimal.not-numeric',
  'decimal.scale-exceeded',
  'derived.callback-threw',
  'derived.mismatch',
  'discriminated.expected-object',
  'discriminated.missing-tag',
  'discriminated.unknown-tag',
  'domain.lookup-mismatch',
  'domain.not-in-values',
  'enum.not-member',
  'invariant.callback-threw',
  'invariant.failed',
  'literal.not-equal',
  'null.expected',
  'number.expected',
  'number.not-integer',
  'number.too-large',
  'number.too-small',
  'object.expected',
  'required',
  'string.expected',
  'string.pattern-mismatch',
  'string.too-long',
  'string.too-short',
  'tuple.expected-array',
  'tuple.length-mismatch',
  'unexpected-null',
  'union.no-match',
]

/** Each entry is a (schema, value) pair that triggers exactly the listed codes. */
type Probe = readonly [string, () => readonly IssueCode[]]

const probe = (label: string, fn: () => readonly IssueCode[]): Probe => [label, fn]

const collect = (...schemas: ReadonlyArray<{ run: () => readonly IssueCode[] }>): Set<IssueCode> => {
  const out = new Set<IssueCode>()
  for (const s of schemas) for (const c of s.run()) out.add(c)
  return out
}

const codesOf = (result: ReturnType<typeof safeParse>): readonly IssueCode[] =>
  result.ok ? [] : result.error.issues.map((i) => i.code)

describe('Issue.code catalog (snapshot)', () => {
  it('every catalog entry is emitted by some validator path', () => {
    const emitted = new Set<IssueCode>()
    const probes: Probe[] = [
      // string
      probe('string.expected', () => codesOf(safeParse(str(), 42))),
      probe('string.too-short / pattern', () =>
        codesOf(safeParse(str().min(3).pattern('^x'), 'a')),
      ),
      probe('string.too-long', () => codesOf(safeParse(str().max(2), 'abcd'))),
      // number
      probe('number.expected', () => codesOf(safeParse(num(), 'nope'))),
      probe('number.too-small', () => codesOf(safeParse(num().min(10), 1))),
      probe('number.too-large', () => codesOf(safeParse(num().max(5), 99))),
      probe('number.not-integer', () => codesOf(safeParse(int(), 1.5))),
      // decimal
      probe('decimal.expected', () => codesOf(safeParse(decimal(5, 2), 12.3))),
      probe('decimal.not-numeric', () => codesOf(safeParse(decimal(5, 2), 'abc'))),
      probe('decimal.scale-exceeded', () => codesOf(safeParse(decimal(5, 2), '1.234'))),
      // boolean
      probe('boolean.expected', () => codesOf(safeParse(bool(), 'true'))),
      // null
      probe('null.expected', () => codesOf(safeParse(null_(), 1))),
      // unexpected-null on a non-nullable
      probe('unexpected-null', () => codesOf(safeParse(str(), null))),
      // required
      probe('required', () => codesOf(safeParse(obj({ a: str() }), {}))),
      // literal
      probe('literal.not-equal', () => codesOf(safeParse(literal('x'), 'y'))),
      // enum
      probe('enum.not-member', () => codesOf(safeParse(enum_(['a', 'b']), 'c'))),
      // array
      probe('array.expected', () => codesOf(safeParse(arr(str()), 'nope'))),
      probe('array.too-short', () => codesOf(safeParse(arr(str()).min(2), ['a']))),
      probe('array.too-long', () => codesOf(safeParse(arr(str()).max(1), ['a', 'b']))),
      probe('array.length-mismatch', () =>
        codesOf(safeParse(arr(str()).length(2), ['a', 'b', 'c'])),
      ),
      // object
      probe('object.expected', () => codesOf(safeParse(obj({ a: str() }), 'nope'))),
      // tuple
      probe('tuple.expected-array', () => codesOf(safeParse(tuple(str(), int()), 'nope'))),
      probe('tuple.length-mismatch', () =>
        codesOf(safeParse(tuple(str(), int()), ['a'])),
      ),
      // union
      probe('union.no-match', () => codesOf(safeParse(union(str(), int()), true))),
      // discriminated
      probe('discriminated.expected-object', () =>
        codesOf(safeParse(discriminated('kind', { a: obj({ kind: literal('a') }) }), 'nope')),
      ),
      probe('discriminated.missing-tag', () =>
        codesOf(safeParse(discriminated('kind', { a: obj({ kind: literal('a') }) }), {})),
      ),
      probe('discriminated.unknown-tag', () =>
        codesOf(
          safeParse(discriminated('kind', { a: obj({ kind: literal('a') }) }), { kind: 'b' }),
        ),
      ),
      // domain.not-in-values
      probe('domain.not-in-values', () =>
        codesOf(safeParse(str().in(['a', 'b']), 'c')),
      ),
      // domain.lookup-mismatch
      probe('domain.lookup-mismatch', () =>
        codesOf(
          safeParse(
            obj({
              region: str(),
              city: str().in({
                kind: 'lookup',
                fromField: 'region',
                map: { JP: ['Tokyo'], US: ['Boston'] },
              }),
            }),
            { region: 'JP', city: 'Boston' },
          ),
        ),
      ),
      // derived.mismatch
      probe('derived.mismatch', () =>
        codesOf(
          safeParse(
            obj({
              a: int(),
              b: int().derivedFrom((ctx) => (ctx.parent.a as number) + 1),
            }),
            { a: 1, b: 99 },
          ),
        ),
      ),
      // derived.callback-threw
      probe('derived.callback-threw', () =>
        codesOf(
          safeParse(
            obj({
              a: int().derivedFrom(() => {
                throw new Error('boom')
              }),
            }),
            { a: 1 },
          ),
        ),
      ),
      // invariant.failed
      probe('invariant.failed', () =>
        codesOf(
          safeParse(
            obj({ a: int(), b: int() }).invariant((v: unknown) => {
              const o = v as { a: number; b: number }
              return o.a < o.b
            }),
            { a: 5, b: 1 },
          ),
        ),
      ),
      // invariant.callback-threw
      probe('invariant.callback-threw', () =>
        codesOf(
          safeParse(
            obj({ a: int() }).invariant(() => {
              throw new Error('boom')
            }),
            { a: 1 },
          ),
        ),
      ),
    ]

    for (const [label, fn] of probes) {
      let codes: readonly IssueCode[] = []
      try {
        codes = fn()
      } catch (e) {
        assert.fail(`probe "${label}" threw: ${(e as Error).message}`)
      }
      assert.ok(
        codes.length > 0,
        `probe "${label}" emitted no issues — schema or value no longer triggers a failure`,
      )
      for (const c of codes) emitted.add(c)
    }

    const expected = new Set<IssueCode>(EXPECTED_CODES)
    const missing = [...expected].filter((c) => !emitted.has(c)).sort()
    const extra = [...emitted].filter((c) => !expected.has(c)).sort()

    assert.deepEqual(
      missing,
      [],
      `catalog entries with no emitting probe (add a probe or remove the catalog entry):\n  ${missing.join('\n  ')}`,
    )
    assert.deepEqual(
      extra,
      [],
      `validator emits codes not in the catalog (add to EXPECTED_CODES + IssueCode in the same commit):\n  ${extra.join('\n  ')}`,
    )
  })

  it('catalog is alphabetised (sort-stability protects diff review)', () => {
    const sorted = [...EXPECTED_CODES].slice().sort()
    assert.deepEqual([...EXPECTED_CODES], sorted)
  })

  // Suppress "unused" warnings for the helper that documents the
  // collect-shape (reviewers may extend the corpus by stamping more
  // collect() calls instead of inlining each probe).
  void collect
})
