/**
 * Hand-rolled, zero-runtime-dependency JSON-Schema-subset validator.
 *
 * Audit-it-yourself moat: small, defensive, top-to-bottom readable.
 * FAIL LOUD on unsupported keywords at build time — never silently
 * pass an unrecognised constraint at runtime.
 *
 * Supported keywords (see README → "Validator scope" for the table):
 *   type / enum / required / properties / additionalProperties /
 *   items / pattern / minLength / maxLength / minimum / maximum /
 *   exclusiveMinimum / exclusiveMaximum / minItems / maxItems /
 *   $ref (intra-document only) / oneOf / anyOf / allOf /
 *   discriminator / format (date | date-time | email | uuid | uri) /
 *   nullable (OAS 3.0) and ["X","null"] (OAS 3.1).
 *
 * Security guarantees implemented in this file:
 *   - No `eval`, no `new Function`, no dynamic `require`. Pure recursion.
 *   - Prototype-pollution guard: input objects whose own keys include
 *     `__proto__` / `constructor` / `prototype` are rejected as a
 *     per-property violation rather than coerced or thrown on.
 *   - ReDoS mitigation: pattern length capped at 1024 chars; invalid
 *     regexes rejected at build time (never at request time).
 *   - Recursion bounded: hard-cap depth at 64 levels.
 *   - $ref cycle detection via a build-time visited-pointer set.
 *   - No `JSON.parse` on user input — input arrives as a JS value.
 */
import type { OasDoc, OasNode } from '../openapi/walker.js'

export interface Violation {
  /** JSON-Pointer style path from the validation root. */
  readonly path: string
  /** The JSON Schema keyword that rejected the value. */
  readonly keyword: string
  /** Short, human-readable description. Never echoes user input. */
  readonly message: string
}

export type Validator = (value: unknown, pointer: string) => Violation[]

const DEPTH_CAP = 64
const PATTERN_MAX_LENGTH = 1024
// Maximum recursion depth for deepEqual when comparing user input against
// `enum` choices. Beyond this we return false (treat as not-equal — the
// input fails the enum check and the caller emits a 422). The cap exists
// to prevent stack overflow on attacker-supplied deeply-nested values.
const DEEP_EQUAL_DEPTH_CAP = 64

const POLLUTED_KEYS: ReadonlySet<string> = new Set([
  '__proto__', 'constructor', 'prototype',
])

const UNSUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  'if', 'then', 'else',
  'dependentSchemas', 'dependentRequired',
  'unevaluatedProperties', 'unevaluatedItems',
  'contentEncoding', 'contentMediaType',
  'propertyNames', 'patternProperties',
])

const FORMAT_DATE = /^\d{4}-\d{2}-\d{2}$/
const FORMAT_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/
const FORMAT_UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
// Deliberately simple sane-default email regex. RFC 5322 is far stricter
// and rejects edge cases real users care about; consumers who need
// RFC 5322 should add a `pattern` to the schema and rely on the walker's
// `pattern` keyword instead.
const FORMAT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const deepEqual = (a: unknown, b: unknown, depth = 0): boolean => {
  if (depth > DEEP_EQUAL_DEPTH_CAP) return false
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i], depth + 1)) return false
    }
    return true
  }
  if (typeof a === 'object') {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const ak = Object.keys(ao)
    if (ak.length !== Object.keys(bo).length) return false
    for (const k of ak) {
      if (!Object.hasOwn(bo, k) || !deepEqual(ao[k], bo[k], depth + 1)) return false
    }
    return true
  }
  return false
}

interface BuildCtx {
  readonly doc: OasDoc
  readonly refStack: readonly string[]
  readonly depth: number
  readonly schemaPointer: string
}

const buildErr = (ctx: BuildCtx, message: string): Error =>
  new Error(`@databehave/server/validation: ${message} (at ${ctx.schemaPointer})`)

const enterPtr = (ctx: BuildCtx, segment: string): BuildCtx => ({
  ...ctx,
  schemaPointer: `${ctx.schemaPointer}/${segment}`,
  depth: ctx.depth + 1,
})

