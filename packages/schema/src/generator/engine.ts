/**
 * Generator engine — turns a SchemaNode + context into a deterministic value.
 *
 * Wires the data-schema axes into the sampling pipeline.
 * Resolution priority during sampling:
 *
 *   1. invariants   (rejection-sample until they hold; bounded by MAX_ATTEMPTS)
 *   2. identity     (handled at dataset layer; not seen here)
 *   3. derived      (computed from sibling/root context — skip sampling entirely)
 *   4. conditional  (union / discriminated branch selection)
 *   5. domain       (closed candidate set)
 *   6. distribution (weighted / normal / typical)
 *   7. type         (fall-back bounds from the IR)
 */

import type {
  Axes,
  DerivedFn,
  Distribution,
  DomainConstraint,
  EventuallyOverride,
  GenContext,
  OccasionalOverride,
} from '../foundation/axes.js'
import { SchemaConflictError } from '../foundation/errors.js'
import type { SchemaNode } from '../foundation/ir.js'
import { mulberry32, rngFromString, seedFromString, type Rng } from '../foundation/prng.js'
import type { Infer, Schema } from '../foundation/types.js'
import type { TraceCollector } from './trace.js'

/**
 * Per-leaf stable-seed hook.
 *
 * Called for every leaf-value sampling (string/number/decimal/boolean/enum/domain).
 * Return a non-empty string to deterministically reseed *just this leaf*
 * (path-scoped) — useful for snapshot/CI runs where a subset of rows must
 * stay identical regardless of the outer `seed`.
 * Return `null`/`undefined`/`''` to fall back to the shared rng (normal random).
 *
 * Composite kinds (object/array/tuple/union) are unaffected; their children
 * re-enter this hook with their own path.
 */
export type StableByFn = (ctx: GenContext) => string | null | undefined

/**
 * Per-modifier probabilities for random injection during generation.
 *
 * These are opt-in. With the default `{ default: 0, optional: 0, nullable: 0 }`
 * `mock()` always samples a real value for the underlying type and never
 * silently substitutes the modifier short-circuit. Set a non-zero probability
 * to exercise the `undefined` / `null` / default-value paths.
 */
export type ModifierProbs = {
  /** Probability that `.default(v)` returns `v` instead of sampling. */
  readonly default?: number
  /** Probability that `.optional()` returns `undefined`. */
  readonly optional?: number
  /** Probability that `.nullable()` returns `null`. */
  readonly nullable?: number
}

export type MockOptions = {
  /** Override the deterministic seed. Either a string or unsigned 32-bit int. */
  readonly seed?: string | number
  /** Caller-supplied context channel exposed to derived/invariants as `ctx.input`. */
  readonly input?: Readonly<Record<string, unknown>>
  /** Top-level row index (used by `mockDataset` so per-row derived can read `ctx.index`). */
  readonly index?: number
  /** Optional trace collector — receives one entry per resolved field. */
  readonly trace?: TraceCollector
  /** Reseed leaf sampling deterministically from a caller-chosen key. */
  readonly stableBy?: StableByFn
  /**
   * Probabilities used for modifier short-circuits during sampling.
   *
   * Defaults are **all zero** — modifiers do not inject randomness unless you
   * explicitly opt in. This makes `mock()` exercise the underlying type by
   * default (e.g. `mock(str().optional())` always returns a string).
   */
  readonly modifierProbs?: ModifierProbs
  /**
   * Override the PRNG factory used when `seed` is a number.
   *
   * Defaults to {@link mulberry32}. When `seed` is a string the seed is
   * first hashed (`seedFromString`) and then handed to this factory.
   *
   * Useful for tests that need to inject a constant or recorded RNG to
   * exercise probability-driven branches deterministically. Production
   * callers should leave this unset — `mulberry32` is the seeded default
   * the determinism contract is calibrated against, and swapping it
   * perturbs the output sequence.
   */
  readonly prng?: (seed: number) => Rng
}

const DEFAULT_SEED = 'databehave'
const MAX_ATTEMPTS = 100
const DEFAULT_MODIFIER_PROBS: Required<ModifierProbs> = { default: 0, optional: 0, nullable: 0 }

/**
 * Generate a value that conforms to the given schema.
 *
 * Deterministic: identical `schema` + `options.seed` always yields the same
 * value, on every machine, every run.
 */
