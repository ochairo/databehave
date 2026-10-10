import type { Distribution, DomainConstraint } from '../foundation/axes.js'
import { SchemaConflictError } from '../foundation/errors.js'
import type { SchemaNode, StandardSchemaNode } from '../foundation/ir.js'
import type { Rng } from '../foundation/prng.js'
import type { GenerationContext } from '../runtime/contracts.js'
const EMPTY_PARENT: Readonly<Record<string, unknown>> = Object.freeze({})

/** Standard generation policies, registered through the same kind descriptor contract. */
export const kindGenerators = {
  string: (node: Extract<StandardSchemaNode, { kind: 'string' }>, state: GenerationContext): unknown => {
    return genString(node, state.leafRng())
  },
  number: (node: Extract<StandardSchemaNode, { kind: 'number' }>, state: GenerationContext): unknown => {
    const { path } = state
    return genNumber(node, undefined, state.leafRng(), path)
  },
  decimal: (node: Extract<StandardSchemaNode, { kind: 'decimal' }>, state: GenerationContext): unknown => {
    const { path } = state
    return genDecimal(node, undefined, state.leafRng(), path)
  },
  boolean: (_node: Extract<StandardSchemaNode, { kind: 'boolean' }>, state: GenerationContext): unknown => {
    return state.leafRng().next() < 0.5
  },
  null: (_node: Extract<StandardSchemaNode, { kind: 'null' }>, _state: GenerationContext): unknown => {
    return null
  },
  literal: (node: Extract<StandardSchemaNode, { kind: 'literal' }>, _state: GenerationContext): unknown => {
    return node.value
  },
  enum: (node: Extract<StandardSchemaNode, { kind: 'enum' }>, state: GenerationContext): unknown => {
    return sampleDiscrete(node.values, undefined, state.leafRng())
  },
  array: (node: Extract<StandardSchemaNode, { kind: 'array' }>, state: GenerationContext): unknown => {
    const { path } = state
    return genArray(node, path, state)
  },
  object: (node: Extract<StandardSchemaNode, { kind: 'object' }>, state: GenerationContext): unknown => {
    const { path } = state
    return genObject(node, path, state)
  },
  tuple: (node: Extract<StandardSchemaNode, { kind: 'tuple' }>, state: GenerationContext): unknown => {
    const { path, parent } = state
    return node.items.map((item, i) => state.generate(item, [...path, i], parent))
  },
  union: (node: Extract<StandardSchemaNode, { kind: 'union' }>, state: GenerationContext): unknown => {
    const { path, parent } = state
    const choice = state.rng.pick(node.options)
    return state.generate(choice, path, parent)
  },
  discriminated: (
    node: Extract<StandardSchemaNode, { kind: 'discriminated' }>,
    state: GenerationContext,
  ): unknown => {
    const { path, parent } = state
    const tags = Object.keys(node.branches)
    if (tags.length === 0) {
      throw new SchemaConflictError(
        `discriminated: empty branches map`,
        path,
        'declare at least one branch in `discriminated({...})`',
      )
    }
    const tag = state.rng.pick(tags)
    const branch = node.branches[tag] as SchemaNode
    return state.generate(branch, path, parent)
  },
}

export const domainCandidates = (
  domain: DomainConstraint,
  parent: Readonly<Record<string, unknown>>,
): readonly unknown[] => {
  if (domain.kind === 'values') return domain.values
  const keyVal = parent[domain.fromField]
  return typeof keyVal === 'string' ? domain.map[keyVal] ?? [] : []
}

export const sampleDiscrete = (
  values: readonly (string | number)[],
  dist: Distribution | undefined,
  rng: Rng,
): string | number => {
  if (dist?.kind === 'weighted') {
    const picked = pickWeighted(dist.weights, rng)
    if (picked !== undefined && (typeof picked === 'string' || typeof picked === 'number')) {
      return picked
    }
  }
  return rng.pick(values)
}

export const pickWeighted = (
  weights: ReadonlyArray<readonly [unknown, number]>,
  rng: Rng,
): unknown | undefined => {
  let total = 0
  for (const [, w] of weights) total += Math.max(0, w)
  if (total <= 0) return undefined
  let r = rng.next() * total
  for (const [v, w] of weights) {
    r -= Math.max(0, w)
    if (r <= 0) return v
  }
  return weights[weights.length - 1]?.[0]
}

