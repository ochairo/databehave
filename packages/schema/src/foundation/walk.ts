/**
 * Extensibility API — IR walker and IR-to-builder reconstruction.
 *
 * databehave intentionally ships no CLI, no OpenAPI ingestion, no zod adapter,
 * no GUI — these belong in *external* packages. This module exposes the
 * minimum surface those packages need:
 *
 *   - `walkSchema(node, visitor)` : pre/post-order traversal with paths
 *   - `fromIR(node)`              : reconstruct a `Schema` builder from IR
 *
 * Combined with the already-public `SchemaNode`, `Modifiers`, `Axes`,
 * `mock`, `parse`, `mockDataset`, `createTrace`, and `seedFromString` /
 * `rngFromString`, this is the full extension contract.
 *
 * Extension authors do NOT subclass `Schema`. They build IR (or compose
 * existing builders) and call `fromIR` to obtain a typed builder back.
 */

import {
  arr,
  enum_,
  literal,
  obj,
  tuple,
  union,
} from '../schema/composites.js'
import { discriminated } from '../schema/conditional.js'
import { decimal } from '../schema/decimal.js'
import { bool, int, null_, num, str } from '../schema/primitives.js'
import { SchemaConflictError } from './errors.js'
import { Schema } from './types.js'
import type { SchemaNode } from './ir.js'

export type WalkPath = readonly (string | number)[]

export type SchemaVisitor = {
  /** Called before descending into a node's children. Return false to skip subtree. */
  readonly enter?: (node: SchemaNode, path: WalkPath) => void | boolean
  /** Called after all children have been visited. */
  readonly leave?: (node: SchemaNode, path: WalkPath) => void
}

/**
 * Depth-first pre/post-order traversal of a schema IR tree.
 *
 * The visitor receives every node (including composites) with its
 * JSON-pointer-style path. Use this to power codegen (OpenAPI, zod, SQL DDL,
 * documentation) without coupling to the builder classes.
 */
export const walkSchema = (
  schemaOrNode: Schema | SchemaNode,
  visitor: SchemaVisitor,
): void => {
  const root: SchemaNode = schemaOrNode instanceof Schema ? schemaOrNode._node : schemaOrNode
  walk(root, [], visitor)
}

const walk = (node: SchemaNode, path: WalkPath, v: SchemaVisitor): void => {
  const shouldDescend = v.enter ? v.enter(node, path) !== false : true
  if (shouldDescend) {
    switch (node.kind) {
      case 'object':
        for (const k of Object.keys(node.fields)) {
          walk(node.fields[k]!, [...path, k], v)
        }
        break
      case 'array':
        walk(node.item, [...path, '[]'], v)
        break
      case 'tuple':
        node.items.forEach((it, i) => walk(it, [...path, i], v))
        break
      case 'union':
        node.options.forEach((o, i) => walk(o, [...path, `|${i}`], v))
        break
      case 'discriminated': {
        // Positional `|i` tags mirror `union` so codegen tools can treat
        // both as ordered alternatives.
        const tags = Object.keys(node.branches)
        tags.forEach((tag, i) => walk(node.branches[tag]!, [...path, `|${i}`], v))
        break
      }
      default:
        break
    }
  }
  v.leave?.(node, path)
}

/**
 * Reconstruct a `Schema` builder from an IR node.
 *
 * Modifiers (`nullable`, `optional`, `default`, `describe`, axes) are
 * preserved. Returns `Schema<unknown>` — extension authors that know the shape
 * statically can cast to a more precise type.
 */
export const fromIR = (node: SchemaNode): Schema<unknown> => {
  const base = buildBase(node)
  return applyMods(base, node)
}

