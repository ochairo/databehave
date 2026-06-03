/**
 * Pure helper for building deterministic databehave seed strings.
 *
 * Seed format: `<endpoint>|<sortedKey>=<val>|...|date=<YYYY-MM-DD>|day=<n>`.
 * Same input → same string → databehave yields byte-identical JSON. Re-exported
 * from `@databehave/server` so consumers can derive their own seeds without
 * reimplementing the format.
 */

export type SeedInput = {
  endpoint: string
  from?: string
  dayOffset?: number
  extra?: Record<string, unknown>
}

/**
 * Recursively rebuild `v` with object keys sorted so two structurally
 * identical objects with different insertion orders serialise to the
 * same string. Arrays preserve order (semantic), plain objects are
 * key-sorted, primitives are returned as-is.
 */
const sortKeys = (v: unknown): unknown => {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(sortKeys)
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(v as Record<string, unknown>).sort()) {
    out[k] = sortKeys((v as Record<string, unknown>)[k])
  }
  return out
}

const stringifyExtra = (v: unknown): string => {
  if (v === null || v === undefined) return String(v)
  const t = typeof v
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint') {
    return String(v)
  }
  // Objects / arrays — use JSON so distinct shapes produce distinct
  // seeds. Keys are sorted recursively so insertion-order doesn't
  // perturb the seed. Falls back to `String()` if stringify fails
  // (cycles).
  try {
    return JSON.stringify(sortKeys(v))
  } catch {
    return String(v)
  }
}

export const seedFor = (i: SeedInput): string => {
  const parts: string[] = [i.endpoint]
  if (i.extra) {
    const keys = Object.keys(i.extra).sort()
    if (keys.length > 0) {
      parts.push(keys.map((k) => `${k}=${stringifyExtra(i.extra![k])}`).join('|'))
    }
  }
  if (i.from !== undefined) parts.push(`date=${i.from}`)
  if (i.dayOffset !== undefined) parts.push(`day=${i.dayOffset}`)
  return parts.join('|')
}
