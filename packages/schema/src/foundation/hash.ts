/**
 * Stable identity hash for seed derivation.
 */

/**
 * Build a deterministic identity string from sorted query/path/identity values.
 *
 * Example:
 *   identityKey('GET', '/items', { group_code: 'A', date: '2026-05-22' })
 *     → 'GET|/items|date=2026-05-22&group_code=A'
 */
export const identityKey = (
  method: string,
  path: string,
  parts: Record<string, string | number | boolean | null | undefined>,
): string => {
  const flat = Object.keys(parts)
    .sort()
    .map((k) => {
      const v = parts[k]
      return `${k}=${v === undefined || v === null ? '' : String(v)}`
    })
    .join('&')
  return `${method}|${path}|${flat}`
}
