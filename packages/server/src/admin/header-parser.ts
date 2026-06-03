/**
 * Parse `x-mock-*` request headers into an `ErrorMode` (or surface a
 * conflict error). One header set ↔ one ErrorMode. Multiple terminal
 * modes (e.g. both `x-mock-status` and `x-mock-business-failure`) are
 * rejected with `kind: 'conflict'` so the caller can return 400.
 *
 * Base64 inputs (`x-mock-body`, `x-mock-business-failure-extra`) use
 * standard base64 (NOT url-safe), per the README contract.
 */
import { Buffer } from 'node:buffer'

import type { ErrorMode } from './admin-types.js'

export type HeaderParseResult =
  | { kind: 'none' }
  | { kind: 'mode'; mode: ErrorMode }
  | { kind: 'error'; message: string }

// Note: `x-mock-business-failure-b64` is an alternative to
// `x-mock-business-failure` that accepts a base64-UTF8 message so
// non-ASCII strings can travel through an HTTP header — Node's fetch
// rejects non-ASCII byte values in header values.
const TERMINAL_HEADERS = [
  'x-mock-status',
  'x-mock-business-failure',
  'x-mock-business-failure-b64',
  'x-mock-body',
  'x-mock-empty',
  'x-mock-malformed',
  'x-mock-hang',
  'x-mock-destroy',
] as const

const get = (
  h: Readonly<Record<string, string>>,
  name: string
): string | undefined => h[name]

const decodeBase64Json = (raw: string, headerName: string): unknown => {
  let decoded: string
  try {
    decoded = Buffer.from(raw, 'base64').toString('utf8')
  } catch (err) {
    throw new Error(
      `invalid ${headerName} header: base64 decode failed (${
        err instanceof Error ? err.message : String(err)
      })`
    )
  }
  try {
    return JSON.parse(decoded)
  } catch (err) {
    throw new Error(
      `invalid ${headerName} header: JSON parse failed (${
        err instanceof Error ? err.message : String(err)
      })`
    )
  }
}

const parseIntStrict = (raw: string, headerName: string): number => {
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) {
    throw new Error(
      `invalid ${headerName} header: not an integer (${JSON.stringify(raw)})`
    )
  }
  return n
}

const parseTerminal = (
  h: Readonly<Record<string, string>>
): ErrorMode | null => {
  const present = TERMINAL_HEADERS.filter((name) => get(h, name) !== undefined)
  if (present.length === 0) return null
  if (present.length > 1) {
    throw new Error(
      `conflicting x-mock-* headers: ${present.join(
        ', '
      )} — pick exactly one terminal mode`
    )
  }
  const [only] = present
  switch (only) {
    case 'x-mock-status': {
      const status = parseIntStrict(get(h, 'x-mock-status')!, 'x-mock-status')
      return { kind: 'http-status', status }
    }
    case 'x-mock-business-failure':
    case 'x-mock-business-failure-b64': {
      let message: string
      if (only === 'x-mock-business-failure-b64') {
        const raw = get(h, 'x-mock-business-failure-b64')!
        try {
          message = Buffer.from(raw, 'base64').toString('utf8')
        } catch (err) {
          throw new Error(
            `invalid x-mock-business-failure-b64 header: base64 decode failed (${
              err instanceof Error ? err.message : String(err)
            })`
          )
        }
      } else {
        message = get(h, 'x-mock-business-failure')!
      }
      const extraRaw = get(h, 'x-mock-business-failure-extra')
      if (extraRaw === undefined) return { kind: 'business-failure', message }
      const extra = decodeBase64Json(extraRaw, 'x-mock-business-failure-extra')
      if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) {
        throw new Error(
          'invalid x-mock-business-failure-extra header: decoded value must be a JSON object'
        )
      }
      return {
        kind: 'business-failure',
        message,
        extra: extra as Record<string, unknown>,
      }
    }
    case 'x-mock-body': {
      const body = decodeBase64Json(get(h, 'x-mock-body')!, 'x-mock-body')
      const statusRaw = get(h, 'x-mock-body-status')
      const contentType = get(h, 'x-mock-body-content-type')
      const mode: ErrorMode = { kind: 'custom-body', body }
      if (statusRaw !== undefined) {
        ;(mode as { status?: number }).status = parseIntStrict(
          statusRaw,
          'x-mock-body-status'
        )
      }
      if (contentType !== undefined) {
        ;(mode as { contentType?: string }).contentType = contentType
      }
      return mode
    }
    case 'x-mock-empty': {
      const statusRaw = get(h, 'x-mock-empty-status')
      if (statusRaw === undefined) return { kind: 'empty-body' }
      return {
        kind: 'empty-body',
        status: parseIntStrict(statusRaw, 'x-mock-empty-status'),
      }
    }
    case 'x-mock-malformed': {
      const statusRaw = get(h, 'x-mock-malformed-status')
      if (statusRaw === undefined) return { kind: 'malformed-json' }
      return {
        kind: 'malformed-json',
        status: parseIntStrict(statusRaw, 'x-mock-malformed-status'),
      }
    }
    case 'x-mock-hang':
      return { kind: 'hang' }
    case 'x-mock-destroy':
      return { kind: 'destroy' }
    /* v8 ignore next 3 -- exhaustiveness: unreachable */
    default:
      // exhaustiveness — unreachable.
      return null
  }
}

export const parseHeaderMode = (
  headers: Readonly<Record<string, string>>
): HeaderParseResult => {
  try {
    const terminal = parseTerminal(headers)
    const delayRaw = get(headers, 'x-mock-delay')
    if (terminal === null && delayRaw === undefined) {
      return { kind: 'none' }
    }
    if (delayRaw === undefined) {
      return { kind: 'mode', mode: terminal! }
    }
    const ms = parseIntStrict(delayRaw, 'x-mock-delay')
    if (ms < 0) {
      return {
        kind: 'error',
        message: 'invalid x-mock-delay header: must be >= 0',
      }
    }
    if (terminal === null) {
      return { kind: 'mode', mode: { kind: 'delay', ms } }
    }
    if (
      terminal.kind === 'delay' ||
      terminal.kind === 'hang' ||
      terminal.kind === 'destroy'
    ) {
      return {
        kind: 'error',
        message: `x-mock-delay cannot wrap kind=${terminal.kind}`,
      }
    }
    return { kind: 'mode', mode: { kind: 'delay', ms, then: terminal } }
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}


/** Public alias of {@link parseHeaderMode}. */
export const parseMockHeaders = parseHeaderMode
