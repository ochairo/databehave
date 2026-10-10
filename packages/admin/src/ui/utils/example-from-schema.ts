import type { OpenApiDoc, OpenApiSchema } from '../types.js'

/**
 * Trivial recursive sampler that emits a JS value matching the
 * schema's `type`. Honors `example`, `default`, `enum` first; falls
 * back to a per-primitive sensible default (string='string',
 * number=0, etc.). Resolves `$ref` against the provided doc
 * (components.schemas). Bounded depth to avoid infinite recursion
 * via mutually-recursive schemas.
 */
const PRIM: Record<string, unknown> = {
  string: 'string',
  integer: 0,
  number: 0,
  boolean: true,
  null: null,
}

export const exampleFromSchema = (
  schema: OpenApiSchema | undefined,
  doc: OpenApiDoc | null,
  depth = 0,
  seen: Set<string> = new Set(),
): unknown => {
  if (!schema) return null
  if (depth > 8) return null
  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  if (schema.enum && schema.enum.length > 0) return schema.enum[0]
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return null
    const next = new Set(seen)
    next.add(schema.$ref)
    const ref = schema.$ref.replace(/^#\/components\/schemas\//, '')
    const target = doc?.components?.schemas?.[ref]
    return exampleFromSchema(target, doc, depth + 1, next)
  }
  if (schema.oneOf?.[0]) return exampleFromSchema(schema.oneOf[0], doc, depth + 1, seen)
  if (schema.anyOf?.[0]) return exampleFromSchema(schema.anyOf[0], doc, depth + 1, seen)
  if (schema.allOf && schema.allOf.length > 0) {
    const merged: Record<string, unknown> = {}
    for (const part of schema.allOf) {
      const ex = exampleFromSchema(part, doc, depth + 1, seen)
      if (ex && typeof ex === 'object' && !Array.isArray(ex)) Object.assign(merged, ex)
    }
    return merged
  }
  if (schema.type === 'object' || schema.properties) {
    const out: Record<string, unknown> = {}
    const props = schema.properties ?? {}
    for (const [k, v] of Object.entries(props)) {
      out[k] = exampleFromSchema(v, doc, depth + 1, seen)
    }
    return out
  }
  if (schema.type === 'array') {
    return [exampleFromSchema(schema.items, doc, depth + 1, seen)]
  }
  if (typeof schema.type === 'string' && schema.type in PRIM) return PRIM[schema.type]
  return null
}