const buildBase = (node: SchemaNode): Schema<unknown> => {
  switch (node.kind) {
    case 'string': {
      let s = str()
      if (node.min !== undefined) s = s.min(node.min)
      if (node.max !== undefined) s = s.max(node.max)
      if (node.pattern !== undefined) s = s.pattern(node.pattern)
      return s as Schema<unknown>
    }
    case 'number': {
      let n = node.int ? int() : num()
      if (node.min !== undefined) n = n.min(node.min)
      if (node.max !== undefined) n = n.max(node.max)
      return n as Schema<unknown>
    }
    case 'decimal': {
      let d = decimal(node.precision, node.scale)
      if (node.min !== undefined) d = d.min(node.min)
      if (node.max !== undefined) d = d.max(node.max)
      return d as Schema<unknown>
    }
    case 'boolean':
      return bool()
    case 'null':
      return null_()
    case 'literal':
      return literal(node.value) as Schema<unknown>
    case 'enum':
      return enum_(node.values as readonly (string | number)[]) as Schema<unknown>
    case 'object': {
      const fields: Record<string, Schema> = {}
      for (const k of Object.keys(node.fields)) {
        fields[k] = fromIR(node.fields[k]!) as Schema
      }
      return obj(fields) as Schema<unknown>
    }
    case 'array': {
      let a = arr(fromIR(node.item) as Schema)
      if (node.length !== undefined) a = a.length(node.length)
      else {
        if (node.minLength !== undefined) a = a.min(node.minLength)
        if (node.maxLength !== undefined) a = a.max(node.maxLength)
      }
      return a as Schema<unknown>
    }
    case 'tuple': {
      const items = node.items.map((it) => fromIR(it) as Schema)
      return tuple(...items) as Schema<unknown>
    }
    case 'union': {
      const opts = node.options.map((o) => fromIR(o) as Schema)
      return union(...opts) as Schema<unknown>
    }
    case 'discriminated': {
      // Reconstruct the branches as object schemas and feed them back to the
      // builder. Round-tripping preserves the discriminator key.
      const branchSchemas: Record<string, Schema<unknown>> = {}
      for (const tag of Object.keys(node.branches)) {
        branchSchemas[tag] = fromIR(node.branches[tag]!) as Schema<unknown>
      }
      return discriminated(node.key, branchSchemas) as unknown as Schema<unknown>
    }
  }
}

const applyMods = (schema: Schema<unknown>, node: SchemaNode): Schema<unknown> => {
  const mods = node.mods
  if (mods === undefined) return schema
  let out: Schema<unknown> = schema
  if (mods.nullable === true) out = out.nullable() as Schema<unknown>
  if (mods.optional === true) out = out.optional() as Schema<unknown>
  if (mods.hasDefault === true) out = out.default(mods.defaultValue) as Schema<unknown>
  if (mods.description !== undefined) out = out.describe(mods.description) as Schema<unknown>
  if (mods.axes !== undefined) {
    // Use the public axes-replay helper instead of reaching through a
    // protected method via a cast.
    out = out._applyAxes(mods.axes) as Schema<unknown>
  }
  return out
}

// ── IR versioning ──────────────────────────────────────────────────────
//
// The wire envelope ships a `$databehaveVersion` so a node serialised
// by one MAJOR cannot silently load into an incompatible one. Bare
// `SchemaNode`s remain accepted by `fromIR` for backward compatibility
// with in-process extension authors; cross-process / on-disk callers
// should round-trip through `serializeSchema` / `deserializeSchema`.

/** Current IR contract version. Bumped on every MAJOR release. */
export const IR_VERSION = 1 as const

/** Envelope produced by {@link serializeSchema}. */
export interface SchemaEnvelope {
  /** Reserved for forward compatibility; do not vary. */
  readonly $databehaveVersion: typeof IR_VERSION
  readonly node: SchemaNode
}

/**
 * Wrap a schema's IR in a versioned envelope safe for serialisation
 * (JSON, disk, IPC). Pair with {@link deserializeSchema} on the
 * receiving end.
 *
 * Throws {@link SchemaConflictError} (`code: 'serialize.closure-axis'`)
 * when any node in the tree carries a closure-bearing axis — `derived`,
 * `invariants`, or an `occasionally` override whose `value` is a
 * function. Closures cannot survive a JSON round-trip, so encoding such
 * a schema would silently drop the axis on the receiving end and
 * produce subtly wrong values. The check is loud at the encode site so
 * callers reach for {@link replay} or hand-coded carriers instead.
 */
