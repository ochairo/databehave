/**
 * Auto-schema dispatch wiring (Phase 2C / brief item #11).
 *
 * When the JSONC config sets a top-level `schema:` field, this module:
 *
 *   1. Resolves the optional peer `@databehave/schema` via a single
 *      `await import('@databehave/schema')` (string literal — never a
 *      variable, never a helper). On `ERR_MODULE_NOT_FOUND` / similar
 *      "Cannot find module" errors, the native error is suppressed
 *      and replaced with the friendly multi-line install-hint
 *      template (see `INSTALL_HINT`). Throws fail-fast at server
 *      creation; never lazily on first request.
 *   2. Pre-translates every OAS path/method (whose 200 / first 2xx
 *      response carries a JSON schema) into a `@databehave/schema`
 *      IR node via `translateOasToIR`. Translation errors throw at
 *      server-creation time so OAS gaps surface fail-loud — same
 *      philosophy as the validator and the OAS-only generator.
 *   3. Synthesizes a per-route handler closing over the cached
 *      schema module + IR. At request time the handler derives a
 *      seed (per `config.schema.seed`), invokes `mock(ir, { seed })`,
 *      and returns `{ json: ... }`.
 *
 * Hand-written `endpoints` always win — auto-mode only fills routes
 * absent from the user's `endpoints` map. Genuine-separation
 * invariant: this file MUST NOT statically value-import
 * `@databehave/schema`. Type-only imports are erased at compile time
 * and are fine.
 */
import type { Handler, Method, MockRequest, RouteKey } from '../types.js'

import { translateOasToIR } from './translate.js'
import type { OasDoc, OasNode } from './walker.js'

/** Fully-resolved schema-mode config (after JSONC validation). */
export interface ResolvedSchemaConfig {
  readonly seed: number | 'stable' | 'random'
  readonly locale?: string
  readonly arrayCount?: number
}

/** Single-shot guard for the `schema.locale` no-op soft warn. */
let localeWarned = false

/** Knobs accepted on the `schema:` JSONC object (alongside `enabled`). */
const KNOWN_SCHEMA_KEYS: ReadonlySet<string> = new Set([
  'enabled',
  'seed',
  'locale',
  'arrayCount',
])

/**
 * Friendly install-hint emitted when `config.schema.enabled === true`
 * but the `@databehave/schema` peer is not installed. Verbatim from
 * the brief — names the package, the field, the file, all three
 * install commands, the README anchor, and the opt-out instruction.
 */
export const INSTALL_HINT =
  '[@databehave/server] Auto-schema mode is enabled in databehave.jsonc\n' +
  '("schema": { "enabled": true } is set), but the data-generation engine is not installed.\n' +
  '\n' +
  '  npm i @databehave/schema\n' +
  '  # or: pnpm add @databehave/schema\n' +
  '  # or: yarn add @databehave/schema\n' +
  '\n' +
  'This enables realistic, seeded mock data derived from your OpenAPI\n' +
  'document. See: https://github.com/ochairo/databehave/blob/main/packages/server/docs/openapi/auto-schema.md#missing-install-error\n' +
  '\n' +
  'To keep the default zero-dep placeholder mode instead, set\n' +
  '"schema": { "enabled": false } or remove the "schema" field from databehave.jsonc.'

/**
 * Validate the raw JSONC `schema:` value and normalise to the
 * resolved shape. The value MUST be an object with an explicit
 * `enabled: boolean`. The boolean shorthand (`schema: true` /
 * `schema: false`) was removed — callers receive a migration
 * error pointing at the new shape. Returns `null` when
 * `enabled === false` so the caller can short-circuit auto-mode.
 * Unknown keys throw with a message pointing at the offending key.
 */