const sampleNormal = (mean: number, stddev: number, rng: Rng): number => {
  const u1 = Math.max(rng.next(), Number.EPSILON)
  const u2 = rng.next()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return mean + z * stddev
}

const clamp = (n: number, min: number, max: number): number => (n < min ? min : n > max ? max : n)

// ──────────────────────────────────────────────────────────────────────────
// per-type
// ──────────────────────────────────────────────────────────────────────────

const ALPHANUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
// Slightly extended alphabet used only when a `pattern` is declared. Adds
// digits-only / lowercase-only fragments more aggressively so common
// rejection-sampler targets (`^\d+$`, `^[a-z0-9_-]+$`, hyphen-separated
// slugs) converge within `PATTERN_MAX_ATTEMPTS`. Keep ASCII-only so the
// produced length matches the requested `min`/`max` byte-for-byte.
//
// Uppercase letters and `.` are included so common patterns like
// `^[A-Z]+$`, `^[A-Z0-9_]+$` and dotted version-like tokens can
// converge — without them the rejection sampler exhausts
// `PATTERN_MAX_ATTEMPTS` and throws. Callers who want a stricter
// alphabet should still prefer `.in([...])` for exact enumerations.
const PATTERN_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.'
// Bumped from 200 → 1000. Patterns that include literal characters
// occurring rarely in the alphabet (e.g. `(a+)+b` requiring "a..b" as a
// substring of a length-8 random string has ~0.2% per-attempt match
// probability) converge unreliably at 200. 1000 attempts still complete
// in well under a millisecond on a satisfiable pattern and only delay
// the error path on unsatisfiable ones — the failure mode the test
// suite cares about (`.in([...])` hint surfaces in the thrown message).
const PATTERN_MAX_ATTEMPTS = 1000

/**
 * Bias the random-sampling alphabet toward literal characters that
 * appear in the regex source. Each ASCII alphanumeric literal that
 * survives a *very* shallow parse (skipping escapes and char-class
 * bodies — we only need rough bias, not correctness) is repeated
 * `PATTERN_LITERAL_BIAS_WEIGHT` times in the working alphabet so that
 * uniform-index draws hit it more often. This is intentionally crude:
 * patterns that need exact enumeration belong on `.in([...])`.
 */
const PATTERN_LITERAL_BIAS_WEIGHT = 8

const biasAlphabetForPattern = (pattern: string): string => {
  const literals = new Set<string>()
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]!
    // Skip backslash-escaped sequences entirely — they encode meta
    // classes (`\d`, `\w`) not literal characters.
    if (ch === '\\') {
      i += 1
      continue
    }
    // Regex metacharacters that are never literal matches.
    if ('()[]{}|.+*?^$'.includes(ch)) continue
    // Use only ASCII alphanumerics to bias; symbols introduce noise.
    if (/[A-Za-z0-9]/.test(ch)) literals.add(ch)
  }
  if (literals.size === 0) return PATTERN_ALPHABET
  return PATTERN_ALPHABET + [...literals].join('').repeat(PATTERN_LITERAL_BIAS_WEIGHT)
}

const genString = (node: Extract<StandardSchemaNode, { kind: 'string' }>, rng: Rng): string => {
  const minLen = node.min ?? 4
  const maxLen = node.max ?? Math.max(minLen, 12)

  if (node.pattern !== undefined) {
    let re: RegExp
    try {
      re = new RegExp(node.pattern)
    } catch (err) {
      throw new SchemaConflictError(
        `string: invalid pattern /${node.pattern}/: ${(err as Error).message}`,
        [],
        'fix the pattern or drop it',
      )
    }
    // Bias the alphabet toward literal characters appearing in the
    // regex source. For patterns like `(a+)+b` requiring "a..b" in
    // the output, uniform sampling from a 64-char alphabet has a
    // ~0.2% per-attempt match rate; biasing toward 'a' and 'b'
    // raises convergence to >95% within ~50 attempts. The bias is
    // intentionally crude (literal ASCII chars only, no char-class
    // analysis) — patterns that need precise enumeration should
    // still prefer `.in([...])`.
    const biased = biasAlphabetForPattern(node.pattern)
    for (let attempt = 0; attempt < PATTERN_MAX_ATTEMPTS; attempt += 1) {
      const len = rng.int(minLen, maxLen)
      let candidate = ''
      for (let i = 0; i < len; i += 1) {
        candidate += biased[rng.int(0, biased.length - 1)]
      }
      if (re.test(candidate)) return candidate
    }
    throw new SchemaConflictError(
      `string: could not satisfy pattern /${node.pattern}/ after ${PATTERN_MAX_ATTEMPTS} attempts`,
      [],
      'use `.in([...])` to enumerate concrete values, or relax the pattern',
    )
  }

  const len = rng.int(minLen, maxLen)
  let out = ''
  for (let i = 0; i < len; i += 1) out += ALPHANUM[rng.int(0, ALPHANUM.length - 1)]
  return out
}

