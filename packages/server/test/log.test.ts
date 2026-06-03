/**
 * Tests for opt-in per-request access logs (top-level `log` config).
 *
 * Each test spies on `process.stdout.write` so we capture only what
 * the logger emits. All assertions go through stdout; stderr carries
 * only runtime warnings and is not asserted here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createServer } from '../src/index.js'
import type { Config } from '../src/index.js'

const ANSI_RE = /\x1b\[[0-9;]*m/

const mkServer = (overrides: Partial<Config> = {}) =>
  createServer({
    routes: {
      'GET /api/v1/ping': () => ({ json: { ok: true } }),
      'GET /api/v1/boom': () => {
        throw new Error('handler-boom')
      },
    },
    ...overrides,
  })

const captureStdout = () => {
  const lines: string[] = []
  const spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(((chunk: string | Uint8Array): boolean => {
      lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }) as typeof process.stdout.write)
  return { lines, spy }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('access log: log === false (default)', () => {
  it('emits nothing across multiple requests', async () => {
    const server = mkServer()
    const { lines } = captureStdout()
    for (let i = 0; i < 5; i++) {
      await server.fetch(new Request('http://localhost/api/v1/ping'))
    }
    expect(lines.join('')).toBe('')
  })
})

describe('access log: log === true', () => {
  it('emits one line per request with method/path/status/ms', async () => {
    const server = mkServer({ log: true })
    const { lines } = captureStdout()
    await server.fetch(new Request('http://localhost/api/v1/ping'))
    await server.fetch(new Request('http://localhost/api/v1/ping'))
    const stripped = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''))
    expect(stripped).toHaveLength(2)
    for (const line of stripped) {
      expect(line).toMatch(/^GET \/api\/v1\/ping → 200 \d+ ms · /)
      expect(line.endsWith('\n')).toBe(true)
    }
  })
})

describe('access log: includeAdmin', () => {
  it('suppresses admin paths by default', async () => {
    const server = mkServer({
      log: true,
      admin: { enabled: true, path: '/admin' },
    })
    const { lines } = captureStdout()
    // Admin REST endpoint.
    await server.fetch(new Request('http://localhost/admin/overrides'))
    await server.fetch(new Request('http://localhost/api/v1/ping'))
    const stripped = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''))
    expect(stripped).toHaveLength(1)
    expect(stripped[0]).toMatch(/\/api\/v1\/ping/)
  })

  it('logs admin paths when includeAdmin: true', async () => {
    const server = mkServer({
      log: { includeAdmin: true, colors: 'never' },
      admin: { enabled: true, path: '/admin' },
    })
    const { lines } = captureStdout()
    await server.fetch(new Request('http://localhost/admin/overrides'))
    await server.fetch(new Request('http://localhost/api/v1/ping'))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/\/admin\/overrides/)
    expect(lines[1]).toMatch(/\/api\/v1\/ping/)
  })
})

describe('access log: format json', () => {
  it('emits a newline-terminated JSON object per request', async () => {
    const server = mkServer({ log: { format: 'json' } })
    const { lines } = captureStdout()
    await server.fetch(new Request('http://localhost/api/v1/ping'))
    expect(lines).toHaveLength(1)
    expect(lines[0]!.endsWith('\n')).toBe(true)
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(parsed).toMatchObject({
      method: 'GET',
      path: '/api/v1/ping',
      status: 200,
    })
    expect(typeof parsed.t).toBe('string')
    expect(typeof parsed.ms).toBe('number')
    expect(parsed).toHaveProperty('bytes')
  })

  it('includes "error" when the handler throws', async () => {
    const server = mkServer({ log: { format: 'json' } })
    const { lines } = captureStdout()
    await server.fetch(new Request('http://localhost/api/v1/boom'))
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(parsed.status).toBe(500)
    expect(parsed.error).toBe('handler-boom')
  })
})

describe('access log: sticky override marker', () => {
  it('appends override:<kind> when an admin override applies', async () => {
    const server = mkServer({
      log: { colors: 'never' },
      admin: { enabled: true, path: '/admin' },
    })
    const { lines } = captureStdout()
    await server.fetch(
      new Request('http://localhost/api/v1/ping', {
        headers: { 'x-mock-status': '500' },
      }),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/→ 500 .* \[override:http-status\]\n$/)
  })

  it('json format emits {"override":"<kind>"}', async () => {
    const server = mkServer({
      log: { format: 'json' },
      admin: { enabled: true, path: '/admin' },
    })
    const { lines } = captureStdout()
    await server.fetch(
      new Request('http://localhost/api/v1/ping', {
        headers: { 'x-mock-status': '418' },
      }),
    )
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(parsed.status).toBe(418)
    expect(parsed.override).toBe('http-status')
  })
})

describe('access log: colors', () => {
  it('omits ANSI escapes when colors: "never"', async () => {
    const server = mkServer({ log: { colors: 'never' } })
    const { lines } = captureStdout()
    await server.fetch(new Request('http://localhost/api/v1/ping'))
    expect(lines[0]).not.toMatch(ANSI_RE)
  })

  it('emits ANSI escapes when colors: "always"', async () => {
    const server = mkServer({ log: { colors: 'always' } })
    const { lines } = captureStdout()
    await server.fetch(new Request('http://localhost/api/v1/ping'))
    expect(lines[0]).toMatch(ANSI_RE)
  })
})

describe('access log: HEAD recursion', () => {
  it('emits exactly one line for an unmodelled HEAD request', async () => {
    const server = mkServer({ log: { colors: 'never' } })
    const { lines } = captureStdout()
    await server.fetch(new Request('http://localhost/api/v1/ping', { method: 'HEAD' }))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^HEAD \/api\/v1\/ping/)
  })
})
