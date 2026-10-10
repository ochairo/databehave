/** Characterize the live access-log plugin through the public HTTP pipeline. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { accessLogPlugin, terminateTransport, type AccessLogOptions } from '../src/index.js'
import { createHttpFixture } from './support/http-fixture.js'

const ANSI_RE = /\x1b\[[0-9;]*m/
const mkServer = (log?: AccessLogOptions) => createHttpFixture({
  routes: {
    'GET /api/v1/ping': () => ({ json: { ok: true } }),
    'GET /api/v1/boom': () => { throw new Error('handler-boom') },
    'GET /api/v1/terminate': () => terminateTransport('fault'),
    'GET /admin/overrides': () => ({ json: [] }),
  },
  plugins: log ? [accessLogPlugin(log)] : [],
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

describe('access log: plugin absent', () => {
  it('emits nothing across multiple requests', async () => {
    const server = mkServer()
    const { lines } = captureStdout()
    for (let i = 0; i < 5; i++) {
      await server.fetch(new Request('http://localhost/api/v1/ping'))
    }
    expect(lines.join('')).toBe('')
  })
})

describe('access log: plugin defaults', () => {
  it('emits one line per request with method/path/status/ms', async () => {
    const server = mkServer({})
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

describe('access log: caller-owned filtering', () => {
  it('suppresses paths selected by the configured filter', async () => {
    const server = mkServer({ colors: 'never', filter: ({ request }) => !request.path.startsWith('/admin/') })
    const { lines } = captureStdout()
    await server.fetch(new Request('http://localhost/admin/overrides'))
    await server.fetch(new Request('http://localhost/api/v1/ping'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('/api/v1/ping')
  })

  it('observes every path when no filter is configured', async () => {
    const server = mkServer({ colors: 'never' })
    const { lines } = captureStdout()
    await server.fetch(new Request('http://localhost/admin/overrides'))
    await server.fetch(new Request('http://localhost/api/v1/ping'))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('/admin/overrides')
    expect(lines[1]).toContain('/api/v1/ping')
  })
})

describe('access log: format json', () => {
  it('emits a newline-terminated JSON object per request', async () => {
    const server = mkServer({ format: 'json' })
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
    const server = mkServer({ format: 'json' })
    const { lines } = captureStdout()
    await server.fetch(new Request('http://localhost/api/v1/boom'))
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(parsed.status).toBe(500)
    expect(parsed.error).toBe('handler-boom')
  })
})

describe('access log: terminal outcomes and output', () => {
  it('logs termination without fabricating an HTTP status', async () => {
    const server = mkServer({ format: 'json' })
    const { lines } = captureStdout()
    await expect(server.fetch(new Request('http://localhost/api/v1/terminate'))).rejects.toThrow('unsupported by fetch')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ status: 'terminated', error: 'fault' })
  })

  it('keeps the response intact when the configured writer fails', async () => {
    const server = mkServer({ write: () => { throw new Error('output failed') } })
    const response = await server.fetch(new Request('http://localhost/api/v1/ping'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })
})

describe('access log: colors', () => {
  it('omits ANSI escapes when colors: "never"', async () => {
    const server = mkServer({ colors: 'never' })
    const { lines } = captureStdout()
    await server.fetch(new Request('http://localhost/api/v1/ping'))
    expect(lines[0]).not.toMatch(ANSI_RE)
  })

  it('emits ANSI escapes when colors: "always"', async () => {
    const server = mkServer({ colors: 'always' })
    const { lines } = captureStdout()
    await server.fetch(new Request('http://localhost/api/v1/ping'))
    expect(lines[0]).toMatch(ANSI_RE)
  })
})

describe('access log: HEAD fallback', () => {
  it('emits exactly one line for an unmodelled HEAD request', async () => {
    const server = mkServer({ colors: 'never' })
    const { lines } = captureStdout()
    await server.fetch(new Request('http://localhost/api/v1/ping', { method: 'HEAD' }))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^HEAD \/api\/v1\/ping/)
  })
})