export const serializeSchema = (schema: Schema<unknown>): SchemaEnvelope => {
  assertNoClosureAxes(schema._node, [])
  return {
    $databehaveVersion: IR_VERSION,
    node: schema._node,
  }
}

const assertNoClosureAxes = (node: SchemaNode, path: WalkPath): void => {
  const axes = node.mods?.axes
  if (axes !== undefined) {
    if (typeof axes.derived === 'function') {
      throw new SchemaConflictError(
        `serializeSchema: axis 'derived' carries a closure that cannot be JSON-serialised`,
        [...path, 'axes', 'derived'],
        'closures cannot survive JSON round-trip — keep derivedFrom() at the call site',
        'serialize.closure-axis',
      )
    }
    if (axes.invariants !== undefined && axes.invariants.length > 0) {
      const idx = axes.invariants.findIndex((fn) => typeof fn === 'function')
      if (idx >= 0) {
        throw new SchemaConflictError(
          `serializeSchema: axis 'invariants[${idx}]' carries a closure that cannot be JSON-serialised`,
          [...path, 'axes', 'invariants', idx],
          'closures cannot survive JSON round-trip — keep invariant() at the call site',
          'serialize.closure-axis',
        )
      }
    }
    if (axes.occasionally !== undefined) {
      const idx = axes.occasionally.findIndex((o) => typeof o.value === 'function')
      if (idx >= 0) {
        throw new SchemaConflictError(
          `serializeSchema: axis 'occasionally[${idx}].value' carries a closure that cannot be JSON-serialised`,
          [...path, 'axes', 'occasionally', idx, 'value'],
          'closures cannot survive JSON round-trip — keep occasionally() at the call site',
          'serialize.closure-axis',
        )
      }
    }
  }
  switch (node.kind) {
    case 'object':
      for (const k of Object.keys(node.fields)) {
        assertNoClosureAxes(node.fields[k]!, [...path, k])
      }
      return
    case 'array':
      assertNoClosureAxes(node.item, [...path, '[]'])
      return
    case 'tuple':
      node.items.forEach((it, i) => assertNoClosureAxes(it, [...path, i]))
      return
    case 'union':
      node.options.forEach((o, i) => assertNoClosureAxes(o, [...path, `|${i}`]))
      return
    case 'discriminated': {
      const tags = Object.keys(node.branches)
      tags.forEach((tag, i) =>
        assertNoClosureAxes(node.branches[tag]!, [...path, `|${i}`]),
      )
      return
    }
    default:
      return
  }
}

/**
 * Inverse of {@link serializeSchema}. Throws when the envelope was
 * produced by an incompatible MAJOR version — the failure is loud
 * because silently loading a node with a renamed or removed field
 * would manifest as a subtle generation/parse bug far from the cause.
 */
export const deserializeSchema = (envelope: unknown): Schema<unknown> => {
  if (typeof envelope !== 'object' || envelope === null) {
    throw new TypeError(
      `databehave/deserializeSchema: expected an envelope object, got ${typeof envelope}`,
    )
  }
  const v = (envelope as { $databehaveVersion?: unknown }).$databehaveVersion
  if (v !== IR_VERSION) {
    throw new Error(
      `databehave/deserializeSchema: incompatible IR version ` +
        `(envelope=${JSON.stringify(v)}, this build=${IR_VERSION}). ` +
        `Re-serialise with the matching databehave MAJOR.`,
    )
  }
  const node = (envelope as { node?: unknown }).node
  if (typeof node !== 'object' || node === null) {
    throw new TypeError('databehave/deserializeSchema: envelope.node must be an IR object')
  }
  return fromIR(node as SchemaNode)
}