export const normaliseSchemaConfig = (raw: unknown): ResolvedSchemaConfig | null => {
  if (typeof raw === 'boolean') {
    throw new Error(
      '@databehave/server/config: "schema" must be an object like ' +
        '{ "enabled": true }; the boolean shorthand was removed (got ' +
        JSON.stringify(raw) +
        ')',
    )
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      '@databehave/server/config: "schema" must be an object like ' +
        '{ "enabled": true } (got ' +
        (raw === null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw) +
        ')',
    )
  }
  const obj = raw as Record<string, unknown>
  for (const k of Object.keys(obj)) {
    if (!KNOWN_SCHEMA_KEYS.has(k)) {
      throw new Error(
        `@databehave/server/config: unknown key in "schema": ${JSON.stringify(k)} ` +
          `(valid keys: ${[...KNOWN_SCHEMA_KEYS].join(', ')})`,
      )
    }
  }
  if (typeof obj.enabled !== 'boolean') {
    throw new Error(
      '@databehave/server/config: "schema.enabled" must be a boolean ' +
        `(got ${obj.enabled === undefined ? 'undefined' : JSON.stringify(obj.enabled)})`,
    )
  }
  if (obj.enabled === false) return null
  let seed: ResolvedSchemaConfig['seed'] = 'stable'
  if (obj.seed !== undefined) {
    if (
      typeof obj.seed === 'number' ||
      obj.seed === 'stable' ||
      obj.seed === 'random'
    ) {
      seed = obj.seed
    } else {
      throw new Error(
        '@databehave/server/config: "schema.seed" must be a number, "stable", or "random" ' +
          `(got ${JSON.stringify(obj.seed)})`,
      )
    }
  }
  const out: { -readonly [K in keyof ResolvedSchemaConfig]: ResolvedSchemaConfig[K] } = { seed }
  if (obj.locale !== undefined) {
    if (typeof obj.locale !== 'string') {
      throw new Error('@databehave/server/config: "schema.locale" must be a string')
    }
    out.locale = obj.locale
    if (!localeWarned) { localeWarned = true; console.warn(`[@databehave/server] schema.locale (${JSON.stringify(obj.locale)}) is currently parsed but not consumed by the data-generation engine; the value will be ignored.`) }
  }
  if (obj.arrayCount !== undefined) {
    if (typeof obj.arrayCount !== 'number' || !Number.isFinite(obj.arrayCount) || obj.arrayCount < 0) {
      throw new Error('@databehave/server/config: "schema.arrayCount" must be a non-negative number')
    }
    out.arrayCount = obj.arrayCount
  }
  return out
}

/**
 * Load the optional peer `@databehave/schema` package. On
 * "Cannot find module" failures the native Node error is suppressed
 * and replaced with the friendly install hint above. Other errors
 * (e.g. broken install) re-throw verbatim — those are real bugs.
 */
export const loadSchemaModule = async (): Promise<typeof import('@databehave/schema')> => {
  try {
    return await import('@databehave/schema')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const code = (err as NodeJS.ErrnoException | undefined)?.code
    if (
      code === 'ERR_MODULE_NOT_FOUND' ||
      code === 'MODULE_NOT_FOUND' ||
      msg.includes('Cannot find module') ||
      msg.includes('Cannot find package')
    ) {
      // Suppress the native error — users see only the friendly
      // template. Wrapping `cause: err` would re-leak the native
      // text into Node's default stack-printer; intentionally drop it.
      throw new Error(INSTALL_HINT)
    }
    throw err
  }
}

const SUPPORTED_METHODS: ReadonlySet<Method> = new Set<Method>([
  'get',
  'post',
  'put',
  'delete',
  'patch',
])

/** Convert OAS `/users/{id}` → `/users/:id`. */
const oasPathToInternal = (oasPath: string): string =>
  oasPath
    .split('/')
    .map((seg) => (seg.startsWith('{') && seg.endsWith('}') ? `:${seg.slice(1, -1)}` : seg))
    .join('/')

