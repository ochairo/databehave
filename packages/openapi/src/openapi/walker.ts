/** Supported OpenAPI schema keywords; extension keywords remain available to conformance validation. */
export type OasNode = {
  [keyword: string]: unknown
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

/** Parsed document shared by all OpenAPI plugins. */
export type OasDoc = {
  [key: string]: unknown
  paths?: Record<string, Record<string, unknown>>
  components?: { schemas?: Record<string, OasNode>; [key: string]: unknown }
}