export const mock = <S extends Schema>(schema: S, options: MockOptions = {}): Infer<S> => {
  const seedKey =
    typeof options.seed === 'number' ? String(options.seed) : (options.seed ?? DEFAULT_SEED)
  const prngFactory = options.prng ?? mulberry32
  const rng =
    typeof options.seed === 'number'
      ? prngFactory(options.seed)
      : options.prng !== undefined
        ? prngFactory(seedFromString(seedKey))
        : rngFromString(seedKey)
  const probs: Required<ModifierProbs> = {
    ...DEFAULT_MODIFIER_PROBS,
    ...(options.modifierProbs ?? {}),
  }
  for (const k of ['default', 'optional', 'nullable'] as const) {
    const p = probs[k]
    if (!(p >= 0 && p <= 1)) {
      throw new RangeError(`modifierProbs.${k} must be in [0, 1], got ${p}`)
    }
  }
  const state: GenState = {
    rng,
    rootSeed: seedKey,
    root: undefined,
    modifierProbs: probs,
    ...(options.input !== undefined ? { input: options.input } : {}),
    ...(options.index !== undefined ? { rootIndex: options.index } : {}),
    ...(options.trace !== undefined ? { trace: options.trace } : {}),
    ...(options.stableBy !== undefined ? { stableBy: options.stableBy } : {}),
  }
  const value = generateNode(schema._node, [], EMPTY_PARENT, state)
  state.root = value
  return value as Infer<S>
}

// ──────────────────────────────────────────────────────────────────────────
// internal state
// ──────────────────────────────────────────────────────────────────────────

export type GenState = {
  rng: Rng
  rootSeed: string
  root: unknown
  modifierProbs: Required<ModifierProbs>
  input?: Readonly<Record<string, unknown>>
  rootIndex?: number
  trace?: TraceCollector
  stableBy?: StableByFn
}

/**
 * Pick the rng to use for a single leaf sample.
 *
 * Falls back to the shared `state.rng` unless `stableBy` is configured and
 * returns a non-empty string for the current node — in which case a fresh
 * deterministic rng is seeded by `${key}:${path}`.
 */
const pickLeafRng = (
  state: GenState,
  parent: Readonly<Record<string, unknown>>,
  path: readonly (string | number)[],
): Rng => {
  if (state.stableBy === undefined) return state.rng
  const key = state.stableBy(makeCtx(state, parent, path))
  if (key == null || key === '') return state.rng
  return rngFromString(`${key}:${path.join('.')}`)
}

const EMPTY_PARENT: Readonly<Record<string, unknown>> = Object.freeze({})

/** Find the nearest numeric element walking the path from the end. */
const nearestNumericIndex = (path: readonly (string | number)[]): number | undefined => {
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const seg = path[i]
    if (typeof seg === 'number') return seg
  }
  return undefined
}

const makeCtx = (
  state: GenState,
  parent: Readonly<Record<string, unknown>>,
  path: readonly (string | number)[],
): GenContext => {
  const pathIndex = nearestNumericIndex(path)
  const effectiveIndex = pathIndex ?? state.rootIndex
  const ctx: {
    root: unknown
    parent: Readonly<Record<string, unknown>>
    seed: string
    index?: number
    input?: Readonly<Record<string, unknown>>
  } = {
    root: state.root,
    parent,
    seed: `${state.rootSeed}:${path.join('.')}`,
  }
  if (effectiveIndex !== undefined) ctx.index = effectiveIndex
  if (state.input !== undefined) ctx.input = state.input
  return ctx
}

// ──────────────────────────────────────────────────────────────────────────
// pipeline entry
// ──────────────────────────────────────────────────────────────────────────

