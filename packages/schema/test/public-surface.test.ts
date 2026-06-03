/**
 * Phase 11 — API surface lock.
 *
 * Snapshots the set of names exported from `@databehave/schema` (root) and
 * `@databehave/schema/internal`. Adding an export is non-breaking and only
 * requires extending the expected list. **Removing or renaming an
 * export is a SemVer MAJOR change** — `docs/stability.md` is the
 * binding contract; this test mechanically enforces it.
 *
 * The lists are sorted so diffs in PRs read cleanly.
 */
import { describe, it } from 'node:test'
import { strict as assert } from 'node:assert'

import * as Root from '../src/index.js'
import * as Internal from '../src/internal.js'

const ROOT_EXPECTED: readonly string[] = [
  // schema DSL — primitives
  'BooleanSchema',
  'IntSchema',
  'NullSchema',
  'NumberSchema',
  'StringSchema',
  'bool',
  'int',
  'null_',
  'num',
  'str',
  // schema DSL — decimal
  'DecimalSchema',
  'decimal',
  // schema DSL — composites
  'ArraySchema',
  'EnumSchema',
  'LiteralSchema',
  'ObjectSchema',
  'TupleSchema',
  'UnionSchema',
  'arr',
  'enum_',
  'literal',
  'obj',
  'tuple',
  'union',
  // schema DSL — discriminated
  'discriminated',
  // generator + validator
  'mock',
  'parse',
  'safeParse',
  'createTrace',
  'replay',
  'expectStable',
  // dataset
  'identityFor',
  'mockDataset',
  'relate',
  // foundation
  'Schema',
  // errors
  'ConformError',
  'DataBehaveError',
  'SchemaConflictError',
].slice().sort()

const INTERNAL_EXPECTED: readonly string[] = [
  'IR_VERSION',
  'Schema',
  'deserializeSchema',
  'fromIR',
  'mulberry32',
  'rngFromString',
  'seedFromString',
  'serializeSchema',
  'walkSchema',
].slice().sort()

const sortedKeys = (mod: Record<string, unknown>): readonly string[] =>
  Object.keys(mod).filter((k) => k !== 'default').slice().sort()

describe('public API surface — `@databehave/schema` root entry', () => {
  it('exports match the locked list (SemVer MAJOR to change)', () => {
    const actual = sortedKeys(Root as unknown as Record<string, unknown>)
    assert.deepStrictEqual(
      actual,
      ROOT_EXPECTED,
      'public API drift detected. Update both src/index.ts and ROOT_EXPECTED ' +
        '(and bump the MAJOR / document in CHANGELOG.md if anything was removed).',
    )
  })
})

describe('public API surface — `@databehave/schema/internal` entry', () => {
  it('exports match the locked list (SemVer MAJOR to change)', () => {
    const actual = sortedKeys(Internal as unknown as Record<string, unknown>)
    assert.deepStrictEqual(
      actual,
      INTERNAL_EXPECTED,
      'internal surface drift detected. Update src/internal.ts and ' +
        'INTERNAL_EXPECTED. Plugins depend on this surface — treat it ' +
        'like the root entry.',
    )
  })
})

describe('capability marker symbols stay off enumerable property surfaces', () => {
  // The `[Discrete]` / `[Numeric]` markers are phantom — declared via
  // `declare readonly`, never written. They MUST NOT appear in
  // `Object.keys`, `for…in`, `JSON.stringify`, or property completion
  // lists, otherwise consumer IntelliSense fills with `_capDiscrete`-
  // style noise and downstream schemas (msw, OpenAPI codegen, …) start
  // round-tripping the markers as if they were data.
  it('constructed schemas expose no symbol-typed own properties', () => {
    const samples: readonly Record<string, unknown>[] = [
      Root.str() as unknown as Record<string, unknown>,
      Root.num() as unknown as Record<string, unknown>,
      Root.int() as unknown as Record<string, unknown>,
      Root.bool() as unknown as Record<string, unknown>,
      Root.null_() as unknown as Record<string, unknown>,
      Root.decimal(10, 2) as unknown as Record<string, unknown>,
      Root.literal('x') as unknown as Record<string, unknown>,
      Root.enum_(['a', 'b']) as unknown as Record<string, unknown>,
      Root.obj({ a: Root.str() }) as unknown as Record<string, unknown>,
    ]
    for (const s of samples) {
      assert.deepStrictEqual(
        Object.getOwnPropertySymbols(s),
        [],
        'capability symbols leaked onto the runtime instance',
      )
      // string-keyed markers from the b779362 era stay gone too.
      const ownStringKeys = Object.keys(s)
      assert.ok(
        !ownStringKeys.includes('_capDiscrete') && !ownStringKeys.includes('_capNumeric'),
        `string-keyed cap marker leaked: ${JSON.stringify(ownStringKeys)}`,
      )
    }
  })
})
