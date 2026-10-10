import type { Plugin } from '@databehave/core'
import { httpCapability } from '@databehave/server'
import { openapiCapability } from './catalog.js'
import { createRequestValidationContext, validateRequest } from './middleware/request-validation.js'
import type { RequestValidationContext } from './middleware/request-validation.js'

/** Request-conformance policy, independent from the selected response generator. */
export interface RequestValidationOptions {
  /** UTF-8 byte limit for declared bodies; nonnegative safe integer. Default 102400; zero allows no bytes. */
  readonly maxBodyBytes?: number
}

export const requestValidationPlugin = (options: RequestValidationOptions = {}): Plugin => {
  let validation: RequestValidationContext | undefined
  return {
    id: 'databehave.openapi.request-validation', apiVersion: 1,
    requires: [httpCapability, openapiCapability],
    setup(ctx) {
      ctx.use(httpCapability).registerMiddleware({
        owner: 'databehave.openapi.request-validation', order: ctx.order, stage: 'validation',
        async handle(request) {
          if (!validation) throw new Error('Request validation is unavailable before preparation')
          const result = await validateRequest(request.raw(), validation, request.effectiveMethod)
          if (result) return { status: result.status, text: await result.text(), headers: Object.fromEntries(result.headers) }
        },
      })
    },
    prepare(ctx) { validation = createRequestValidationContext(ctx.use(openapiCapability), options) },
  }
}