export const generateNode = (
  node: SchemaNode,
  path: readonly (string | number)[],
  parent: Readonly<Record<string, unknown>>,
  state: GenState,
): unknown => {
  const mods = node.mods
  const axes: Axes | undefined = mods?.axes
  const trace = state.trace

  const probs = state.modifierProbs
  if (mods?.hasDefault === true && probs.default > 0 && state.rng.next() < probs.default) {
    trace?.emit({ path, axis: 'default' })
    return mods.defaultValue
  }
  if (mods?.optional === true && probs.optional > 0 && state.rng.next() < probs.optional) {
    trace?.emit({ path, axis: 'optional-skip' })
    return undefined
  }
  if (mods?.nullable === true && probs.nullable > 0 && state.rng.next() < probs.nullable) {
    trace?.emit({ path, axis: 'nullable-null' })
    return null
  }

  // derived field — bypass sampling entirely.
  if (axes?.derived !== undefined) {
    const v = runDerived(axes.derived, parent, path, state)
    trace?.emit({ path, axis: 'derived' })
    return v
  }

  // eventually overrides — fire when ctx.index hits the cadence.
  const idx = nearestNumericIndex(path) ?? state.rootIndex
  const eve = applyEventually(axes?.eventually, idx)
  if (eve.hit) {
    trace?.emit({ path, axis: 'eventually' })
    return eve.value
  }

  // occasionally overrides — stack before base sampling.
  const occ = applyOccasionally(axes?.occasionally, state.rng)
  if (occ.hit) {
    trace?.emit({ path, axis: 'occasionally' })
    return occ.value
  }

  const invariants = axes?.invariants ?? []
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const value = sampleByKind(node, axes, path, parent, state)
    if (invariants.length === 0) {
      trace?.emit({ path, axis: axisOfSample(node, axes) })
      return value
    }
    const ctx = makeCtx(state, parent, path)
    if (invariants.every((inv) => inv(value, ctx))) {
      trace?.emit({ path, axis: 'invariant-pass', attempts: attempt + 1 })
      return value
    }
  }

  trace?.emit({ path, axis: 'invariant-fail', attempts: MAX_ATTEMPTS })
  throw new SchemaConflictError(
    `invariant unsatisfied after ${MAX_ATTEMPTS} attempts`,
    path,
    'relax the invariant or narrow the distribution / domain',
  )
}

/** Classify which sampling axis was used (for trace annotations). */
const axisOfSample = (node: SchemaNode, axes: Axes | undefined): 'domain' | 'distribution' | 'type' => {
  if (axes?.domain !== undefined) return 'domain'
  if (axes?.distribution !== undefined) return 'distribution'
  // composite kinds are bucketed under 'type' since their children get their own entries.
  void node
  return 'type'
}

const runDerived = (
  fn: DerivedFn,
  parent: Readonly<Record<string, unknown>>,
  path: readonly (string | number)[],
  state: GenState,
): unknown => {
  return fn(makeCtx(state, parent, path))
}

const applyOccasionally = (
  overrides: readonly OccasionalOverride[] | undefined,
  rng: Rng,
): { hit: true; value: unknown } | { hit: false } => {
  if (overrides === undefined) return { hit: false }
  for (const o of overrides) {
    if (rng.next() < o.p) return { hit: true, value: o.value }
  }
  return { hit: false }
}

const applyEventually = (
  overrides: readonly EventuallyOverride[] | undefined,
  index: number | undefined,
): { hit: true; value: unknown } | { hit: false } => {
  if (overrides === undefined || index === undefined) return { hit: false }
  for (const o of overrides) {
    const offset = o.offset ?? 0
    if (((index - offset) % o.every + o.every) % o.every === 0 && index >= offset) {
      return { hit: true, value: o.value }
    }
  }
  return { hit: false }
}

// ──────────────────────────────────────────────────────────────────────────
// per-kind sampling
// ──────────────────────────────────────────────────────────────────────────

