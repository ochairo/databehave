import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createServer } from '../src/index.js'
import { loadConfig } from '../src/json-config.js'

let dir: string

const writeJson = (name: string, obj: unknown): string => {
  const p = join(dir, name)
  writeFileSync(p, JSON.stringify(obj, null, 2))
  return p
}

const writeFile = (name: string, content: string): string => {
  const p = join(dir, name)
  const parent = p.slice(0, p.lastIndexOf('/'))
  mkdirSync(parent, { recursive: true })
  writeFileSync(p, content)
  return p
}

const MIN_OAS = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 't', version: '1' },
  paths: {},
})

beforeEach(() => {
  dir = mkdtempSync(join(process.cwd(), '.databehave-server-cfg-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('loadConfig', () => {
  it('loads minimal config with defaults', async () => {
    const cfgPath = writeJson('cfg.json', {})
    const { config, server } = await loadConfig(cfgPath)
    expect(server).toEqual({ host: '127.0.0.1', port: 3000 })
    expect(config.routes).toEqual({})
    expect(config.openapi).toBeUndefined()
    expect(config.hooks).toBeUndefined()
    expect(config.cors).toBeUndefined()
  })

  it('reads openapi body from disk relative to the config', async () => {
    writeFile('openapi.json', MIN_OAS)
    const cfgPath = writeJson('cfg.json', { openapi: './openapi.json' })
    const { config } = await loadConfig(cfgPath)
    expect(config.openapi).toContain('"openapi":"3.0.0"')
  })

  it.todo('passes a non-JSON openapi spec through verbatim once a zero-dep parser ships')

  it('keeps JSON openapi spec bytes intact (0.3.x compat)', async () => {
    writeFile('openapi.json', MIN_OAS)
    const cfgPath = writeJson('cfg.json', { openapi: './openapi.json' })
    const { config } = await loadConfig(cfgPath)
    // Byte-for-byte: the loader passes file contents through untouched.
    expect(config.openapi).toBe(MIN_OAS)
  })

  it.todo('surfaces openapi parse errors when the server is constructed')

  describe('endpoints (string form)', () => {
    it('imports default-exported handlers', async () => {
      writeFile(
        'handler.mjs',
        `export default async () => ({ json: { hi: true } })\n`,
      )
      const cfgPath = writeJson('cfg.json', {
        endpoints: { 'GET /api/v1/x': './handler.mjs' },
      })
      const { config } = await loadConfig(cfgPath)
      const h = config.routes!['GET /api/v1/x']
      expect(typeof h).toBe('function')
      const res = await h!({} as never)
      expect(res).toEqual({ json: { hi: true } })
    })

    it('throws when a handler module has no default export', async () => {
      writeFile(
        'bad-handler.mjs',
        `export const named = async () => ({})\n`,
      )
      const cfgPath = writeJson('cfg.json', {
        endpoints: { 'GET /api/v1/x': './bad-handler.mjs' },
      })
      await expect(loadConfig(cfgPath)).rejects.toThrow(
        /no default-exported handler/,
      )
    })
  })

  describe('handlers override (options.handlers)', () => {
    it('uses an override handler instead of dynamic-importing the module', async () => {
      // Reference a module path that does not exist on disk — proves the
      // override is consulted first and the dynamic import is skipped.
      const cfgPath = writeJson('cfg.json', {
        endpoints: { 'GET /api/v1/x': './does-not-exist.js' },
      })
      const stub = async () => ({ json: { from: 'override' } })
      const { config } = await loadConfig(cfgPath, {
        handlers: { './does-not-exist.js': stub },
      })
      const h = config.routes!['GET /api/v1/x']
      const res = await h!({} as never)
      expect(res).toEqual({ json: { from: 'override' } })
    })

    it('matches override keys against the { handler } object form', async () => {
      const cfgPath = writeJson('cfg.json', {
        endpoints: {
          'GET /api/v1/x': { handler: './missing.js', status: 500 },
        },
      })
      const stub = async () => ({ json: { ok: 1 } })
      const { config } = await loadConfig(cfgPath, {
        handlers: { './missing.js': stub },
      })
      const h = config.routes!['GET /api/v1/x']
      expect(typeof h).toBe('function')
    })

    it('falls back to dynamic import when override key is absent', async () => {
      writeFile('h.mjs', `export default async () => ({ json: { ok: true } })\n`)
      const cfgPath = writeJson('cfg.json', {
        endpoints: { 'GET /api/v1/x': './h.mjs' },
      })
      const { config } = await loadConfig(cfgPath, {
        handlers: { './other.js': async () => ({ json: {} }) },
      })
      const h = config.routes!['GET /api/v1/x']
      const res = await h!({} as never)
      expect(res).toEqual({ json: { ok: true } })
    })

    it('tolerates trivial spelling differences in override keys', async () => {
      const cfgPath = writeJson('cfg.json', {
        endpoints: { 'GET /api/v1/x': './src/routes/x.js' },
      })
      const stub = async () => ({ json: { ok: true } })
      // Map key uses neither the leading `./` nor `.js` extension.
      const { config } = await loadConfig(cfgPath, {
        handlers: { 'src/routes/x.ts': stub },
      })
      const h = config.routes!['GET /api/v1/x']
      expect(typeof h).toBe('function')
    })

    it('rejects non-function override values at boot time', async () => {
      const cfgPath = writeJson('cfg.json', {
        endpoints: { 'GET /api/v1/x': './missing.js' },
      })
      await expect(
        loadConfig(cfgPath, {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          handlers: { './missing.js': { not: 'a function' } as any },
        }),
      ).rejects.toThrow(/is not a function/)
    })
  })

  describe('endpoints (object handler form)', () => {
    it('imports the handler given as { handler }', async () => {
      writeFile('h.mjs', `export default async () => ({ json: { ok: 1 } })\n`)
      const cfgPath = writeJson('cfg.json', {
        endpoints: {
          'GET /api/v1/x': { handler: './h.mjs' },
        },
      })
      const { config } = await loadConfig(cfgPath)
      const res = await config.routes!['GET /api/v1/x']!({} as never)
      expect(res).toEqual({ json: { ok: 1 } })
    })

    it('merges per-endpoint status into mockMode.pathOverrides', async () => {
      writeFile('h.mjs', `export default async () => ({ json: {} })\n`)
      const cfgPath = writeJson('cfg.json', {
        mockMode: { enabled: true },
        endpoints: {
          'GET /api/v1/x': { handler: './h.mjs', status: 500 },
        },
      })
      const { config } = await loadConfig(cfgPath)
      // hooks short-circuit at 500 because per-endpoint status was merged in
      const req = {
        method: 'GET',
        path: '/api/v1/x',
      } as never
      const out = config.hooks!.onRequest!(req) as
        | { status: number; json: unknown; headers: Record<string, string> }
        | undefined
      expect(out).toBeDefined()
      expect(out!.status).toBe(500)
      expect(out!.json).toEqual({ error: true, status: 500 })
      expect(out!.headers['x-mock-status']).toBe('500')
    })

    it('lets explicit mockMode.pathOverrides win over per-endpoint status', async () => {
      writeFile('h.mjs', `export default async () => ({ json: {} })\n`)
      const cfgPath = writeJson('cfg.json', {
        mockMode: {
          enabled: true,
          pathOverrides: { 'GET /api/v1/x': 404 },
        },
        endpoints: {
          'GET /api/v1/x': { handler: './h.mjs', status: 500 },
        },
      })
      const { config } = await loadConfig(cfgPath)
      const out = config.hooks!.onRequest!({
        method: 'GET',
        path: '/api/v1/x',
      } as never) as { status: number }
      expect(out.status).toBe(404)
    })

    it('rejects non-numeric status', async () => {
      writeFile('h.mjs', `export default async () => ({ json: {} })\n`)
      const cfgPath = writeJson('cfg.json', {
        endpoints: {
          'GET /api/v1/x': { handler: './h.mjs', status: 'oops' },
        },
      })
      await expect(loadConfig(cfgPath)).rejects.toThrow(
        /\.status must be a number/,
      )
    })
  })

  describe('endpoints (response form)', () => {
    it('synthesizes a handler that returns the static response (json)', async () => {
      const cfgPath = writeJson('cfg.json', {
        endpoints: {
          'GET /api/v1/teapot': {
            response: { status: 418, json: { teapot: true } },
          },
        },
      })
      const { config } = await loadConfig(cfgPath)
      const res = await config.routes!['GET /api/v1/teapot']!({} as never)
      expect(res).toEqual({ status: 418, json: { teapot: true } })
    })

    it('synthesizes an empty-body handler when response.empty is true', async () => {
      const cfgPath = writeJson('cfg.json', {
        endpoints: {
          'POST /api/v1/no-content': {
            response: { status: 204, empty: true },
          },
        },
      })
      const { config } = await loadConfig(cfgPath)
      const res = await config.routes!['POST /api/v1/no-content']!(
        {} as never,
      )
      expect(res).toEqual({ status: 204, empty: true })
    })

    it('forwards response.headers to the synthesized response', async () => {
      const cfgPath = writeJson('cfg.json', {
        endpoints: {
          'GET /api/v1/x': {
            response: {
              status: 200,
              json: { ok: true },
              headers: { 'x-foo': 'bar' },
            },
          },
        },
      })
      const { config } = await loadConfig(cfgPath)
      const res = (await config.routes!['GET /api/v1/x']!({} as never)) as {
        status: number
        json: unknown
        headers: Record<string, string>
      }
      expect(res.headers).toEqual({ 'x-foo': 'bar' })
    })

    it('rejects combining handler with response', async () => {
      writeFile('h.mjs', `export default async () => ({ json: {} })\n`)
      const cfgPath = writeJson('cfg.json', {
        endpoints: {
          'GET /api/v1/x': {
            handler: './h.mjs',
            response: { status: 500 },
          },
        },
      })
      await expect(loadConfig(cfgPath)).rejects.toThrow(
        /cannot have both "handler" and "response"/,
      )
    })

    it('rejects empty object with neither handler nor response', async () => {
      const cfgPath = writeJson('cfg.json', {
        endpoints: { 'GET /api/v1/x': {} },
      })
      await expect(loadConfig(cfgPath)).rejects.toThrow(
        /must have either "handler" or "response"/,
      )
    })

    it('rejects combining response with top-level status', async () => {
      const cfgPath = writeJson('cfg.json', {
        endpoints: {
          'GET /api/v1/x': {
            response: { status: 500 },
            status: 404,
          },
        },
      })
      await expect(loadConfig(cfgPath)).rejects.toThrow(
        /status cannot be combined with "response"/,
      )
    })

    it('rejects response without numeric status', async () => {
      const cfgPath = writeJson('cfg.json', {
        endpoints: {
          'GET /api/v1/x': { response: { json: {} } },
        },
      })
      await expect(loadConfig(cfgPath)).rejects.toThrow(
        /response\.status must be a number/,
      )
    })
  })

  describe('basePath', () => {
    it('prepends basePath to relative keys (no leading slash)', async () => {
      writeFile('h.mjs', `export default async () => ({ json: {} })\n`)
      const cfgPath = writeJson('cfg.json', {
        basePath: '/api/v1',
        endpoints: { 'GET inventory/east': './h.mjs' },
      })
      const { config } = await loadConfig(cfgPath)
      expect(Object.keys(config.routes!)).toEqual([
        'GET /api/v1/inventory/east',
      ])
    })

    it('leaves absolute keys (leading slash) untouched', async () => {
      writeFile('h.mjs', `export default async () => ({ json: {} })\n`)
      const cfgPath = writeJson('cfg.json', {
        basePath: '/api/v1',
        endpoints: { 'GET /health': './h.mjs' },
      })
      const { config } = await loadConfig(cfgPath)
      expect(Object.keys(config.routes!)).toEqual(['GET /health'])
    })

    it('uses the post-basePath key when merging per-endpoint status', async () => {
      writeFile('h.mjs', `export default async () => ({ json: {} })\n`)
      const cfgPath = writeJson('cfg.json', {
        basePath: '/api/v1',
        mockMode: { enabled: true },
        endpoints: {
          'GET inventory/east': { handler: './h.mjs', status: 500 },
        },
      })
      const { config } = await loadConfig(cfgPath)
      const out = config.hooks!.onRequest!({
        method: 'GET',
        path: '/api/v1/inventory/east',
      } as never) as { status: number }
      expect(out.status).toBe(500)
    })

    it('rejects basePath without leading slash', async () => {
      const cfgPath = writeJson('cfg.json', { basePath: 'api/v1' })
      await expect(loadConfig(cfgPath)).rejects.toThrow(
        /must start with "\/"/,
      )
    })

    it('rejects basePath with trailing slash', async () => {
      const cfgPath = writeJson('cfg.json', { basePath: '/api/v1/' })
      await expect(loadConfig(cfgPath)).rejects.toThrow(
        /must not end with "\/"/,
      )
    })
  })

  describe('env interpolation', () => {
    it('substitutes ${VAR} from process.env', async () => {
      process.env.DATABEHAVE_KIT_TEST_PORT = '7777'
      try {
        const cfgPath = writeJson('cfg.json', {
          server: { host: '0.0.0.0', port: '${DATABEHAVE_KIT_TEST_PORT}' },
        })
        const { server } = await loadConfig(cfgPath)
        expect(server).toEqual({ host: '0.0.0.0', port: 7777 })
      } finally {
        delete process.env.DATABEHAVE_KIT_TEST_PORT
      }
    })

    it('uses ${VAR:default} when the env var is missing', async () => {
      delete process.env.DATABEHAVE_KIT_MISSING
      const cfgPath = writeJson('cfg.json', {
        server: { port: '${DATABEHAVE_KIT_MISSING:8123}' },
      })
      const { server } = await loadConfig(cfgPath)
      expect(server.port).toBe(8123)
    })
  })

  describe('cors', () => {
    it('injects a default origin function when cors is declared', async () => {
      const cfgPath = writeJson('cfg.json', {
        cors: { credentials: true, exposeHeaders: ['x-foo'] },
      })
      const { config } = await loadConfig(cfgPath)
      expect(typeof config.cors?.origin).toBe('function')
      expect(config.cors?.origin?.('https://x')).toBe('https://x')
      expect(config.cors?.origin?.('')).toBe('*')
    })

    it('treats a string `origin` as a single-entry allowlist', async () => {
      const cfgPath = writeJson('cfg.json', {
        cors: { origin: 'https://app.example.com' },
      })
      const { config } = await loadConfig(cfgPath)
      expect(config.cors?.origin?.('https://app.example.com')).toBe(
        'https://app.example.com',
      )
      // Off-allowlist requests get an empty value (rejected by the browser).
      expect(config.cors?.origin?.('https://evil.example.com')).toBe('')
      // Absent request Origin with a configured allowlist → empty so
      // the response builder omits `Access-Control-Allow-Origin`
      // entirely. Echoing an arbitrary allowlist entry would violate
      // the CORS spec when combined with `credentials: true`.
      expect(config.cors?.origin?.('')).toBe('')
    })

    it('accepts an array `origin` allowlist', async () => {
      const cfgPath = writeJson('cfg.json', {
        cors: { origin: ['https://a.example', 'https://b.example'] },
      })
      const { config } = await loadConfig(cfgPath)
      expect(config.cors?.origin?.('https://a.example')).toBe('https://a.example')
      expect(config.cors?.origin?.('https://b.example')).toBe('https://b.example')
      expect(config.cors?.origin?.('https://c.example')).toBe('')
    })
  })

  describe('mockMode', () => {
    it('wires hooks when mockMode.enabled is true', async () => {
      const cfgPath = writeJson('cfg.json', {
        mockMode: { enabled: true },
      })
      const { config } = await loadConfig(cfgPath)
      expect(config.hooks?.onRequest).toBeTypeOf('function')
      expect(config.hooks?.onResponse).toBeTypeOf('function')
    })

    it('rejects pathOverrides keys that do not start with "/" or "<METHOD> /"', async () => {
      const cfgPath = writeJson('cfg.json', {
        mockMode: {
          enabled: true,
          pathOverrides: { 'inventory/east': 500 },
        },
      })
      await expect(loadConfig(cfgPath)).rejects.toThrow(
        /pathOverrides.*"inventory\/east".*"<METHOD> \/path"/,
      )
    })

    it('rejects pathOverrides values that are not numbers', async () => {
      const cfgPath = writeJson('cfg.json', {
        mockMode: {
          enabled: true,
          pathOverrides: { '/api/v1/x': 'boom' },
        },
      })
      await expect(loadConfig(cfgPath)).rejects.toThrow(
        /pathOverrides.*must be a number/,
      )
    })

    it('accepts both "<METHOD> /path" and "/path" forms', async () => {
      const cfgPath = writeJson('cfg.json', {
        mockMode: {
          enabled: true,
          pathOverrides: {
            'GET /api/v1/x': 500,
            '/api/v1/y': 410,
          },
        },
      })
      await expect(loadConfig(cfgPath)).resolves.toBeDefined()
    })

    it('normalizes lowercase methods so runtime lookup matches', async () => {
      // The runtime matcher uppercases the request method before
      // hitting the override map, so a lowercase config key would
      // silently never match. The validator now canonicalises the
      // method portion so the wired-up hook resolves it correctly.
      const cfgPath = writeJson('cfg.json', {
        mockMode: {
          enabled: true,
          pathOverrides: {
            'get /api/v1/x': 500,
            'Post /api/v1/y': 502,
          },
        },
      })
      const { config } = await loadConfig(cfgPath)
      const onRequest = config.hooks?.onRequest
      expect(onRequest).toBeDefined()
      const probe = (method: string, path: string) =>
        onRequest!({ method, path, headers: {}, query: {}, params: {} } as never)
      // Both lowercase / mixed-case keys must resolve to the correct
      // status when the runtime sends the canonical uppercase method.
      expect((probe('GET', '/api/v1/x') as { status: number })?.status).toBe(500)
      expect((probe('POST', '/api/v1/y') as { status: number })?.status).toBe(502)
    })

    it('does not wire hooks when mockMode is absent', async () => {
      const cfgPath = writeJson('cfg.json', {})
      const { config } = await loadConfig(cfgPath)
      expect(config.hooks).toBeUndefined()
    })

    it('uses OAS responses[N] schema for body when status is short-circuited', async () => {
      writeFile(
        'openapi.json',
        JSON.stringify({
          openapi: '3.0.0',
          info: { title: 't', version: '1' },
          paths: {
            '/api/v1/x': {
              get: {
                responses: {
                  '500': {
                    description: 'server error',
                    content: {
                      'application/json': {
                        schema: {
                          type: 'object',
                          required: ['code', 'kind'],
                          properties: {
                            code: { type: 'integer' },
                            kind: { type: 'string', enum: ['oas_500'] },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      )
      const cfgPath = writeJson('cfg.json', {
        openapi: './openapi.json',
        mockMode: {
          enabled: true,
          pathOverrides: { 'GET /api/v1/x': 500 },
        },
      })
      const { config } = await loadConfig(cfgPath)
      const out = config.hooks!.onRequest!({
        method: 'GET',
        path: '/api/v1/x',
      } as never) as { status: number; json: { code: number; kind: string } }
      expect(out.status).toBe(500)
      // OAS-backed body, not the minimal envelope.
      expect(out.json).toEqual(
        expect.objectContaining({
          code: expect.any(Number),
          kind: 'oas_500',
        }),
      )
      expect((out.json as Record<string, unknown>).error).toBeUndefined()
    })

    it('falls back to envelope when OAS does not declare the status', async () => {
      writeFile(
        'openapi.json',
        JSON.stringify({
          openapi: '3.0.0',
          info: { title: 't', version: '1' },
          paths: {
            '/api/v1/x': {
              get: {
                responses: {
                  '200': {
                    description: 'ok',
                    content: {
                      'application/json': { schema: { type: 'object' } },
                    },
                  },
                },
              },
            },
          },
        }),
      )
      const cfgPath = writeJson('cfg.json', {
        openapi: './openapi.json',
        mockMode: {
          enabled: true,
          pathOverrides: { 'GET /api/v1/x': 500 },
        },
      })
      const { config } = await loadConfig(cfgPath)
      const out = config.hooks!.onRequest!({
        method: 'GET',
        path: '/api/v1/x',
      } as never) as { status: number; json: unknown }
      expect(out.status).toBe(500)
      expect(out.json).toEqual({ error: true, status: 500 })
    })

    it('resolves OAS body for dynamic patterns (:param) at runtime', async () => {
      // Regression: response generators were keyed by OAS pattern
      // (`GET /api/v1/items/:id`) but the resolver queried by the
      // concrete request path (`GET /api/v1/items/42`). Dynamic
      // routes silently fell back to the generic envelope. The
      // resolver now walks the pattern table for non-static matches.
      writeFile(
        'openapi.json',
        JSON.stringify({
          openapi: '3.0.0',
          info: { title: 't', version: '1' },
          paths: {
            '/api/v1/items/{id}': {
              get: {
                responses: {
                  '404': {
                    description: 'not found',
                    content: {
                      'application/json': {
                        schema: {
                          type: 'object',
                          required: ['kind'],
                          properties: {
                            kind: { type: 'string', enum: ['oas_404_param'] },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      )
      const cfgPath = writeJson('cfg.json', {
        openapi: './openapi.json',
        mockMode: {
          enabled: true,
          // pathOverrides matches by exact key, so we trigger the
          // override at the concrete request path. The OAS schema
          // is declared as `/api/v1/items/{id}`; the body resolver
          // is the piece under test \u2014 it must find that
          // pattern-keyed generator when queried with the concrete
          // path that the runtime hook hands it.
          pathOverrides: { 'GET /api/v1/items/42': 404 },
        },
      })
      const { config } = await loadConfig(cfgPath)
      const out = config.hooks!.onRequest!({
        method: 'GET',
        path: '/api/v1/items/42',
      } as never) as { status: number; json: { kind: string } }
      expect(out.status).toBe(404)
      expect(out.json).toEqual(expect.objectContaining({ kind: 'oas_404_param' }))
    })

    it('prefers static OAS paths over parametric overlaps regardless of declaration order', async () => {
      // The OAS document below intentionally declares the parametric
      // path BEFORE the static one. A naive matcher that iterates in
      // insertion order would return the `:id` body for `/items/me`.
      // The resolver sorts static-first so the more specific route
      // wins deterministically.
      writeFile(
        'openapi.json',
        JSON.stringify({
          openapi: '3.0.0',
          info: { title: 't', version: '1' },
          paths: {
            '/api/v1/items/{id}': {
              get: {
                responses: {
                  '500': {
                    description: 'err',
                    content: {
                      'application/json': {
                        schema: {
                          type: 'object',
                          required: ['kind'],
                          properties: {
                            kind: { type: 'string', enum: ['param'] },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '/api/v1/items/me': {
              get: {
                responses: {
                  '500': {
                    description: 'err',
                    content: {
                      'application/json': {
                        schema: {
                          type: 'object',
                          required: ['kind'],
                          properties: {
                            kind: { type: 'string', enum: ['static'] },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      )
      const cfgPath = writeJson('cfg.json', {
        openapi: './openapi.json',
        mockMode: {
          enabled: true,
          pathOverrides: {
            'GET /api/v1/items/me': 500,
            'GET /api/v1/items/42': 500,
          },
        },
      })
      const { config } = await loadConfig(cfgPath)
      const probe = (path: string) =>
        config.hooks!.onRequest!({ method: 'GET', path } as never) as {
          status: number
          json: { kind: string }
        }
      expect(probe('/api/v1/items/me').json.kind).toBe('static')
      expect(probe('/api/v1/items/42').json.kind).toBe('param')
    })

    it('disambiguates overlapping dynamic OAS paths by segment count then path order', async () => {
      // Three dynamic patterns:
      //   - `/api/v1/a/{x}`                (2 segments after base)
      //   - `/api/v1/a/{x}/b/{y}`          (4 segments — longer wins for /a/1/b/2)
      //   - `/api/v1/c/{z}`                (2 segments — same length as first;
      //                                     tie-broken by localeCompare on the
      //                                     stored pattern path)
      // Queries:
      //   - /api/v1/a/1/b/2 → must hit the 4-segment pattern (`deep`),
      //     proving the segment-length sort branch is exercised and that
      //     the resolver walks past the shorter, non-matching `/a/{x}`
      //     pattern (matchPattern → null, `continue` branch).
      //   - /api/v1/c/9     → must hit the `/c/{z}` pattern, proving the
      //     localeCompare tie-break path with same-length dynamic peers
      //     still resolves correctly.
      writeFile(
        'openapi.json',
        JSON.stringify({
          openapi: '3.0.0',
          info: { title: 't', version: '1' },
          paths: {
            '/api/v1/a/{x}': {
              get: {
                responses: {
                  '500': {
                    description: 'err',
                    content: {
                      'application/json': {
                        schema: {
                          type: 'object',
                          required: ['kind'],
                          properties: { kind: { type: 'string', enum: ['shallow'] } },
                        },
                      },
                    },
                  },
                },
              },
            },
            '/api/v1/a/{x}/b/{y}': {
              get: {
                responses: {
                  '500': {
                    description: 'err',
                    content: {
                      'application/json': {
                        schema: {
                          type: 'object',
                          required: ['kind'],
                          properties: { kind: { type: 'string', enum: ['deep'] } },
                        },
                      },
                    },
                  },
                },
              },
            },
            '/api/v1/c/{z}': {
              get: {
                responses: {
                  '500': {
                    description: 'err',
                    content: {
                      'application/json': {
                        schema: {
                          type: 'object',
                          required: ['kind'],
                          properties: { kind: { type: 'string', enum: ['cee'] } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      )
      const cfgPath = writeJson('cfg.json', {
        openapi: './openapi.json',
        mockMode: {
          enabled: true,
          pathOverrides: {
            'GET /api/v1/a/1/b/2': 500,
            'GET /api/v1/c/9': 500,
          },
        },
      })
      const { config } = await loadConfig(cfgPath)
      const probe = (path: string) =>
        config.hooks!.onRequest!({ method: 'GET', path } as never) as {
          status: number
          json: { kind: string }
        }
      expect(probe('/api/v1/a/1/b/2').json.kind).toBe('deep')
      expect(probe('/api/v1/c/9').json.kind).toBe('cee')
    })

    it('falls back to envelope when the OAS body fails to parse', async () => {
      // Malformed JSON exercises the resolver-construction catch
      // branch — mock-mode must still work, just without an OAS body.
      writeFile('openapi.json', '{ not: valid json ')
      const cfgPath = writeJson('cfg.json', {
        openapi: './openapi.json',
        mockMode: {
          enabled: true,
          pathOverrides: { 'GET /api/v1/x': 500 },
        },
      })
      const { config } = await loadConfig(cfgPath)
      const out = config.hooks!.onRequest!({
        method: 'GET',
        path: '/api/v1/x',
      } as never) as { status: number; json: unknown }
      expect(out.status).toBe(500)
      expect(out.json).toEqual({ error: true, status: 500 })
    })
  })

  describe('validation', () => {
    it('rejects non-string handler paths in shorthand form', async () => {
      const cfgPath = writeJson('cfg.json', {
        endpoints: { 'GET /x': 123 },
      })
      await expect(loadConfig(cfgPath)).rejects.toThrow(
        /must be a string or object/,
      )
    })

    it('rejects malformed route keys (no method)', async () => {
      writeFile('h.mjs', `export default async () => ({ json: {} })\n`)
      const cfgPath = writeJson('cfg.json', {
        endpoints: { '/no-method': './h.mjs' },
      })
      await expect(loadConfig(cfgPath)).rejects.toThrow()
    })

    it('aggregates every failing endpoint into a single AggregateError', async () => {
      const cfgPath = writeJson('cfg.json', {
        endpoints: {
          'GET /a': './missing-a.mjs',
          'GET /b': './missing-b.mjs',
          'GET /c': './missing-c.mjs',
        },
      })
      await expect(loadConfig(cfgPath)).rejects.toThrow(AggregateError)
      try {
        await loadConfig(cfgPath)
      } catch (err) {
        expect(err).toBeInstanceOf(AggregateError)
        const ae = err as AggregateError & { errors: unknown[] }
        expect(ae.errors).toHaveLength(3)
        expect(ae.message).toMatch(/GET \/a/)
        expect(ae.message).toMatch(/GET \/b/)
        expect(ae.message).toMatch(/GET \/c/)
      }
    })

    it('detects endpoint key collisions after applyBasePath', async () => {
      writeFile('h.mjs', `export default async () => ({ json: {} })\n`)
      const cfgPath = writeJson('cfg.json', {
        basePath: '/api/v1',
        endpoints: {
          'GET /api/v1/x': './h.mjs',
          'GET x': './h.mjs',
        },
      })
      await expect(loadConfig(cfgPath)).rejects.toThrow(
        /resolve to "GET \/api\/v1\/x"/,
      )
    })
  })

  describe('immutability', () => {
    const originalEnv = process.env.NODE_ENV
    afterEach(() => {
      process.env.NODE_ENV = originalEnv
    })

    it('deep-freezes the resolved config in non-production', async () => {
      process.env.NODE_ENV = 'test'
      writeFile('h.mjs', `export default async () => ({ json: {} })\n`)
      const cfgPath = writeJson('cfg.json', {
        cors: { allowMethods: ['GET'] },
        endpoints: { 'GET /x': './h.mjs' },
      })
      const { config } = await loadConfig(cfgPath)
      expect(Object.isFrozen(config)).toBe(true)
      expect(Object.isFrozen(config.routes)).toBe(true)
      expect(Object.isFrozen(config.cors)).toBe(true)
      expect(() => {
        ;(config.routes as Record<string, unknown>)['GET /y'] = () => ({ json: {} })
      }).toThrow(TypeError)
    })
  })

  describe('openapi loader callbacks', () => {
    it('routes OAS walk failures through the injected logger', async () => {
      const oas = JSON.stringify({
        openapi: '3.0.0',
        info: { title: 't', version: '0' },
        paths: {
          '/api/v1/broken': {
            get: {
              responses: {
                '200': {
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Missing' },
                    },
                  },
                },
              },
            },
          },
        },
      })
      writeFile('openapi.json', oas)
      const cfgPath = writeJson('cfg.json', { openapi: './openapi.json' })
      const warnings: string[] = []
      const { config } = await loadConfig(cfgPath, {
        logger: { warn: (m) => warnings.push(m) },
      })
      // Trigger the registered callback via createServer.
      const server = createServer(config)
      await server.fetch(new Request('http://localhost/api/v1/broken'))
      expect(warnings.some((w) => /openapi walk failed for GET \/api\/v1\/broken/.test(w))).toBe(
        true,
      )
    })

    it('routes empty-OAS-schema notices through the injected logger', async () => {
      const oas = JSON.stringify({
        openapi: '3.0.0',
        info: { title: 't', version: '0' },
        paths: {
          '/api/v1/anything': {
            get: {
              responses: {
                '200': { content: { 'application/json': { schema: {} } } },
              },
            },
          },
        },
      })
      writeFile('openapi.json', oas)
      const cfgPath = writeJson('cfg.json', { openapi: './openapi.json' })
      const warnings: string[] = []
      const { config } = await loadConfig(cfgPath, {
        logger: { warn: (m) => warnings.push(m) },
      })
      const server = createServer(config)
      await server.fetch(new Request('http://localhost/api/v1/anything'))
      expect(
        warnings.some((w) =>
          /OAS response schema is empty for GET \/api\/v1\/anything \(status 200\)/.test(w),
        ),
      ).toBe(true)
    })
  })
})
