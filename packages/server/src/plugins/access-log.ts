import type { Plugin } from '@databehave/core'
import { httpCapability, type HttpObservation } from '../http.js'
import { formatAccessLog, type LogFormatOptions } from '../log.js'

/** Access logging is opt-in; filtering and output belong to the caller. */
export interface AccessLogOptions extends LogFormatOptions {
  readonly filter?: (observation: HttpObservation) => boolean
  readonly write?: (line: string) => void
}

/** Observe each final request outcome once, including HEAD and transport termination. */
export const accessLogPlugin = (options: AccessLogOptions = {}): Plugin => ({
  id: 'databehave.http.access-log', apiVersion: 1, requires: [httpCapability],
  setup(ctx) {
    ctx.use(httpCapability).registerMiddleware({
      owner: 'databehave.http.access-log', order: ctx.order, stage: 'observation',
      handle(observation) {
        if (options.filter && !options.filter(observation)) return
        const { request, outcome, durationMs, error } = observation
        const status = outcome.kind === 'response' ? outcome.response.status : 'terminated'
        const line = formatAccessLog({
          method: request.method.toUpperCase(), path: request.path, status, ms: Math.round(durationMs),
          bytes: outcome.kind === 'response' ? outcome.response.headers.get('content-length') ?? '-' : '-',
          ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }),
        }, options)
        if (options.write) options.write(line)
        else process.stdout.write(line)
      },
    })
  },
})