export const genNumber = (
  node: Extract<StandardSchemaNode, { kind: 'number' }>,
  dist: Distribution | undefined,
  rng: Rng,
  path: readonly (string | number)[],
): number => {
  const min = node.min ?? 0
  const max = node.max ?? (node.int ? 100 : 1)
  if (min > max) {
    throw new SchemaConflictError(`number: min (${min}) > max (${max})`, path, 'swap min/max')
  }
  let raw: number
  if (dist?.kind === 'normal') {
    raw = clamp(sampleNormal(dist.mean, dist.stddev, rng), min, max)
  } else if (dist?.kind === 'typical') {
    const from = clamp(dist.from, min, max)
    const to = clamp(dist.to, min, max)
    raw = from + rng.next() * (to - from)
  } else if (node.int) {
    return rng.int(min, max)
  } else {
    return min + rng.next() * (max - min)
  }
  return node.int ? Math.round(raw) : raw
}

export const genDecimal = (
  node: Extract<StandardSchemaNode, { kind: 'decimal' }>,
  dist: Distribution | undefined,
  rng: Rng,
  path: readonly (string | number)[],
): string => {
  const minStr = node.min ?? '0'
  const maxStr = node.max ?? defaultDecimalMax(node.precision, node.scale)
  if (!isNumericString(minStr) || !isNumericString(maxStr)) {
    throw new SchemaConflictError(`decimal: non-numeric bounds min=${minStr} max=${maxStr}`, path)
  }
  const scale = node.scale
  const scaleFactor = 10n ** BigInt(scale)
  const minScaled = toScaledBigInt(minStr, scale)
  const maxScaled = toScaledBigInt(maxStr, scale)
  if (minScaled > maxScaled) {
    throw new SchemaConflictError(`decimal: min (${minStr}) > max (${maxStr})`, path, 'swap min/max')
  }

  // For weighted distributions on decimals we honour the discrete-value path
  // upstream; here we focus on continuous distributions.
  let scaledValue: bigint
  if (dist?.kind === 'normal' || dist?.kind === 'typical') {
    // Continuous distributions remain double-precision (approximate); the
    // result is rounded to the declared scale.
    const minN = Number(minStr)
    const maxN = Number(maxStr)
    let v: number
    if (dist.kind === 'normal') {
      v = clamp(sampleNormal(dist.mean, dist.stddev, rng), minN, maxN)
    } else {
      const from = clamp(dist.from, minN, maxN)
      const to = clamp(dist.to, minN, maxN)
      v = from + rng.next() * (to - from)
    }
    // Round half-away-from-zero in BigInt space to preserve the requested scale.
    scaledValue = roundToScaledBigInt(v, scale)
    // Clamp into integer bounds in case of double rounding error.
    if (scaledValue < minScaled) scaledValue = minScaled
    if (scaledValue > maxScaled) scaledValue = maxScaled
  } else {
    // Uniform over [minScaled, maxScaled] in BigInt space → full precision.
    scaledValue = randomBigIntInclusive(rng, minScaled, maxScaled)
  }
  return formatScaledBigInt(scaledValue, scaleFactor, scale)
}

const isNumericString = (s: string): boolean => /^-?\d+(\.\d+)?$/.test(s)

const toScaledBigInt = (s: string, scale: number): bigint => {
  const negative = s.startsWith('-')
  const body = negative ? s.slice(1) : s
  const [intPart, fracPart = ''] = body.split('.')
  const fracTrunc = fracPart.slice(0, scale)
  const fracPadded = fracTrunc + '0'.repeat(scale - fracTrunc.length)
  const digits = (intPart ?? '0') + fracPadded
  const magnitude = BigInt(digits.length === 0 ? '0' : digits)
  return negative ? -magnitude : magnitude
}

