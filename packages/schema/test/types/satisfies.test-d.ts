/**
 * Demonstrates that `satisfies Schema<T>` produces compile errors when expected.
 *
 * Each `@ts-expect-error` asserts that the next line raises a TS error.
 * Each case is compressed to a single line so the directive suppresses exactly that line.
 *
 * The whole file passing `tsc --noEmit` proves every expected error fires.
 */
import { obj, str, int, decimal, arr, enum_, type Schema } from '../../src/index.js'

// ──────────────────────────────────────────────────────────────────────
// (1) Valid case: no error
// ──────────────────────────────────────────────────────────────────────
type Good = {
  group_code: 'A' | 'B' | 'C'
  table: { item_id: number; quantity: string }[]
}
const _Ok = obj({ group_code: enum_(['A', 'B', 'C'] as const), table: arr(obj({ item_id: int(), quantity: decimal(38, 19) })).length(7) }) satisfies Schema<Good>
void _Ok

// ──────────────────────────────────────────────────────────────────────
// (2) Type mismatch (string vs number)
// ──────────────────────────────────────────────────────────────────────
type WantsNumber = { total: number }
// @ts-expect-error — total expects number but str() is provided
const _Bad1 = obj({ total: str() }) satisfies Schema<WantsNumber>
void _Bad1

// ──────────────────────────────────────────────────────────────────────
// (3) Missing field
// ──────────────────────────────────────────────────────────────────────
type TwoFields = { a: number; b: string }
// @ts-expect-error — b is missing
const _Bad2 = obj({ a: int() }) satisfies Schema<TwoFields>
void _Bad2

// ──────────────────────────────────────────────────────────────────────
// (4) Violation in a deeply nested position
// ──────────────────────────────────────────────────────────────────────
type Nested = { meta: { id: number } }
// @ts-expect-error — meta.id is declared as string
const _Bad3 = obj({ meta: obj({ id: str() }) }) satisfies Schema<Nested>
void _Bad3

// ──────────────────────────────────────────────────────────────────────
// (5) Wrong array element type
// ──────────────────────────────────────────────────────────────────────
type ListOfNum = { items: number[] }
// @ts-expect-error — items elements expect number but str() is provided
const _Bad4 = obj({ items: arr(str()) }) satisfies Schema<ListOfNum>
void _Bad4

// ──────────────────────────────────────────────────────────────────────
// (6) Primitive mismatch (decimal yields string, so a number target errors)
// ──────────────────────────────────────────────────────────────────────
type WantNum = { x: number }
// @ts-expect-error — decimal produces string
const _Bad5 = obj({ x: decimal(10, 2) }) satisfies Schema<WantNum>
void _Bad5
