/**
 * Pins the type-system narrowing introduced by F1 + F2 + F3 + F14:
 *
 *   - `.weighted` is gated by `[Discrete]: true` (only on schemas where
 *     a discrete distribution is meaningful).
 *   - `.normal` / `.typically` are gated by `[Numeric]: true` (only on
 *     numeric / decimal schemas; `int()` is excluded from `.normal`
 *     because `.normal` on integers would silently lose σ to rounding —
 *     the runtime guard mirrors this).
 *   - `obj({...})`, `arr(...)`, `tuple(...)`, `union(...)` get NONE of
 *     the three. A union that *happens* to contain only discrete options
 *     still doesn't get `.weighted` (the markers don't intersect across
 *     a union).
 *   - F14: `int().derivedFrom(relate(rowsWithStringSku, 'sku'))` is a TS
 *     error because `relate` propagates `R[K] = string` through
 *     `DerivedFn<string>`, which doesn't satisfy `U extends number`.
 *
 * Each `@ts-expect-error` asserts the next line raises a TS error.
 * `tsc --noEmit` failing on this file means a positive case regressed
 * AND `tsc --noEmit` succeeding means every negative case still fires.
 *
 * The cases are compressed to single lines so each `@ts-expect-error`
 * suppresses exactly one line.
 */
import {
  arr,
  bool,
  decimal,
  enum_,
  int,
  literal,
  null_,
  num,
  obj,
  relate,
  str,
  tuple,
  union,
  type Schema,
} from '../../src/index.js'

// ──────────────────────────────────────────────────────────────────────
// Positive matrix — all of these MUST compile cleanly.
// ──────────────────────────────────────────────────────────────────────

const _pNumNormal = num().normal(0, 1); void _pNumNormal
const _pNumTypically = num().typically(1, 5); void _pNumTypically
const _pIntWeighted = int().weighted([[1, 0.5], [2, 0.5]]); void _pIntWeighted
const _pIntTypically = int().typically(1, 5); void _pIntTypically
const _pDecNormal = decimal(10, 4).normal(0, 1); void _pDecNormal
const _pDecTypically = decimal(10, 4).typically(0, 100); void _pDecTypically
const _pStrWeighted = str().weighted([['a', 1]]); void _pStrWeighted
const _pEnumWeighted = enum_(['a', 'b'] as const).weighted([['a', 1], ['b', 1]]); void _pEnumWeighted
const _pLiteralWeighted = literal('x').weighted([['x', 1]]); void _pLiteralWeighted
const _pBoolWeighted = bool().weighted([[true, 0.7], [false, 0.3]]); void _pBoolWeighted

// Chains preserve the marker through `.min` / `.max` (uses `this`-typed return)
const _pNumChainNormal = num().min(0).max(100).normal(50, 10); void _pNumChainNormal
const _pIntChainWeighted = int().min(1).max(5).weighted([[1, 1]]); void _pIntChainWeighted

// F14: matching FK type compiles
const _pRelateMatch = (() => {
  const stringRows: readonly { sku: string }[] = [{ sku: 'a' }]
  return str().derivedFrom(relate(stringRows, 'sku'))
})(); void _pRelateMatch

// ──────────────────────────────────────────────────────────────────────
// Negative matrix — every line MUST raise a TS error.
// ──────────────────────────────────────────────────────────────────────

// — composites have no axis caps —
// @ts-expect-error obj has no [Discrete] cap
const _nObjW = obj({ a: str() }).weighted([[ { a: 'x' }, 1 ]]); void _nObjW
// @ts-expect-error obj has no [Numeric] cap
const _nObjN = obj({ a: str() }).normal(0, 1); void _nObjN
// @ts-expect-error obj has no [Numeric] cap
const _nObjT = obj({ a: str() }).typically(1, 5); void _nObjT

// @ts-expect-error arr has no [Discrete] cap
const _nArrW = arr(str()).weighted([['a', 1]]); void _nArrW
// @ts-expect-error arr has no [Numeric] cap
const _nArrN = arr(str()).normal(0, 1); void _nArrN
// @ts-expect-error arr has no [Numeric] cap
const _nArrT = arr(str()).typically(1, 5); void _nArrT

// @ts-expect-error tuple has no [Discrete] cap
const _nTupW = tuple(str(), int()).weighted([]); void _nTupW
// @ts-expect-error tuple has no [Numeric] cap
const _nTupN = tuple(str(), int()).normal(0, 1); void _nTupN

// @ts-expect-error union has no [Discrete] cap (markers don't intersect across alternatives)
const _nUniW = union(str(), int()).weighted([['x', 1]]); void _nUniW
// @ts-expect-error union has no [Numeric] cap
const _nUniN = union(num(), decimal(10, 2)).normal(0, 1); void _nUniN

// — F1 split: num() loses [Discrete]; int() loses [Numeric] —
// @ts-expect-error num() (continuous) has no [Discrete] cap
const _nNumW = num().weighted([[1.5, 0.5]]); void _nNumW
// @ts-expect-error int() has [Discrete] but no [Numeric] cap (Gaussian on int would silently round)
const _nIntN = int().normal(0, 1); void _nIntN

// — F2: bool / null —
// `bool()` returns `BooleanSchema` which carries `[Discrete]: true`, so a
// direct call works (positive matrix above). The gap closed by F2 is the
// base-typed reference: assigning `bool()` to `Schema<boolean>` widens
// away the marker, so `.weighted` becomes a TS error.
const _bAsBase: Schema<boolean> = bool()
// @ts-expect-error Schema<boolean> reference has no [Discrete] marker (closes the cap-via-cast gap)
const _nBoolBaseW = _bAsBase.weighted([[true, 0.5], [false, 0.5]]); void _nBoolBaseW

// Symmetric pin for num(): `num()` returns NumberSchema with [Continuous]:true, so a
// direct call works (positive matrix above). The gap is the base-typed reference: if
// the base-class `declare readonly [Continuous]?: boolean` field were dropped, the
// marker would stop narrowing through `Schema<unknown>` references.
const _numAsBase: Schema<unknown> = num()
// @ts-expect-error Schema<unknown> reference has no [Continuous] marker (closes the cap-via-cast gap)
const _nNumBaseN = _numAsBase.normal(0, 1); void _nNumBaseN

// `null_()` carries no caps at all
// @ts-expect-error null_() has no [Discrete] cap
const _nNullW = null_().weighted([[null, 1]]); void _nNullW
// @ts-expect-error null_() has no [Numeric] cap
const _nNullN = null_().normal(0, 1); void _nNullN
// @ts-expect-error null_() has no [Numeric] cap (runtime-guarded; pins the type-level gate too)
const _nNullT = null_().typically(1, 5); void _nNullT

// — F14: derivedFrom propagates relate's R[K] —
const _rowsWithStringSku: readonly { sku: string }[] = [{ sku: 'a' }, { sku: 'b' }]
// @ts-expect-error relate returns DerivedFn<string>; int() requires DerivedFn<U extends number>
const _nRelateMismatch = int().derivedFrom(relate(_rowsWithStringSku, 'sku')); void _nRelateMismatch