/**
 * FNV-1a 32-bit hash. Tiny, zero-dep, stable across machines —
 * exactly what the per-request `seed: 'stable'` derivation needs.
 *
 * Input format: `${METHOD} ${endpointPath}|${sortedQuery}|${sortedPathParams}`,
 * where sorted means lex-sorted keys joined by `&` as `key=value`.
 *
 * Example input  → output (uint32):
 *   `GET /users/:id|page=2|id=42` → 0x9b1ed8c5
 */
export const hashSeed = (input: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h >>> 0
}

const sortedJoin = (record: Readonly<Record<string, string>>): string =>
  Object.keys(record)
    .sort()
    .map((k) => `${k}=${record[k]}`)
    .join('&')

const deriveSeed = (
  cfg: ResolvedSchemaConfig,
  method: string,
  endpointPath: string,
  req: MockRequest,
): number => {
  if (typeof cfg.seed === 'number') return cfg.seed >>> 0
  if (cfg.seed === 'random') {
    return (Math.random() * 0xffffffff) >>> 0
  }
  // 'stable': hash of `${METHOD} ${endpointPath}|${sortedQuery}|${sortedParams}`
  const key = `${method} ${endpointPath}|${sortedJoin(req.query)}|${sortedJoin(req.params)}`
  return hashSeed(key)
}

/**
 * Find the response schema node that the OAS-only generator would
 * pick: prefer 200, then the smallest declared 2xx, mirroring
 * `register.ts`. 204 → no body (signal via `null`).
 */
const pickResponseSchema = (
  responses: Record<string, unknown>,
): { schema: OasNode; status: number } | null | 'no-body' => {
  const twoXx = Object.keys(responses)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n >= 200 && n < 300)
    .sort((a, b) => (a === 200 ? -1 : b === 200 ? 1 : a - b))
  const status = twoXx[0]
  if (status === undefined) return null
  if (status === 204) return 'no-body'
  const schema = (
    responses[String(status)] as
      | { content?: { 'application/json'?: { schema?: OasNode } } }
      | undefined
  )?.content?.['application/json']?.schema
  if (!schema || typeof schema !== 'object') return null
  return { schema, status }
}

/**
 * Build a route-key → handler map for every OAS path/method whose
 * response carries a usable JSON schema and is NOT already covered
 * by hand-written `endpoints`. Each handler is closed over the
 * cached schema module and pre-translated IR.
 *
 * `declaredKeys` is the set of route keys the user already declared
 * via `endpoints`; auto-mode skips those so hand-written routes
 * always win.
 */
export const buildAutoSchemaRoutes = async (
  doc: OasDoc,
  cfg: ResolvedSchemaConfig,
  schemaModule: typeof import('@databehave/schema'),
  declaredKeys: ReadonlySet<RouteKey>,
): Promise<Map<RouteKey, Handler>> => {
  const out = new Map<RouteKey, Handler>()
  const paths = (doc as { paths?: Record<string, Record<string, unknown>> }).paths
  if (!paths) return out

  for (const [oasPath, methods] of Object.entries(paths)) {
    if (oasPath === '/') continue
    const kitPath = oasPathToInternal(oasPath)
    for (const [methodName, op] of Object.entries(methods)) {
      const method = methodName.toLowerCase() as Method
      if (!SUPPORTED_METHODS.has(method)) continue
      const key = `${method.toUpperCase()} ${kitPath}` as RouteKey
      if (declaredKeys.has(key)) continue
      const responses = (op as { responses?: Record<string, unknown> }).responses
      if (!responses) continue
      const picked = pickResponseSchema(responses)
      if (picked === null || picked === 'no-body') continue
      // Translation throws at server-creation on unsupported keywords —
      // FAIL LOUD, never silently fall through to the placeholder
      // generator (the user opted in to auto-schema; downgrading
      // would produce confusing mixed output).
      const ir = await translateOasToIR(picked.schema, doc)
      const upperMethod = method.toUpperCase()
      const handler: Handler = (req) => {
        const seed = deriveSeed(cfg, upperMethod, kitPath, req)
        const value = schemaModule.mock(ir, { seed })
        return { json: value }
      }
      out.set(key, handler)
    }
  }
  return out
}
