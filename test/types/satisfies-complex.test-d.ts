/**
 * Demonstrates that even a complex databehave schema passes `satisfies Schema<T>`
 * without type errors.
 *
 * Features exercised together:
 *   - .correlate (typed row → ObjectSchema)
 *   - .invariant (predicate)
 *   - .eventually(every, value)  (periodic fixed value)
 *   - .occasionally(value, p)    (probabilistic fixed value)  note argument order
 *   - .weighted([[v, w]])        (weighting)
 *   - .derivedFrom(ctx => ...)   (derived)
 *   - .default / .optional / .nullable
 *   - .min / .max / .length      (axes)
 *   - .in([...])                 (domain constraint)
 *
 * A clean `tsc --noEmit` proves the FE types stay aligned under complex chains.
 */
import {
  obj, str, int, num, decimal, arr, enum_, bool,
  type Schema, type Infer,
} from '../../src/index.js'

// ──────────────────────────────────────────────────────────────────────
// FE-side type (assumed shape produced by openapi-typescript / orval)
// ──────────────────────────────────────────────────────────────────────
type Item = {
  item_id: number
  capacity: number
  current: number
  utilization: number
  status: 'on' | 'idle' | 'off'
  last_seen: string | null
}

type CatalogReport = {
  group_code: 'A' | 'B' | 'C'
  report_date: string
  is_flagged: boolean
  total_capacity: number
  total_current: number
  total_decimal: string
  items: Item[]
  // Under exactOptionalPropertyTypes, declare `string | undefined` explicitly
  comment?: string | undefined
}

// ──────────────────────────────────────────────────────────────────────
// (1) ItemSchema — every feature combined
// ──────────────────────────────────────────────────────────────────────
const ItemSchema = obj({
  item_id: int().min(1).max(99),
  capacity: num().min(1000).max(50000),
  current: num().min(0).max(50000),
  utilization: num().derivedFrom((ctx) => {
    const p = ctx.parent as { capacity: number; current: number }
    return p.capacity === 0 ? 0 : (p.current / p.capacity) * 100
  }),
  status: enum_(['on', 'idle', 'off'] as const).weighted([
    ['on', 0.7],
    ['idle', 0.2],
    ['off', 0.1],
  ]),
  // occasionally(value, p) → nullable() → eventually(every, value) chain
  last_seen: str().occasionally('2020-01-01', 0.05).nullable().eventually(30, null),
})
  .correlate((t) => t.current <= t.capacity)

const _ItemOk = ItemSchema satisfies Schema<Item>
void _ItemOk

// ──────────────────────────────────────────────────────────────────────
// (2) ReportSchema — array, derivedFrom, optional, decimal
// ──────────────────────────────────────────────────────────────────────
const ReportSchema = obj({
  group_code: enum_(['A', 'B', 'C'] as const),
  report_date: str(),
  is_flagged: bool().weighted([[true, 0.15], [false, 0.85]]),
  total_capacity: num().derivedFrom((ctx) => {
    const items = (ctx.parent as { items: Item[] }).items
    return items.reduce((s, t) => s + t.capacity, 0)
  }),
  total_current: num().derivedFrom((ctx) => {
    const items = (ctx.parent as { items: Item[] }).items
    return items.reduce((s, t) => s + t.current, 0)
  }),
  total_decimal: decimal(38, 19),
  items: arr(ItemSchema).length(5),
  comment: str().default('placeholder').optional(),
}) satisfies Schema<CatalogReport>
void ReportSchema

// ──────────────────────────────────────────────────────────────────────
// (3) .in([...]) domain constraint keeps the type intact
// ──────────────────────────────────────────────────────────────────────
type WithCode = { code: string }
const _DomainOk = obj({
  code: str().in(['A001', 'A002', 'A003'] as const),
}) satisfies Schema<WithCode>
void _DomainOk

// ──────────────────────────────────────────────────────────────────────
// (4) Infer<typeof ItemSchema> is also assignable to the FE type
// ──────────────────────────────────────────────────────────────────────
const _inferredItem: Infer<typeof ItemSchema> = {
  item_id: 1,
  capacity: 1000,
  current: 500,
  utilization: 50,
  status: 'on',
  last_seen: null,
}
const _inferredAsFE: Item = _inferredItem
void _inferredAsFE
