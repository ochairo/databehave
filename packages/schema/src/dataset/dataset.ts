/**
 * Dataset abstraction.
 *
 * A Dataset is a collection of records that share:
 *   - a per-record schema `S`
 *   - identity keys `K` (same identity → same value, cross-endpoint)
 *   - a record count `N`
 *   - aggregate invariants `J` (predicates over the full record list)
 *
 * Identity uniqueness contract:
 *   The dataset will not silently return two rows with the same identity
 *   tuple. When generation produces a colliding identity, the row is
 *   re-sampled with a fresh sub-seed up to `DEDUP_ATTEMPTS_PER_ROW` times;
 *   if still colliding, a `SchemaConflictError` is thrown (your identity
 *   domain is too small for `n`).
 */

import { SchemaConflictError } from '../foundation/errors.js'
import { identityKey } from '../foundation/hash.js'
import { mock } from '../generator/engine.js'
import type { Infer, Schema } from '../foundation/types.js'

export type DatasetOptions<S extends Schema> = {
  /** Unique dataset name (participates in the identity seed). */
  readonly name: string
  /** Record-level schema. */
  readonly schema: S
  /** Field names whose tuple defines a record's identity. */
  readonly identity: readonly string[]
  /** Number of records to generate per `mockDataset` call. */
  readonly n: number
  /** Aggregate invariants — applied to the full record list, with bounded retries. */
  readonly invariants?: readonly ((rows: readonly Infer<S>[]) => boolean)[]
  /** Caller-supplied context channel exposed to derived/invariants as `ctx.input`. */
  readonly input?: Readonly<Record<string, unknown>>
  /** Optional seed prefix; if omitted, the dataset name is used. */
  readonly seedPrefix?: string
}

/**
 * Number of full dataset re-rolls on top of the initial attempt. Each retry
 * uses a *different* per-row seed (the loop variable is folded into the seed
 * string), so retries can absorb aggregate-invariant rejection without the
 * user having to widen the schema. Raise this only after verifying that the
 * declared invariants are satisfiable for the chosen `n`.
 */
const MAX_DATASET_RETRIES = 1
const DEDUP_ATTEMPTS_PER_ROW = 8

/**
 * Generate `n` records that conform to the schema and satisfy all aggregate
 * invariants. Each row carries a unique identity tuple (collisions are
 * re-sampled; if the identity domain is exhausted, `SchemaConflictError`
 * is thrown).
 */
export const mockDataset = <S extends Schema>(opts: DatasetOptions<S>): Infer<S>[] => {
  const totalAttempts = MAX_DATASET_RETRIES + 1
  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    const seen = new Set<string>()
    const rows: Infer<S>[] = []
    let collided = false
    for (let i = 0; i < opts.n; i += 1) {
      let row: Infer<S> | undefined
      let key = ''
      for (let dedup = 0; dedup < DEDUP_ATTEMPTS_PER_ROW; dedup += 1) {
        const rowSeed = `${opts.seedPrefix ?? opts.name}:row:${i}:attempt:${attempt}:dedup:${dedup}`
        const candidate = mock(opts.schema, {
          seed: rowSeed,
          index: i,
          ...(opts.input !== undefined ? { input: opts.input } : {}),
        })
        const k = identityFor(opts.name, opts.identity, candidate as Record<string, unknown>)
        if (!seen.has(k)) {
          row = candidate
          key = k
          break
        }
      }
      if (row === undefined) {
        collided = true
        break
      }
      seen.add(key)
      rows.push(row)
    }
    if (collided) {
      // Try next dataset-level attempt with a different seed family.
      continue
    }

    const invariants = opts.invariants ?? []
    if (invariants.every((j) => j(rows))) return rows
  }
  throw new SchemaConflictError(
    `dataset "${opts.name}": could not satisfy identity uniqueness or aggregate invariants ` +
      `after ${MAX_DATASET_RETRIES + 1} dataset attempt(s) ` +
      `× ${DEDUP_ATTEMPTS_PER_ROW} dedup retries`,
    [opts.name],
    'widen the identity domain, lower n, or relax aggregate invariants',
  )
}

/**
 * Produce the deterministic identity key for a record. Two records with the
 * same identity values produce the same key. `null` and `undefined` are
 * distinguished from each other.
 */
export const identityFor = (
  datasetName: string,
  identityKeys: readonly string[],
  row: Record<string, unknown>,
): string => {
  const parts: Record<string, string> = {}
  for (const k of identityKeys) {
    const v = row[k]
    // Distinguish "missing" / "explicit null" / "explicit undefined".
    if (v === undefined) parts[k] = '__undef__'
    else if (v === null) parts[k] = '__null__'
    else parts[k] = JSON.stringify(v)
  }
  return identityKey('DATASET', datasetName, parts)
}