const roundToScaledBigInt = (v: number, scale: number): bigint => {
  // Use a string round-trip so we don't truncate magnitudes above 2^53.
  const fixed = v.toFixed(scale)
  return toScaledBigInt(fixed, scale)
}

const randomBigIntInclusive = (rng: Rng, lo: bigint, hi: bigint): bigint => {
  if (lo === hi) return lo
  const range = hi - lo + 1n
  // Rejection-sample a non-negative BigInt < range using 32-bit RNG chunks.
  let bits = 0
  for (let tmp = range - 1n; tmp > 0n; tmp >>= 1n) bits += 1
  const chunks = Math.ceil(bits / 32)
  for (let attempt = 0; attempt < 64; attempt += 1) {
    let r = 0n
    for (let i = 0; i < chunks; i += 1) {
      // rng.next() ∈ [0, 1); multiply by 2^32 → integer u32.
      const u32 = BigInt(Math.floor(rng.next() * 0x100000000))
      r = (r << 32n) | u32
    }
    // Mask to the smallest power of two ≥ range.
    const mask = (1n << BigInt(bits)) - 1n
    r &= mask
    if (r < range) return lo + r
  }
  /* node:coverage disable */
  // Fallback (statistically improbable: 64 consecutive rejections imply the
  // bit-mask is at most a hair larger than `range`, i.e. probability ≤ 2^-64).
  // Modulo bias is acceptable given the negligible activation rate.
  return lo + (((randomU64(rng) % range) + range) % range)
}

const randomU64 = (rng: Rng): bigint => {
  const hi = BigInt(Math.floor(rng.next() * 0x100000000))
  const lo = BigInt(Math.floor(rng.next() * 0x100000000))
  return (hi << 32n) | lo
}
/* node:coverage enable */

const formatScaledBigInt = (scaled: bigint, scaleFactor: bigint, scale: number): string => {
  const negative = scaled < 0n
  const abs = negative ? -scaled : scaled
  if (scale === 0) return (negative ? '-' : '') + abs.toString()
  const intPart = abs / scaleFactor
  const fracPart = abs % scaleFactor
  const fracStr = fracPart.toString().padStart(scale, '0')
  return (negative ? '-' : '') + intPart.toString() + '.' + fracStr
}

const defaultDecimalMax = (precision: number, scale: number): string => {
  const intDigits = precision - scale
  return '9'.repeat(Math.max(intDigits, 1))
}

const genArray = (
  node: Extract<StandardSchemaNode, { kind: 'array' }>,
  path: readonly (string | number)[],
  state: GenerationContext,
): unknown[] => {
  let len: number
  if (node.length !== undefined) {
    len = node.length
  } else {
    const minL = node.minLength ?? 1
    const maxL = node.maxLength ?? Math.max(minL, 5)
    if (minL > maxL) {
      throw new SchemaConflictError(`array: minLength (${minL}) > maxLength (${maxL})`, path)
    }
    len = state.rng.int(minL, maxL)
  }
  const out: unknown[] = []
  for (let i = 0; i < len; i += 1) {
    out.push(state.generate(node.item, [...path, i], EMPTY_PARENT))
  }
  return out
}

const genObject = (
  node: Extract<StandardSchemaNode, { kind: 'object' }>,
  path: readonly (string | number)[],
  state: GenerationContext,
): Record<string, unknown> => {
  // Two-pass: non-derived first (so derived can read them), derived last.
  const keys = Object.keys(node.fields)
  const derivedKeys: string[] = []
  const out: Record<string, unknown> = {}

  for (const key of keys) {
    const field = node.fields[key]!
    if (state.isDeferred(field)) {
      derivedKeys.push(key)
      continue
    }
    const value = state.generate(field, [...path, key], out)
    if (value === undefined && field.mods?.optional === true) continue
    out[key] = value
  }
  for (const key of derivedKeys) {
    const field = node.fields[key]!
    const value = state.generate(field, [...path, key], out)
    if (value === undefined && field.mods?.optional === true) continue
    out[key] = value
  }
  return out
}