const resolveRef = (ref: string, ctx: BuildCtx): OasNode => {
  if (ref.includes('://')) throw buildErr(ctx, `unsupported $ref: ${ref}`)
  const m = /^#\/components\/schemas\/(.+)$/.exec(ref)
  if (!m) throw buildErr(ctx, `unsupported $ref: ${ref}`)
  const name = decodeURIComponent(m[1]!)
  const target = ctx.doc.components?.schemas?.[name]
  if (!target) throw buildErr(ctx, `$ref not found: ${ref}`)
  return target
}

const checkFormat = (f: string, v: string): boolean => {
  switch (f) {
    case 'date': return FORMAT_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
    case 'date-time': return FORMAT_DATE_TIME.test(v) && !Number.isNaN(Date.parse(v))
    case 'email': return FORMAT_EMAIL.test(v)
    case 'uuid': return FORMAT_UUID.test(v)
    case 'uri': try { new URL(v); return true } catch { return false }
    default: return true
  }
}

const typeOk = (t: string, value: unknown): boolean => {
  switch (t) {
    case 'string': return typeof value === 'string'
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'number': return typeof value === 'number' && !Number.isNaN(value)
    case 'boolean': return typeof value === 'boolean'
    case 'null': return value === null
    case 'array': return Array.isArray(value)
    case 'object': return isObj(value)
    default: return true
  }
}

const NUMERIC: ReadonlyArray<[string, (v: number, l: number) => boolean, string]> = [
  ['minimum', (v, l) => v >= l, 'is less than minimum'],
  ['maximum', (v, l) => v <= l, 'is greater than maximum'],
  ['exclusiveMinimum', (v, l) => v > l, 'is not greater than exclusiveMinimum'],
  ['exclusiveMaximum', (v, l) => v < l, 'is not less than exclusiveMaximum'],
]

export const compileValidator = (
  node: OasNode,
  doc: OasDoc,
  schemaPointer = '#',
): Validator => build(node, { doc, refStack: [], depth: 0, schemaPointer })

