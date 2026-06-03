/**
 * Internal Representation (IR) of a databehave schema.
 *
 * Every schema builder compiles to one of these serializable nodes.
 * The generator and validator operate on IR — never on builder classes —
 * so IR can be inspected, logged, transformed, or transported.
 */

export type StringFormat =
  | 'plain'
  | 'uuid'
  | 'email'
  | 'url'
  | 'ipv4'
  | 'ipv6'
  | 'date'
  | 'datetime'
  | 'time'

export type NumberKind = {
  readonly kind: 'number'
  readonly int: boolean
  readonly bits?: 8 | 16 | 32 | 64
  readonly unsigned?: boolean
  readonly min?: number
  readonly max?: number
}

export type StringKind = {
  readonly kind: 'string'
  readonly format: StringFormat
  readonly min?: number
  readonly max?: number
  readonly pattern?: string
}

export type DecimalKind = {
  readonly kind: 'decimal'
  readonly precision: number
  readonly scale: number
  readonly min?: string
  readonly max?: string
}

export type BooleanKind = { readonly kind: 'boolean' }
export type NullKind = { readonly kind: 'null' }

export type LiteralKind = {
  readonly kind: 'literal'
  readonly value: string | number | boolean | null
}

export type EnumKind = {
  readonly kind: 'enum'
  readonly values: readonly (string | number)[]
}

export type ArrayKind = {
  readonly kind: 'array'
  readonly item: SchemaNode
  readonly length?: number
  readonly minLength?: number
  readonly maxLength?: number
}

export type ObjectKind = {
  readonly kind: 'object'
  readonly fields: Readonly<Record<string, SchemaNode>>
}

export type TupleKind = {
  readonly kind: 'tuple'
  readonly items: readonly SchemaNode[]
}

export type UnionKind = {
  readonly kind: 'union'
  readonly options: readonly SchemaNode[]
}

/**
 * A discriminated union — selects exactly one branch by the value of `key`.
 *
 * Each entry in `branches` must be an object-kind schema whose `key` field is
 * a `literal(...)` matching the map key. Generator and validator both use
 * the discriminator for O(1) branch selection.
 */
export type DiscriminatedKind = {
  readonly kind: 'discriminated'
  readonly key: string
  readonly branches: Readonly<Record<string, SchemaNode>>
}

import type { Axes } from './axes.js'
import { mergeAxes } from './axes.js'

export type Modifiers = {
  readonly nullable?: boolean
  readonly optional?: boolean
  readonly hasDefault?: boolean
  readonly defaultValue?: unknown
  readonly description?: string
  readonly axes?: Axes
}

export type SchemaCore =
  | NumberKind
  | StringKind
  | DecimalKind
  | BooleanKind
  | NullKind
  | LiteralKind
  | EnumKind
  | ArrayKind
  | ObjectKind
  | TupleKind
  | UnionKind
  | DiscriminatedKind

export type SchemaNode = SchemaCore & {
  readonly mods?: Modifiers
}

/** Helper: produce a fresh node with merged modifiers. `axes` are deep-merged. */
export const withMods = (node: SchemaNode, patch: Partial<Modifiers>): SchemaNode => {
  const prev = node.mods ?? {}
  const mergedAxes = patch.axes !== undefined ? mergeAxes(prev.axes, patch.axes) : prev.axes
  const next: Modifiers = mergedAxes !== undefined ? { ...prev, ...patch, axes: mergedAxes } : { ...prev, ...patch }
  return { ...node, mods: next }
}
