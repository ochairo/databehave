/**
 * In-server, zero-dep mock-data generator for OpenAPI-driven mocks.
 *
 *   OpenAPI node → generateFromOasSchema() → deterministic JSON value
 *
 * `@databehave/server` runs standalone for OAS-only consumers — this
 * file is the entire mock-body engine and pulls no DSL dependency at
 * runtime. Output is deterministic placeholder data so tests can pin
 * exact values (`"string"`, `0`, `false`, …) and OAS gaps surface
 * loudly via `onWalkError` in `register.ts`.
 *
 * Single file. No external imports. Sibling-relative only.
 */
import type { OasDoc, OasNode } from './walker.js'

/** Reserved for a future seeded mode (brief item #11). Currently ignored. */
export interface GenerateOptions {
  readonly seed?: number
}

const FORMAT_STRINGS: Readonly<Record<string, string>> = {
  date: '2024-01-01',
  'date-time': '2024-01-01T00:00:00Z',
  email: 'user@example.com',
  uuid: '00000000-0000-4000-8000-000000000000',
  uri: 'https://example.com/',
}

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'string',
  'integer',
  'number',
  'boolean',
  'array',
  'object',
  'null',
])

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const resolveRef = (doc: OasDoc, ref: string): OasNode => {
  if (!ref.startsWith('#/')) {
    throw new Error(
      `@databehave/server/openapi: remote $ref not supported by OAS-only generator: ${ref}`,
    )
  }
  const m = /^#\/components\/schemas\/(.+)$/.exec(ref)
  if (!m) {
    throw new Error(`@databehave/server/openapi: unsupported $ref: ${ref}`)
  }
  const name = decodeURIComponent(m[1]!)
  const target = doc.components?.schemas?.[name]
  if (!target) {
    throw new Error(`@databehave/server/openapi: $ref not found: ${ref}`)
  }
  return target
}

/**
 * Pick the concrete (non-`null`) type when OAS 3.1 declares
 * `["string","null"]`. OAS 3.0 `nullable: true` is treated the same
 * way: the generator never emits `null` from a nullable widening —
 * callers that want explicit `null` use `examples` or `enum`.
 */
const pickType = (node: OasNode): string | undefined => {
  if (Array.isArray(node.type)) {
    return node.type.find((t) => t !== 'null')
  }
  return node.type
}

export const generateFromOasSchema = (
  node: OasNode,
  doc: OasDoc = {},
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _opts: GenerateOptions = {},
  seen: Set<string> = new Set<string>(),
): unknown => {
  const ex = (node as { example?: unknown }).example
  if (ex !== undefined) return ex
  const examples = (node as { examples?: unknown[] }).examples
  if (Array.isArray(examples) && examples.length > 0) return examples[0]
  if (Array.isArray(node.enum) && node.enum.length > 0) return node.enum[0]
  if (node.const !== undefined) return node.const

  if (node.$ref) {
    if (seen.has(node.$ref)) return {}
    const next = new Set(seen)
    next.add(node.$ref)
    return generateFromOasSchema(resolveRef(doc, node.$ref), doc, _opts, next)
  }

  if (Array.isArray(node.allOf) && node.allOf.length > 0) {
    let merged: Record<string, unknown> = {}
    for (const branch of node.allOf) {
      const v = generateFromOasSchema(branch, doc, _opts, seen)
      if (isPlainObject(v)) merged = { ...merged, ...v }
      else return v
    }
    return merged
  }
  if (Array.isArray(node.oneOf) && node.oneOf.length > 0) {
    return generateFromOasSchema(node.oneOf[0]!, doc, _opts, seen)
  }
  if (Array.isArray(node.anyOf) && node.anyOf.length > 0) {
    return generateFromOasSchema(node.anyOf[0]!, doc, _opts, seen)
  }

  let t = pickType(node)
  if (!t && node.properties) t = 'object'
  if (!t && node.items !== undefined) t = 'array'
  if (!t) return {}

  if (typeof t === 'string' && !KNOWN_TYPES.has(t)) {
    throw new Error(
      `@databehave/server/openapi: unsupported OpenAPI node: ${JSON.stringify(node)}`,
    )
  }

  if (t === 'null') return null
  if (t === 'string') {
    if (node.format && FORMAT_STRINGS[node.format]) {
      return FORMAT_STRINGS[node.format]
    }
    return 'string'
  }
  if (t === 'integer' || t === 'number') {
    return typeof node.minimum === 'number' ? node.minimum : 0
  }
  if (t === 'boolean') return false
  if (t === 'array') {
    const itemNode: OasNode = node.items ?? {}
    const count =
      typeof node.minItems === 'number' && node.minItems > 0 ? node.minItems : 1
    const out: unknown[] = []
    for (let i = 0; i < count; i += 1) {
      out.push(generateFromOasSchema(itemNode, doc, _opts, seen))
    }
    return out
  }
  // object
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node.properties ?? {})) {
    out[k] = generateFromOasSchema(v, doc, _opts, seen)
  }
  return out
}