const sampleByKind = (
  node: SchemaNode,
  axes: Axes | undefined,
  path: readonly (string | number)[],
  parent: Readonly<Record<string, unknown>>,
  state: GenState,
): unknown => {
  // Leaf sampling may use a stable per-path rng if `stableBy` opts in.
  // Composites (object/array/tuple/union) keep using `state.rng` for shape
  // decisions (length, branch); their children re-enter this fn and may opt-in.
  const leafRng = (): Rng => pickLeafRng(state, parent, path)

  if (axes?.domain !== undefined) {
    const fromDomain = sampleFromDomain(axes.domain, axes.distribution, parent, leafRng())
    if (fromDomain !== undefined) return fromDomain
  }

  switch (node.kind) {
    case 'string':
      return genString(node, leafRng())
    case 'number':
      return genNumber(node, axes?.distribution, leafRng(), path)
    case 'decimal':
      return genDecimal(node, axes?.distribution, leafRng(), path)
    case 'boolean':
      return leafRng().next() < 0.5
    case 'null':
      return null
    case 'literal':
      return node.value
    case 'enum':
      return sampleDiscrete(node.values, axes?.distribution, leafRng())
    case 'array':
      return genArray(node, path, state)
    case 'object':
      return genObject(node, path, state)
    case 'tuple':
      return node.items.map((item, i) => generateNode(item, [...path, i], parent, state))
    case 'union': {
      const choice = state.rng.pick(node.options)
      return generateNode(choice, path, parent, state)
    }
    case 'discriminated': {
      const tags = Object.keys(node.branches)
      if (tags.length === 0) {
        throw new SchemaConflictError(
          `discriminated: empty branches map`,
          path,
          'declare at least one branch in `discriminated({...})`',
        )
      }
      // Branch selection honours a weighted distribution on tags when declared.
      let tag: string
      if (axes?.distribution?.kind === 'weighted') {
        const filtered = axes.distribution.weights.filter(([v]) => tags.includes(String(v)))
        const picked =
          filtered.length > 0 ? (pickWeighted(filtered, state.rng) as string | undefined) : undefined
        tag = picked ?? state.rng.pick(tags)
      } else {
        tag = state.rng.pick(tags)
      }
      const branch = node.branches[tag] as SchemaNode
      return generateNode(branch, path, parent, state)
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// domain / distribution helpers
// ──────────────────────────────────────────────────────────────────────────

const sampleFromDomain = (
  domain: DomainConstraint,
  dist: Distribution | undefined,
  parent: Readonly<Record<string, unknown>>,
  rng: Rng,
): unknown | undefined => {
  if (domain.kind === 'values') {
    if (domain.values.length === 0) return undefined
    // If a weighted distribution is declared, honour it by picking only
    // weights whose value also lives in the domain.
    if (dist?.kind === 'weighted') {
      const filtered = dist.weights.filter(([v]) => domain.values.includes(v as unknown))
      if (filtered.length > 0) {
        const picked = pickWeighted(filtered, rng)
        if (picked !== undefined) return picked
      }
    }
    return rng.pick(domain.values)
  }
  const keyVal = parent[domain.fromField]
  if (typeof keyVal !== 'string') return undefined
  const candidates = domain.map[keyVal]
  if (candidates === undefined || candidates.length === 0) return undefined
  if (dist?.kind === 'weighted') {
    const filtered = dist.weights.filter(([v]) => candidates.includes(v as unknown))
    if (filtered.length > 0) {
      const picked = pickWeighted(filtered, rng)
      if (picked !== undefined) return picked
    }
  }
  return rng.pick(candidates)
}

const sampleDiscrete = (
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

const pickWeighted = (
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

const clamp = (n: number, min: number, max: number): number =>
  n < min ? min : n > max ? max : n

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

const genString = (
  node: Extract<SchemaNode, { kind: 'string' }>,
  rng: Rng,
): string => {
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

const genNumber = (
  node: Extract<SchemaNode, { kind: 'number' }>,
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

const genDecimal = (
  node: Extract<SchemaNode, { kind: 'decimal' }>,
  dist: Distribution | undefined,
  rng: Rng,
  path: readonly (string | number)[],
): string => {
  const minStr = node.min ?? '0'
  const maxStr = node.max ?? defaultDecimalMax(node.precision, node.scale)
  if (!isNumericString(minStr) || !isNumericString(maxStr)) {
    throw new SchemaConflictError(
      `decimal: non-numeric bounds min=${minStr} max=${maxStr}`,
      path,
    )
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
  return lo + ((randomU64(rng) % range + range) % range)
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
  node: Extract<SchemaNode, { kind: 'array' }>,
  path: readonly (string | number)[],
  state: GenState,
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
    out.push(generateNode(node.item, [...path, i], EMPTY_PARENT, state))
  }
  return out
}

const genObject = (
  node: Extract<SchemaNode, { kind: 'object' }>,
  path: readonly (string | number)[],
  state: GenState,
): Record<string, unknown> => {
  // Two-pass: non-derived first (so derived can read them), derived last.
  const keys = Object.keys(node.fields)
  const derivedKeys: string[] = []
  const out: Record<string, unknown> = {}

  for (const key of keys) {
    const field = node.fields[key]!
    if (field.mods?.axes?.derived !== undefined) {
      derivedKeys.push(key)
      continue
    }
    const value = generateNode(field, [...path, key], out, state)
    if (value === undefined && field.mods?.optional === true) continue
    out[key] = value
  }
  for (const key of derivedKeys) {
    const field = node.fields[key]!
    const value = generateNode(field, [...path, key], out, state)
    if (value === undefined && field.mods?.optional === true) continue
    out[key] = value
  }
  return out
}
