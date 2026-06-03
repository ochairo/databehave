/**
 * mulberry32 — tiny, fast, deterministic 32-bit PRNG.
 *
 * Zero-dependency. Identical seed → identical sequence on every machine.
 * Period ≈ 2^32, ample for mock generation.
 *
 * Reference: https://gist.github.com/tommyettinger/46a3a48c0d7fe27ea3aaa5fa8f1ba0e8
 */

export type Rng = {
  /** Next uniformly-distributed float in `[0, 1)`. */
  next(): number
  /** Next integer in `[min, max]` (inclusive). */
  int(min: number, max: number): number
  /** Pick one element of `items` uniformly. */
  pick<T>(items: readonly T[]): T
}

/**
 * Create a deterministic PRNG seeded by a 32-bit unsigned integer.
 *
 * For string seeds, use {@link rngFromString}.
 */
export const mulberry32 = (seed: number): Rng => {
  // Force u32.
  let state = seed >>> 0

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    int(min, max) {
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        throw new RangeError(`rng.int requires finite bounds, got [${min}, ${max}]`)
      }
      if (min > max) throw new RangeError(`rng.int: min (${min}) > max (${max})`)
      const lo = Math.ceil(min)
      const hi = Math.floor(max)
      return lo + Math.floor(next() * (hi - lo + 1))
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError('rng.pick: empty array')
      const idx = Math.floor(next() * items.length)
      // Safe: idx ∈ [0, items.length-1]
      return items[idx] as T
    },
  }
}

/** Derive a 32-bit unsigned seed from an arbitrary string (FNV-1a 32-bit). */
export const seedFromString = (s: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Convenience: build an Rng from a string seed. */
export const rngFromString = (s: string): Rng => mulberry32(seedFromString(s))
