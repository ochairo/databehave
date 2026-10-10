import { capability } from '@databehave/core'
import type { Method, MockRequest, RouteKey } from '@databehave/server'
import { matchPattern, parseRoutePattern } from '@databehave/server'
import type { OasDoc, OasNode } from './openapi/walker.js'

/** One declared numeric response; permissive or absent schemas have no generator. */
export interface OpenApiResponse {
  readonly status: number
  readonly schema?: OasNode
}

/** One parsed operation shared by routes, request conformance and status injection. */
export interface OpenApiOperation {
  readonly key: RouteKey
  readonly method: Method
  readonly path: string
  readonly sourcePath: string
  readonly definition: Readonly<Record<string, unknown>>
  readonly pathParameters: readonly unknown[]
  readonly responses: readonly OpenApiResponse[]
  /** Preferred success schema source: 200, then the smallest declared 2xx. */
  readonly successStatus: number
}

/** Per-request body generator prepared once for a declared operation and status. */
export type OpenApiBodyGenerator = (request: MockRequest) => unknown

/** Compilation input owned by the catalog; providers must not enumerate operations themselves. */
export interface OpenApiGenerationContext {
  readonly document: OasDoc
  readonly operation: OpenApiOperation
  readonly status: number
}

/** Replaceable response generation policy. Schema generation fails startup; placeholders allow stubs. */
export interface OpenApiGenerator {
  readonly failureMode: 'throw' | 'fallback'
  compile(schema: OasNode, context: OpenApiGenerationContext): OpenApiBodyGenerator | Promise<OpenApiBodyGenerator>
}

/** Parsed catalog and prepared generators, available after the preparation barrier. */
export interface OpenApiCatalog {
  readonly document: OasDoc
  readonly operations: readonly OpenApiOperation[]
  find(method: string, path: string): OpenApiOperation | undefined
  body(operation: OpenApiOperation, status: number, request: MockRequest): unknown
}

export const openapiCapability = capability<OpenApiCatalog>('databehave.openapi', 1)
export const openapiGeneratorCapability = capability<OpenApiGenerator>('databehave.openapi.generator', 1)

/** Diagnostics for fallback placeholder generation and permissive success schemas. */
export interface OpenApiDiagnostics {
  readonly onWalkError?: (method: Method, path: string, error: unknown) => void
  readonly onEmptySchema?: (method: Method, path: string, status: number) => void
}

const METHODS: readonly string[] = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options']
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasShape = (node: OasNode): boolean => Boolean(
  node.$ref || node.type || node.enum || node.const !== undefined || node.example !== undefined || node.examples || node.properties ||
  node.items || node.allOf || node.oneOf || node.anyOf,
)

/** Parse operation identities and status selection exactly once per document. */
export const readOperations = (document: OasDoc): readonly OpenApiOperation[] => {
  const operations: OpenApiOperation[] = []
  for (const [sourcePath, item] of Object.entries(document.paths ?? {})) {
    if (!isObject(item)) throw new Error(`OpenAPI path item must be an object: ${sourcePath}`)
    const path = sourcePath.split('/').map(segment => /^\{[^{}]+\}$/.test(segment) ? `:${segment.slice(1, -1)}` : segment).join('/')
    if (!path.startsWith('/')) throw new Error(`OpenAPI path must start with '/': ${path}`)
    parseRoutePattern(path)
    for (const [methodName, definition] of Object.entries(item)) {
      if (!METHODS.includes(methodName)) continue
      if (!isObject(definition)) throw new Error(`OpenAPI operation must be an object: ${methodName} ${path}`)
      const method = methodName as Method
      const responses: OpenApiResponse[] = []
      const rawResponses = definition.responses
      if (isObject(rawResponses)) {
        for (const [code, response] of Object.entries(rawResponses)) {
          if (!/^[1-5]\d\d$/.test(code)) continue
          const status = Number(code)
          const content = isObject(response) && isObject(response.content) ? response.content : undefined
          const media = content?.['application/json']
          const schema = isObject(media) && isObject(media.schema) ? media.schema as OasNode : undefined
          responses.push(Object.freeze({ status, ...(schema ? { schema } : {}) }))
        }
      }
      const successStatus = responses.map(r => r.status).filter(status => status >= 200 && status < 300).sort((a,b) => a-b)[0] ?? 200
      operations.push(Object.freeze({
        key: `${method.toUpperCase()} ${path}` as RouteKey, method, path, sourcePath,
        definition, pathParameters: Array.isArray(item.parameters) ? item.parameters : [],
        responses: Object.freeze(responses), successStatus,
      }))
    }
  }
  // HTTP resolves exact paths before parameterized paths; ties retain declaration order.
  return Object.freeze(operations.sort((a,b) => Number(!parseRoutePattern(a.path).isStatic) - Number(!parseRoutePattern(b.path).isStatic)))
}

/** Prepare one immutable catalog, compiling each operation/status only once. */
export const prepareCatalog = async (
  document: OasDoc,
  generator: OpenApiGenerator,
  diagnostics: OpenApiDiagnostics = {},
): Promise<OpenApiCatalog> => {
  const operations = readOperations(document)
  const patterns = new Map(operations.map(operation => [operation, parseRoutePattern(operation.path)]))
  const generators = new Map<OpenApiOperation, Map<number, OpenApiBodyGenerator>>()
  for (const operation of operations) {
    const responses = new Map<number, OpenApiBodyGenerator>()
    for (const { status, schema } of operation.responses) {
      if (!schema || status === 204 || status === 205 || status === 304) continue
      if (!hasShape(schema)) {
        if (status === operation.successStatus) diagnostics.onEmptySchema?.(operation.method, operation.path, status)
        if (generator.failureMode === 'fallback') continue
      }
      try {
        responses.set(status, await generator.compile(schema, { document, operation, status }))
      } catch (error) {
        if (generator.failureMode === 'throw') throw error
        diagnostics.onWalkError?.(operation.method, operation.path, error)
      }
    }
    generators.set(operation, responses)
  }
  return Object.freeze({
    document,
    operations,
    find(method: string, path: string) {
      return operations.find(operation => {
        const pattern = patterns.get(operation)
        return operation.method === method.toLowerCase() && pattern !== undefined && matchPattern(pattern, path) !== null
      })
    },
    body(operation: OpenApiOperation, status: number, request: MockRequest): unknown {
      return generators.get(operation)?.get(status)?.(request)
    },
  })
}
