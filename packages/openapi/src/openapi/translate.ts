/** OpenAPI schemas translated through an explicitly supplied schema builder API. */
import type { Schema, ObjectSchema } from '@databehave/schema'
import type { OasDoc as OasDocument, OasNode as OasSchemaNode } from './walker.js'

/** Builders are metadata carriers; generation uses the caller's separate runtime instance. */
export type SchemaBuilderApi = Pick<typeof import('@databehave/schema'),
  'literal' | 'tuple' | 'obj' | 'arr' | 'enum_' | 'union' | 'bool' | 'null_' |
  'StringSchema' | 'NumberSchema' | 'ObjectSchema' | 'discriminated'>

const DEPTH_CAP = 64
const PATTERN_MAX_LENGTH = 1024

const UNSUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  'if', 'then', 'else',
  'dependentSchemas', 'dependentRequired',
  'unevaluatedProperties', 'unevaluatedItems',
  'contentEncoding', 'contentMediaType',
  'propertyNames', 'patternProperties',
])

const FORMAT_MAP: Readonly<Record<string, 'date' | 'datetime' | 'email' | 'uuid' | 'url'>> = {
  date: 'date',
  'date-time': 'datetime',
  email: 'email',
  uuid: 'uuid',
  uri: 'url',
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const buildErr = (pointer: string, message: string): Error =>
  new Error(`@databehave/openapi: ${message} (at ${pointer})`)

const resolveRef = (ref: string, doc: OasDocument, pointer: string): OasSchemaNode => {
  if (ref.includes('://')) throw buildErr(pointer, `unsupported $ref: ${ref}`)
  const m = /^#\/components\/schemas\/(.+)$/.exec(ref)
  if (!m) throw buildErr(pointer, `unsupported $ref: ${ref}`)
  const name = decodeURIComponent(m[1]!)
  const target = doc.components?.schemas?.[name]
  if (!target) throw buildErr(pointer, `$ref not found: ${ref}`)
  return target
}

/**
 * Build a databehave Schema from an arbitrary JSON value, used when
 * an OAS node carries a literal `example` / `examples[0]` / `const`
 * payload. Recursively maps objects → `obj({...})` and arrays →
 * `tuple(...)` so the entire value is preserved in the IR.
 */
const literalize = (value: unknown, m: SchemaBuilderApi, pointer: string, depth: number): Schema<unknown> => {
  if (depth > DEPTH_CAP) {
    throw buildErr(pointer, `schema nesting exceeds depth cap of ${DEPTH_CAP}`)
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return m.literal(value) as Schema<unknown>
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return m.tuple() as Schema<unknown>
    return m.tuple(...value.map((v) => literalize(v, m, pointer, depth + 1))) as Schema<unknown>
  }
  if (isObj(value)) {
    const fields: Record<string, Schema<unknown>> = {}
    for (const [k, v] of Object.entries(value)) {
      fields[k] = literalize(v, m, pointer, depth + 1)
    }
    return m.obj(fields) as Schema<unknown>
  }
  throw buildErr(pointer, `cannot literalize value of type ${typeof value}`)
}

/** Translator recursion context; no module-global schema instance. */
interface Ctx {
  readonly doc: OasDocument
  readonly refStack: readonly string[]
  readonly depth: number
  readonly pointer: string
  readonly m: SchemaBuilderApi
}

const enterPtr = (ctx: Ctx, segment: string): Ctx => ({
  ...ctx,
  pointer: `${ctx.pointer}/${segment}`,
  depth: ctx.depth + 1,
})

const pickType = (node: OasSchemaNode): string | undefined => {
  if (Array.isArray(node.type)) return node.type.find((t) => t !== 'null')
  return node.type
}

const isNullable = (node: OasSchemaNode): boolean =>
  node.nullable === true || (Array.isArray(node.type) && node.type.includes('null'))

const buildString = (node: OasSchemaNode, ctx: Ctx): Schema<unknown> => {
  if (typeof node.pattern === 'string') {
    if (node.pattern.length > PATTERN_MAX_LENGTH) {
      throw buildErr(
        ctx.pointer,
        `pattern length ${node.pattern.length} exceeds cap of ${PATTERN_MAX_LENGTH} (ReDoS guard)`,
      )
    }
    if (typeof node.maxLength !== 'number') {
      throw buildErr(
        ctx.pointer,
        'pattern requires maxLength on the same schema (footgun: ReDoS)',
      )
    }
    try { new RegExp(node.pattern) } catch (err) {
      throw buildErr(
        ctx.pointer,
        `invalid pattern: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  const fmt = typeof node.format === 'string' ? FORMAT_MAP[node.format] : undefined
  return new ctx.m.StringSchema({
    kind: 'string', format: fmt ?? 'plain',
    ...(typeof node.minLength === 'number' ? { min: node.minLength } : {}),
    ...(typeof node.maxLength === 'number' ? { max: node.maxLength } : {}),
    ...(typeof node.pattern === 'string' ? { pattern: node.pattern } : {}),
  })
}

const buildNumber = (node: OasSchemaNode, ctx: Ctx, isInt: boolean): Schema<unknown> => {
  // schema's IR has only min/max (inclusive). exclusiveMinimum/Maximum are
  // approximated as inclusive for IR mock-generation purposes — the
  // generated value drift is at most one ulp / one int and acceptable for
  // placeholder fixtures. The validator (validate.ts) still enforces the
  // exact exclusive semantics on real inbound requests.
  const numNode: { kind: 'number'; int: boolean; min?: number; max?: number } = { kind: 'number', int: isInt }
  if (typeof node.minimum === 'number') numNode.min = node.minimum
  else if (typeof (node as { exclusiveMinimum?: number }).exclusiveMinimum === 'number') {
    numNode.min = (node as { exclusiveMinimum: number }).exclusiveMinimum
  }
  if (typeof node.maximum === 'number') numNode.max = node.maximum
  else if (typeof (node as { exclusiveMaximum?: number }).exclusiveMaximum === 'number') {
    numNode.max = (node as { exclusiveMaximum: number }).exclusiveMaximum
  }
  return new ctx.m.NumberSchema(numNode) as Schema<unknown>
}

const buildArray = (node: OasSchemaNode, ctx: Ctx): Schema<unknown> => {
  const itemNode: OasSchemaNode = node.items ?? {}
  const itemSchema = translate(itemNode, enterPtr(ctx, 'items'))
  let arr = ctx.m.arr(itemSchema)
  if (typeof node.minItems === 'number') arr = arr.min(node.minItems)
  if (typeof node.maxItems === 'number') arr = arr.max(node.maxItems)
  return arr
}

const buildObject = (node: OasSchemaNode, ctx: Ctx): Schema<unknown> => {
  const required = new Set(Array.isArray(node.required) ? node.required : [])
  const fields: Record<string, Schema<unknown>> = {}
  for (const [k, child] of Object.entries(node.properties ?? {})) {
    const childSchema = translate(child, enterPtr(ctx, `properties/${k}`))
    fields[k] = required.has(k) ? childSchema : (childSchema.optional() as Schema<unknown>)
  }
  // `additionalProperties` is a no-op for *generation* — we only ever
  // emit the declared `properties` above, so we never invent extra
  // keys regardless of the keyword's value. We still acknowledge it
  // explicitly so the translator's keyword surface mirrors
  // `validation/validate.ts` (which DOES enforce it on inbound bodies).
  const ap = (node as { additionalProperties?: boolean | OasSchemaNode }).additionalProperties
  if (ap === false) {
    // Strict-extra-keys: aligned with validator behaviour. No-op here.
  } else if (ap === true || ap === undefined) {
    // Open object: no-op — generator never invents undeclared keys.
  } else if (isObj(ap)) {
    // Schema form: translate-and-discard. We don't use the result for
    // generation (we never emit extra keys), but recursing now means
    // an unsupported nested keyword (e.g. `if`) FAILS LOUD at build
    // time instead of being silently accepted.
    translate(ap, enterPtr(ctx, 'additionalProperties'))
  }
  return ctx.m.obj(fields) as Schema<unknown>
}

const isObjectSchema = (schema: Schema<unknown>, builders: SchemaBuilderApi): schema is ObjectSchema =>
  schema instanceof builders.ObjectSchema

const buildDiscriminated = (
  ctx: Ctx,
  disc: { propertyName: string; mapping: Record<string, string> },
): Schema<unknown> => {
  const branches: Record<string, ObjectSchema> = {}
  for (const [tag, ref] of Object.entries(disc.mapping)) {
    const childCtx = enterPtr(ctx, `discriminator/mapping/${tag}`)
    if (childCtx.refStack.includes(ref)) {
      throw buildErr(childCtx.pointer, `$ref cycle detected: ${ref}`)
    }
    const target = resolveRef(ref, ctx.doc, childCtx.pointer)
    const branchSchema = translate(target, {
      ...childCtx,
      refStack: [...childCtx.refStack, ref],
      pointer: ref,
    })
    if (!isObjectSchema(branchSchema, ctx.m)) {
      throw buildErr(
        childCtx.pointer,
        `discriminator branch ${JSON.stringify(tag)} must be an object schema`,
      )
    }
    // Force the discriminator field to literal(tag) so `discriminated()`
    // accepts the branch — OAS schemas typically declare it as
    // `type: 'string'` rather than constraining to the tag value.
    const objBranch = branchSchema
    const newFields: Record<string, Schema<unknown>> = {
      ...objBranch._fields,
      [disc.propertyName]: ctx.m.literal(tag) as Schema<unknown>,
    }
    branches[tag] = ctx.m.obj(newFields)
  }
  return ctx.m.discriminated(disc.propertyName, branches) as Schema<unknown>
}

const buildAllOfMerge = (node: OasSchemaNode, ctx: Ctx): Schema<unknown> | null => {
  // Mirror generate.ts: shallow-merge object-typed branches into a
  // single obj schema. If any branch isn't object-typed once translated
  // we bail and let the caller fall through to other precedence rules.
  const merged: Record<string, Schema<unknown>> = {}
  let allObjects = true
  for (let i = 0; i < node.allOf!.length; i++) {
    const branch = translate(node.allOf![i]!, enterPtr(ctx, `allOf/${i}`))
    if (!isObjectSchema(branch, ctx.m)) {
      allObjects = false
      break
    }
    const fields = branch._fields
    for (const [k, v] of Object.entries(fields)) merged[k] = v
  }
  if (!allObjects) return null
  return ctx.m.obj(merged) as Schema<unknown>
}

const translate = (node: OasSchemaNode, ctx: Ctx): Schema<unknown> => {
  if (ctx.depth > DEPTH_CAP) {
    throw buildErr(ctx.pointer, `schema nesting exceeds depth cap of ${DEPTH_CAP}`)
  }
  if (!isObj(node)) throw buildErr(ctx.pointer, 'schema node must be an object')

  for (const key of Object.keys(node)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) {
      throw buildErr(ctx.pointer, `unsupported JSON Schema keyword: ${key}`)
    }
  }

  // Precedence (mirrors generate.ts):
  //   example > examples[0] > enum > const > $ref > allOf > oneOf > anyOf > type
  if (node.example !== undefined) {
    return literalize(node.example, ctx.m, ctx.pointer, ctx.depth)
  }
  if (Array.isArray(node.examples) && node.examples.length > 0) {
    return literalize(node.examples[0], ctx.m, ctx.pointer, ctx.depth)
  }
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    const allStrNum = node.enum.every(
      (v) => typeof v === 'string' || typeof v === 'number',
    )
    return allStrNum
      ? (ctx.m.enum_(node.enum as readonly (string | number)[]) as Schema<unknown>)
      : (ctx.m.union(
          ...node.enum.map((v) => literalize(v, ctx.m, ctx.pointer, ctx.depth)),
        ) as Schema<unknown>)
  }
  if (node.const !== undefined) {
    return literalize(node.const, ctx.m, ctx.pointer, ctx.depth)
  }

  if (typeof node.$ref === 'string') {
    if (ctx.refStack.includes(node.$ref)) {
      throw buildErr(
        ctx.pointer,
        `$ref cycle detected: ${[...ctx.refStack, node.$ref].join(' -> ')}`,
      )
    }
    const target = resolveRef(node.$ref, ctx.doc, ctx.pointer)
    const out = translate(target, {
      ...ctx,
      refStack: [...ctx.refStack, node.$ref],
      depth: ctx.depth + 1,
      pointer: node.$ref,
    })
    return isNullable(node) ? (out.nullable() as Schema<unknown>) : out
  }

  if (Array.isArray(node.allOf) && node.allOf.length > 0) {
    const merged = buildAllOfMerge(node, ctx)
    if (merged !== null) return isNullable(node) ? (merged.nullable() as Schema<unknown>) : merged
  }

  const disc = (node as { discriminator?: { propertyName: string; mapping?: Record<string, string> } }).discriminator
  if (Array.isArray(node.oneOf) && node.oneOf.length > 0) {
    if (disc && disc.mapping) {
      const out = buildDiscriminated(
        ctx,
        { propertyName: disc.propertyName, mapping: disc.mapping },
      )
      return isNullable(node) ? (out.nullable() as Schema<unknown>) : out
    }
    const branches = node.oneOf.map((b, i) => translate(b, enterPtr(ctx, `oneOf/${i}`)))
    const out = ctx.m.union(...branches) as Schema<unknown>
    return isNullable(node) ? (out.nullable() as Schema<unknown>) : out
  }
  if (Array.isArray(node.anyOf) && node.anyOf.length > 0) {
    const branches = node.anyOf.map((b, i) => translate(b, enterPtr(ctx, `anyOf/${i}`)))
    const out = ctx.m.union(...branches) as Schema<unknown>
    return isNullable(node) ? (out.nullable() as Schema<unknown>) : out
  }

  // type-fallback
  let t = pickType(node)
  if (!t && node.properties) t = 'object'
  if (!t && node.items !== undefined) t = 'array'
  if (!t) {
    // Unknown / open node: best-effort — empty object schema, with
    // nullable applied if requested.
    const empty = ctx.m.obj({}) as Schema<unknown>
    return isNullable(node) ? (empty.nullable() as Schema<unknown>) : empty
  }

  let built: Schema<unknown>
  switch (t) {
    case 'string': built = buildString(node, ctx); break
    case 'integer': built = buildNumber(node, ctx, true); break
    case 'number': built = buildNumber(node, ctx, false); break
    case 'boolean': built = ctx.m.bool() as Schema<unknown>; break
    case 'null': built = ctx.m.null_() as Schema<unknown>; break
    case 'array': built = buildArray(node, ctx); break
    case 'object': built = buildObject(node, ctx); break
    default:
      throw buildErr(ctx.pointer, `unsupported OpenAPI type: ${t}`)
  }
  return isNullable(node) ? (built.nullable() as Schema<unknown>) : built
}

/**
 * Translate an OpenAPI schema node into a `@databehave/schema` IR
 * Schema instance. Throws at translate time on unsupported keywords,
 * malformed `$ref`s, `$ref` cycles, ReDoS-vulnerable patterns, and
 * schemas that exceed the depth cap. See the file header for the
 * full keyword matrix and security guarantees.
 */
export async function translateOasToIR(
  node: OasSchemaNode,
  doc: OasDocument,
  m: SchemaBuilderApi,
): Promise<Schema<unknown>> {
  return translate(node, { doc, refStack: [], depth: 0, pointer: '#', m })
}
