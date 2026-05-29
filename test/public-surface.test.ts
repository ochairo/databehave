/**
 * Phase 11 — API surface lock.
 *
 * Snapshots the set of names exported from `databehave` (root) and
 * `databehave/internal`. Adding an export is non-breaking and only
 * requires extending the expected list. **Removing or renaming an
 * export is a SemVer MAJOR change** — `docs/STABILITY.md` is the
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
  'StringSchema',
  'NumberSchema',
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
  // deprecated re-exports (will be removed in v1.0 — kept here so the
  // intentional deprecation surface is also locked)
  'fromIR',
  'mulberry32',
  'rngFromString',
  'seedFromString',
  'walkSchema',
].slice().sort()

const INTERNAL_EXPECTED: readonly string[] = [
  'IR_VERSION',
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

describe('public API surface — `databehave` root entry', () => {
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

describe('public API surface — `databehave/internal` entry', () => {
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
