import { describe, expect, it, vi } from 'vitest'
import { capability, createHost } from '@databehave/core'
import type { Plugin } from '@databehave/core'
import { httpCapability, httpPlugin } from '@databehave/server'
import { openapiPlugin, openapiCapability, openapiGeneratorCapability, mockModePlugin, requestValidationPlugin } from '../src/index.js'
import type { OpenApiGenerator } from '../src/index.js'
import { startOpenApi } from './helpers.js'

const document = JSON.stringify({ paths: { '/x': { get: { responses: {
  200: { content: { 'application/json': { schema: { type: 'string' } } } },
  500: { content: { 'application/json': { schema: { type: 'string' } } } },
} } } } })

describe('public OpenAPI capability composition', () => {
  it('requires an explicit generation provider', () => {
    expect(() => createHost({ plugins: [httpPlugin(), openapiPlugin({ document })] })).toThrow(/databehave.openapi.generator/)
  })

  it('accepts an independently implemented provider and compiles every status once', async () => {
    const compile = vi.fn<OpenApiGenerator['compile']>((_schema, { status }) => () => `external-${status}`)
    const token = capability<OpenApiGenerator>('example.responses', 1)
    const provider: Plugin = { id: 'external', apiVersion: 1, provides: [token], setup(ctx) { ctx.provide(token, { failureMode: 'throw', compile }) } }
    const http = await startOpenApi({ document, generator: token, provider, plugins: [mockModePlugin({ allowHeaderOverride: true })] })
    expect(await (await http.fetch(new Request('http://x/x'))).json()).toBe('external-200')
    expect(await (await http.fetch(new Request('http://x/x', { headers: { 'x-mock-status': '500' } }))).json()).toBe('external-500')
    expect(compile).toHaveBeenCalledTimes(2)
  })

  it('matches separately created tokens by stable capability name and version', async () => {
    const token = capability<OpenApiGenerator>(openapiGeneratorCapability.name, 1)
    const provider: Plugin = { id: 'external', apiVersion: 1, provides: [token], setup(ctx) { ctx.provide(token, { failureMode: 'throw', compile: () => () => 'replacement' }) } }
    const http = await startOpenApi({ document, provider })
    expect(await (await http.fetch(new Request('http://x/x'))).json()).toBe('replacement')
  })

  it('exposes catalog only after preparation and isolates host instances', async () => {
    const token = openapiGeneratorCapability
    const provider = (): Plugin => ({ id: 'external', apiVersion: 1, provides: [token], setup(ctx) { ctx.provide(token, { failureMode: 'throw', compile: () => () => 'x' }) } })
    const host = createHost({ plugins: [openapiPlugin({ document }), provider(), httpPlugin()] })
    try {
      expect(() => host.get(openapiCapability).operations).toThrow(/preparation/)
      await host.start()
      expect(host.get(httpCapability).routes).toHaveLength(1)
      expect(host.get(openapiCapability).operations[0]?.responses.map(response => response.status)).toEqual([200, 500])
      const second = await startOpenApi({ document: '{"paths":{}}' })
      expect(second.routes).toHaveLength(0)
    } finally { await host.close() }
  })

  it('validates effective GET contract for HEAD and decorates validation failures once', async () => {
    const http = await startOpenApi({
      document: JSON.stringify({ paths: { '/x': { get: { parameters: [{ in: 'query', name: 'n', required: true, schema: { type: 'integer' } }], responses: { 200: {} } } } } }),
      plugins: [requestValidationPlugin(), mockModePlugin()],
    })
    const response = await http.fetch(new Request('http://x/x', { method: 'HEAD' }))
    expect(response.status).toBe(422)
    expect(response.headers.get('x-mock-status')).toBe('422')
    expect(await response.text()).toBe('')
  })
})

describe('mock status policy boundaries', () => {
  it('preserves no-body statuses and bypasses configured health paths', async () => {
    const http = await startOpenApi({ document, plugins: [mockModePlugin({ defaultStatus: 204, healthPaths: ['/health'] })], routes: { 'GET /health': () => ({ json: 'healthy' }) } })
    const empty = await http.fetch(new Request('http://x/x'))
    expect(empty.status).toBe(204)
    expect(await empty.text()).toBe('')
    const health = await http.fetch(new Request('http://x/health'))
    expect(await health.json()).toBe('healthy')
    expect(health.headers.has('x-mock-status')).toBe(false)
  })

  it('uses an envelope when an explicit route has no OpenAPI operation', async () => {
    const http = await startOpenApi({ document, plugins: [mockModePlugin({ defaultStatus: 503 })], routes: { 'GET /outside': () => ({ json: 'normal' }) } })
    const response = await http.fetch(new Request('http://x/outside'))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: true, status: 503 })
  })
})
