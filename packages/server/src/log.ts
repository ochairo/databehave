/** One access event, already reduced to fields intended for logging. */
export interface LogEvent {
  readonly method: string
  readonly path: string
  readonly status: number | 'terminated'
  readonly ms: number
  readonly bytes: string
  readonly error?: string
}

/** Access formatter configuration, independent of request filtering and output. */
export interface LogFormatOptions {
  readonly format?: 'pretty' | 'json'
  readonly colors?: 'auto' | 'always' | 'never'
}

const RESET = '\x1b[0m'
const METHOD_COLOR: Readonly<Record<string, string>> = {
  GET: '\x1b[32m', POST: '\x1b[34m', PUT: '\x1b[33m', DELETE: '\x1b[31m', PATCH: '\x1b[36m',
}
const statusColor = (status: LogEvent['status']): string => {
  if (status === 'terminated' || status >= 500) return '\x1b[31m'
  if (status >= 400) return '\x1b[33m'
  if (status >= 300) return '\x1b[36m'
  if (status >= 200) return '\x1b[32m'
  return '\x1b[90m'
}

/** Format one newline-terminated event without reading or consuming a response body. */
export const formatAccessLog = (event: LogEvent, options: LogFormatOptions): string => {
  if (options.format === 'json') return `${JSON.stringify({ t: new Date().toISOString(), ...event })}\n`
  const colors = options.colors === 'always' || (options.colors !== 'never' && Boolean(process.stdout.isTTY))
  const paint = (color: string, value: string): string => colors ? `${color}${value}${RESET}` : value
  const method = paint(METHOD_COLOR[event.method] ?? '\x1b[90m', event.method)
  const status = paint(statusColor(event.status), String(event.status))
  const error = event.error === undefined ? '' : ` error=${event.error.replace(/[\r\n]/g, ' ')}`
  return `${method} ${event.path} → ${status} ${event.ms} ms · ${event.bytes}${error}\n`
}