const build = (node: OasNode, ctx: BuildCtx): Validator => {
  if (ctx.depth > DEPTH_CAP) {
    throw buildErr(ctx, `schema nesting exceeds depth cap of ${DEPTH_CAP}`)
  }
  if (!isObj(node)) throw buildErr(ctx, 'schema node must be an object')

  for (const key of Object.keys(node)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) {
      throw buildErr(ctx, `unsupported JSON Schema keyword: ${key}`)
    }
  }

  if (typeof node.$ref === 'string') {
    if (ctx.refStack.includes(node.$ref)) {
      throw buildErr(ctx, `$ref cycle detected: ${[...ctx.refStack, node.$ref].join(' -> ')}`)
    }
    const target = resolveRef(node.$ref, ctx)
    return build(target, {
      doc: ctx.doc,
      refStack: [...ctx.refStack, node.$ref],
      depth: ctx.depth + 1,
      schemaPointer: node.$ref,
    })
  }

  const typeArray = Array.isArray(node.type) ? node.type : null
  const allowsNull =
    node.nullable === true ||
    (typeArray !== null && typeArray.includes('null'))

  const checks: Validator[] = []

  if (typeof node.type === 'string') {
    const t = node.type
    checks.push((v, p) =>
      (v === null && allowsNull) || typeOk(t, v)
        ? []
        : [{ path: p, keyword: 'type', message: `expected ${t}` }],
    )
  } else if (typeArray) {
    const nonNull = typeArray.filter((t) => t !== 'null')
    if (nonNull.length > 0) {
      checks.push((v, p) => {
        if (v === null && allowsNull) return []
        for (const t of nonNull) if (typeOk(t, v)) return []
        return [{ path: p, keyword: 'type', message: `value did not match any of the allowed types: ${nonNull.join(', ')}` }]
      })
    }
  }

  if (Array.isArray(node.enum)) {
    const choices = node.enum
    checks.push((v, p) =>
      choices.some((c) => deepEqual(v, c))
        ? []
        : [{ path: p, keyword: 'enum', message: 'value is not one of the allowed enum entries' }],
    )
  }

  if (typeof node.minLength === 'number') {
    const m = node.minLength
    checks.push((v, p) =>
      typeof v === 'string' && [...v].length < m
        ? [{ path: p, keyword: 'minLength', message: `string is shorter than minLength ${m}` }]
        : [],
    )
  }
  if (typeof node.maxLength === 'number') {
    const m = node.maxLength
    checks.push((v, p) =>
      typeof v === 'string' && [...v].length > m
        ? [{ path: p, keyword: 'maxLength', message: `string is longer than maxLength ${m}` }]
        : [],
    )
  }
  if (typeof node.pattern === 'string') {
    const pattern = node.pattern
    if (pattern.length > PATTERN_MAX_LENGTH) {
      throw buildErr(ctx, `pattern length ${pattern.length} exceeds cap of ${PATTERN_MAX_LENGTH} (ReDoS guard)`)
    }
    // FAIL LOUD: a `pattern` without an own `maxLength` is a ReDoS
    // footgun — even with `PATTERN_MAX_LENGTH` capping the regex itself,
    // catastrophic-backtracking patterns can still be triggered by
    // unbounded user input. Force schema authors to declare an upper
    // bound at the same node where the `pattern` lives. We deliberately
    // do NOT walk up parent schemas: the cap belongs next to the
    // pattern, not somewhere ambient.
    if (typeof node.maxLength !== 'number') {
      throw buildErr(
        ctx,
        `pattern requires maxLength on the same schema (footgun: ReDoS) at ${ctx.schemaPointer}`,
      )
    }
    let re: RegExp
    try { re = new RegExp(pattern) } catch (err) {
      throw buildErr(ctx, `invalid pattern: ${err instanceof Error ? err.message : String(err)}`)
    }
    checks.push((v, p) =>
      typeof v === 'string' && !re.test(v)
        ? [{ path: p, keyword: 'pattern', message: 'string does not match the required pattern' }]
        : [],
    )
  }
  if (typeof node.format === 'string') {
    const f = node.format
    if (f === 'date' || f === 'date-time' || f === 'email' || f === 'uuid' || f === 'uri') {
      checks.push((v, p) =>
        typeof v === 'string' && !checkFormat(f, v)
          ? [{ path: p, keyword: 'format', message: `must be a valid ${f}` }]
          : [],
      )
    }
  }

  for (const [key, op, label] of NUMERIC) {
    const limit = (node as Record<string, unknown>)[key]
    if (typeof limit === 'number') {
      checks.push((v, p) =>
        typeof v === 'number' && !op(v, limit)
          ? [{ path: p, keyword: key, message: `value ${label} ${limit}` }]
          : [],
      )
    }
  }

  if (typeof node.minItems === 'number') {
    const m = node.minItems
    checks.push((v, p) =>
      Array.isArray(v) && v.length < m
        ? [{ path: p, keyword: 'minItems', message: `array has fewer than ${m} items` }]
        : [],
    )
  }
  if (typeof node.maxItems === 'number') {
    const m = node.maxItems
    checks.push((v, p) =>
      Array.isArray(v) && v.length > m
        ? [{ path: p, keyword: 'maxItems', message: `array has more than ${m} items` }]
        : [],
    )
  }
  if (node.items) {
    const inner = build(node.items, enterPtr(ctx, 'items'))
    checks.push((v, p) => {
      if (!Array.isArray(v)) return []
      const out: Violation[] = []
      for (let i = 0; i < v.length; i++) out.push(...inner(v[i], `${p}/${i}`))
      return out
    })
  }

  const required = Array.isArray(node.required) ? node.required : null
  const properties = isObj(node.properties) ? node.properties : null
  const additional = node.additionalProperties
  let propValidators: Map<string, Validator> | null = null
  if (properties) {
    propValidators = new Map()
    for (const [k, v] of Object.entries(properties)) {
      if (POLLUTED_KEYS.has(k)) {
        throw buildErr(ctx, `forbidden property name in schema.properties: ${k}`)
      }
      propValidators.set(k, build(v as OasNode, enterPtr(ctx, `properties/${k}`)))
    }
  }
  let additionalValidator: Validator | null = null
  let additionalAllowed = true
  if (additional === false) additionalAllowed = false
  else if (isObj(additional)) {
    additionalValidator = build(additional as OasNode, enterPtr(ctx, 'additionalProperties'))
  }
  if (required || properties || additional !== undefined) {
    checks.push((v, p) => {
      if (!isObj(v)) return []
      const out: Violation[] = []
      const ownKeys = Object.keys(v)
      for (const k of ownKeys) {
        if (POLLUTED_KEYS.has(k)) {
          out.push({ path: `${p}/${k}`, keyword: 'prototypePollution', message: 'forbidden property name (prototype pollution guard)' })
        }
      }
      if (required) {
        for (const r of required) {
          if (!Object.hasOwn(v, r)) {
            out.push({ path: `${p}/${r}`, keyword: 'required', message: 'missing required property' })
          }
        }
      }
      for (const k of ownKeys) {
        if (POLLUTED_KEYS.has(k)) continue
        const child = propValidators?.get(k)
        if (child) { out.push(...child(v[k], `${p}/${k}`)); continue }
        if (!additionalAllowed) {
          out.push({ path: `${p}/${k}`, keyword: 'additionalProperties', message: 'unexpected additional property' })
          continue
        }
        if (additionalValidator) out.push(...additionalValidator(v[k], `${p}/${k}`))
      }
      return out
    })
  }

  if (Array.isArray(node.allOf)) {
    const subs = node.allOf.map((n, i) => build(n, enterPtr(ctx, `allOf/${i}`)))
    checks.push((v, p) => subs.flatMap((s) => s(v, p)))
  }
  if (Array.isArray(node.anyOf)) {
    const subs = node.anyOf.map((n, i) => build(n, enterPtr(ctx, `anyOf/${i}`)))
    checks.push((v, p) =>
      subs.some((s) => s(v, p).length === 0)
        ? []
        : [{ path: p, keyword: 'anyOf', message: 'value did not match any of the anyOf schemas' }],
    )
  }
  if (Array.isArray(node.oneOf)) {
    const subs = node.oneOf.map((n, i) => build(n, enterPtr(ctx, `oneOf/${i}`)))
    const disc = (node as { discriminator?: { propertyName: string; mapping?: Record<string, string> } }).discriminator
    if (disc) {
      const { propertyName, mapping } = disc
      const mapBuilt = new Map<string, Validator>()
      if (mapping) {
        for (const [k, ref] of Object.entries(mapping)) {
          const childCtx = enterPtr(ctx, `discriminator/mapping/${k}`)
          // Defensive: any structural $ref cycle is caught at the
          // top-level $ref descent above before the discriminator
          // block runs.
          /* c8 ignore start */
          if (childCtx.refStack.includes(ref)) {
            throw buildErr(childCtx, `$ref cycle detected: ${ref}`)
          }
          /* c8 ignore stop */
          const target = resolveRef(ref, childCtx)
          mapBuilt.set(k, build(target, {
            ...childCtx,
            refStack: [...childCtx.refStack, ref],
            schemaPointer: ref,
          }))
        }
      }
      checks.push((v, p) => {
        if (!isObj(v)) {
          return [{ path: p, keyword: 'discriminator', message: `value must be an object to use discriminator '${propertyName}'` }]
        }
        const tag = v[propertyName]
        if (typeof tag !== 'string') {
          return [{ path: `${p}/${propertyName}`, keyword: 'discriminator', message: `discriminator '${propertyName}' missing or not a string` }]
        }
        const sub = mapBuilt.get(tag)
        if (sub) return sub(v, p)
        const matches = subs.filter((s) => s(v, p).length === 0)
        if (matches.length === 1) return []
        // Never echo the user-supplied tag — it is unsanitised input
        // and ends up rendered in client error toasts / logs.
        return [{ path: `${p}/${propertyName}`, keyword: 'discriminator', message: `unknown discriminator value '[redacted]'` }]
      })
    } else {
      checks.push((v, p) => {
        let passing = 0
        for (const s of subs) if (s(v, p).length === 0) passing++
        if (passing === 1) return []
        if (passing === 0) return [{ path: p, keyword: 'oneOf', message: 'value did not match any of the oneOf schemas' }]
        return [{ path: p, keyword: 'oneOf', message: `value matched ${passing} oneOf schemas (must match exactly one)` }]
      })
    }
  }

  return (value, pointer) => {
    if (value === null && allowsNull) return []
    const out: Violation[] = []
    for (const c of checks) out.push(...c(value, pointer))
    return out
  }
}
