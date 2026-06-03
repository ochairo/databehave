/**
 * OpenAPI structural types consumed by the in-server mock generator.
 *
 * Kept as a types-only module so the actual generation logic lives
 * in a single place (`./generate.ts`) and consumers — including the
 * route registrar (`./register.ts`) — can refer to a stable shape
 * without pulling the generator in just for its types.
 *
 * Only the fields the generator and registrar actually read are
 * declared. Unknown OAS keywords pass through as structural casts
 * inside `register.ts` and are surfaced as walk errors when the
 * generator hits them.
 */

export type OasNode = {
  $ref?: string
  type?: string | string[]
  format?: string
  enum?: unknown[]
  const?: unknown
  example?: unknown
  examples?: unknown[]
  properties?: Record<string, OasNode>
  required?: string[]
  items?: OasNode
  additionalProperties?: boolean | OasNode
  nullable?: boolean
  allOf?: OasNode[]
  oneOf?: OasNode[]
  anyOf?: OasNode[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  pattern?: string
  title?: string
}

export type OasDoc = {
  components?: { schemas?: Record<string, OasNode> }
}
