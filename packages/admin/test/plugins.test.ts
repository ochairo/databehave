import { mkdtemp, readFile, writeFile, rm, readdir, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:net'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createHost, type Host, type Plugin } from '@databehave/core'
import { httpCapability, httpPlugin, nodeHttpPlugin, listenerCapability, type RouteDefinition, type HttpOptions } from '@databehave/server'
import { adminPlugin, faultInjectionPlugin, faultControlCapability, type ScenariosStore, type Scenario } from '../src/index.js'
import { fileScenariosStore } from '../src/scenarios-store.js'

const hosts: Host[] = []
const dirs: string[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()))
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
const routePlugin = (routes: readonly RouteDefinition[]): Plugin => ({
  id: 'test.routes', apiVersion: 1, requires: [httpCapability],
  setup(ctx) { ctx.use(httpCapability).registerRoutes({ owner: 'test.routes', order: ctx.order, materialize: () => routes }) },
})
const start = async (plugins: Plugin[], options?: HttpOptions): Promise<Host> => {
  const host = createHost({ plugins: [httpPlugin(options), ...plugins] }); hosts.push(host); await host.start(); return host
}
const directory = async (): Promise<string> => { const dir = await mkdtemp(join(tmpdir(), 'dbh-admin-')); dirs.push(dir); return dir }
const sample = { id: 'saved', createdAt: '2026-01-01T00:00:00Z', matcher: { kind: 'global' }, mode: { kind: 'http-status', status: 503 } }
const request = (path: string, body?: unknown): Request => new Request(`http://local${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('explicit admin and fault composition', () => {
  it('HTTP alone has neither admin nor header faults', async () => {
    const host = await start([routePlugin([{ key: 'GET /ok', handler: () => ({ text: 'ok' }), priority: 'explicit' }])])
    expect((await host.get(httpCapability).fetch(new Request('http://local/ok', { headers: { 'x-mock-status': '503' } }))).status).toBe(200)
    expect((await host.get(httpCapability).fetch(request('/databehave'))).status).toBe(404)
  })
  it('admin requires a fault control provider', () => {
    expect(() => createHost({ plugins: [httpPlugin(), adminPlugin()] })).toThrow()
  })
  it('lists the resolved catalog and excludes admin routes, independent of configuration order', async () => {
    const host = await start([adminPlugin({}), faultInjectionPlugin(), routePlugin([
      { key: 'GET /x', handler: () => ({ text: 'explicit' }), priority: 'explicit' },
      { key: 'GET /x', handler: () => ({ text: 'generated' }), priority: 'generated', source: 'openapi', metadata: { summary: 'overridden' } },
      { key: 'POST /z', handler: () => ({ text: 'z' }), priority: 'generated', source: 'openapi', metadata: { summary: 'create' } },
    ])])
    const response = await host.get(httpCapability).fetch(request('/databehave/openapi-routes'))
    expect(await response.json()).toMatchObject({ features: { scenarios: false }, routes: [
      { method: 'GET', path: '/x', source: 'handler' }, { method: 'POST', path: '/z', source: 'openapi', summary: 'create' },
    ] })
  })
  it('admin remains operable under global faults and path prefixes are segment bounded', async () => {
    const host = await start([faultInjectionPlugin(), adminPlugin({ path: '/control' })])
    host.get(faultControlCapability).add({ matcher: { kind: 'global' }, mode: { kind: 'http-status', status: 503 } })
    expect((await host.get(httpCapability).fetch(request('/control/overrides'))).status).toBe(200)
    expect((await host.get(httpCapability).fetch(request('/controller'))).status).toBe(503)
    expect((await host.get(httpCapability).fetch(request('/control/scenarios'))).status).toBe(404)
    expect(() => host.get(faultControlCapability).excludePathPrefix('/later')).toThrow(/sealed/)
  })
  it('headers:false retains sticky faults, destroy:false returns 503, and hosts have independent state', async () => {
    const first = await start([faultInjectionPlugin({ headers: false, allowDestroy: false })])
    const second = await start([faultInjectionPlugin()])
    expect((await first.get(httpCapability).fetch(new Request('http://local/x', { headers: { 'x-mock-status': '503' } }))).status).toBe(404)
    first.get(faultControlCapability).add({ matcher: { kind: 'global' }, mode: { kind: 'destroy' } })
    expect((await first.get(httpCapability).fetch(request('/x'))).status).toBe(503)
    expect(second.get(faultControlCapability).list()).toEqual([])
  })
  it('rejects an unsafe mount path before registration', () => {
    for (const path of ['bad', '/bad"', '/a/../b', '/<script>']) expect(() => adminPlugin({ path })).toThrow(/path/)
  })
  it('refuses non-loopback bind before opening a socket; explicit exposure permits the intent', async () => {
    const probe = createServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
    const address = probe.address(); if (!address || typeof address === 'string') throw new Error('missing port')
    await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
    const host = createHost({ plugins: [httpPlugin(), nodeHttpPlugin({ host: '0.0.0.0', port: address.port }), faultInjectionPlugin(), adminPlugin()] })
    await expect(host.start()).rejects.toThrow(/loopback-only/)
    expect(host.get(listenerCapability).address).toBeUndefined()
    const exposed = await start([faultInjectionPlugin(), adminPlugin({ bind: 'any' })])
    await expect(exposed.get(httpCapability).checkBind({ host: '0.0.0.0', port: address.port })).resolves.toBeUndefined()
    for (const host of ['127.0.0.1', '::1', 'localhost']) {
      const local = await start([faultInjectionPlugin(), adminPlugin()])
      await expect(local.get(httpCapability).checkBind({ host, port: 0 })).resolves.toBeUndefined()
    }
  })
})

describe('scenario validation and atomic replacement', () => {
  it.each([null, { ...sample, mode: { kind: 'unknown' } }, { ...sample, matcher: null }])('invalid later HTTP entry preserves live state and the previous file: %j', async (bad) => {
    const dir = await directory()
    const host = await start([faultInjectionPlugin(), adminPlugin({ scenarios: fileScenariosStore({ dir }) })])
    const http = host.get(httpCapability); const faults = host.get(faultControlCapability)
    expect(await (await http.fetch(request('/databehave/openapi-routes'))).json()).toMatchObject({ features: { scenarios: true } })
    faults.add({ matcher: { kind: 'global' }, mode: { kind: 'http-status', status: 401 } })
    await http.fetch(request('/databehave/scenarios', { name: 'saved' }))
    const before = await readFile(join(dir, 'saved.json'), 'utf8'); const state = faults.list()
    const response = await http.fetch(request('/databehave/scenarios', { name: 'saved', overrides: [sample, bad] }))
    expect(response.status).toBe(400); expect(faults.list()).toEqual(state)
    expect(await readFile(join(dir, 'saved.json'), 'utf8')).toBe(before)
    expect(() => faults.replace([sample, bad])).toThrow(); expect(faults.list()).toEqual(state)
  })
  it.each(['{', JSON.stringify({ version: 2, overrides: [sample] }), JSON.stringify({ overrides: [sample, null] })])('invalid saved data cannot clear live state or modify its file: %s', async (content) => {
    const dir = await directory(); await writeFile(join(dir, 'saved.json'), content)
    const host = await start([faultInjectionPlugin(), adminPlugin({ scenarios: fileScenariosStore({ dir }) })]); const faults = host.get(faultControlCapability)
    faults.add({ matcher: { kind: 'global' }, mode: { kind: 'http-status', status: 401 } }); const state = faults.list()
    const response = await host.get(httpCapability).fetch(new Request('http://local/databehave/scenarios/saved/load', { method: 'POST' }))
    expect(response.status).toBe(400); expect(faults.list()).toEqual(state)
    expect(await readFile(join(dir, 'saved.json'), 'utf8')).toBe(content)
  })
  it('reads legacy unversioned files without rewriting and loads them atomically', async () => {
    const dir = await directory(); const content = JSON.stringify({ overrides: [sample] }); await writeFile(join(dir, 'legacy.json'), content)
    const host = await start([faultInjectionPlugin(), adminPlugin({ scenarios: fileScenariosStore({ dir }) })])
    const response = await host.get(httpCapability).fetch(new Request('http://local/databehave/scenarios/legacy/load', { method: 'POST' }))
    expect(response.status).toBe(200); expect(host.get(faultControlCapability).list()[0]?.mode).toEqual(sample.mode)
    expect(await readFile(join(dir, 'legacy.json'), 'utf8')).toBe(content)
  })
  it('cleans its owned temporary file after rename failure', async () => {
    const dir = await directory(); await mkdir(join(dir, 'blocked.json'))
    const store = fileScenariosStore({ dir })
    await expect(store.save('blocked', [])).rejects.toThrow()
    expect(await readdir(dir)).toEqual(['blocked.json'])
  })
})

it.each(['hang', 'delay'])('real socket %s cancels on disconnect and host shutdown', async (mode) => {
  let started: (() => void) | undefined
  let observed: (() => void) | undefined
  let entered = new Promise<void>((resolve) => { started = resolve })
  let finished = new Promise<void>((resolve) => { observed = resolve })
  const observer: Plugin = { id: 'test.observer', apiVersion: 1, requires: [httpCapability], setup(ctx) {
    const http = ctx.use(httpCapability)
    http.registerMiddleware({ owner: 'test.observer', order: ctx.order, stage: 'preflight', handle() { started?.() } })
    http.registerMiddleware({ owner: 'test.observer', order: ctx.order, stage: 'observation', handle() { observed?.() } })
  } }
  const host = await start([observer, faultInjectionPlugin(), nodeHttpPlugin({ port: 0 })], { drainTimeoutMs: 200 })
  const address = host.get(listenerCapability).address; if (!address) throw new Error('missing listener')
  const socket = connect(address.port, '127.0.0.1')
  socket.write(`GET /x HTTP/1.1\r\nHost: localhost:${address.port}\r\nx-mock-${mode}: ${mode === 'delay' ? '60000' : '1'}\r\n\r\n`)
  await entered; socket.destroy(); await finished
  entered = new Promise<void>((resolve) => { started = resolve }); finished = new Promise<void>((resolve) => { observed = resolve })
  const next = connect(address.port, '127.0.0.1'); next.on('error', () => undefined)
  next.write(`GET /x HTTP/1.1\r\nHost: localhost:${address.port}\r\nx-mock-${mode}: ${mode === 'delay' ? '60000' : '1'}\r\n\r\n`)
  await entered; await host.close(); await finished; next.destroy()
})

it('HEAD uses the effective GET route once and suppresses the injected body', async () => {
  const host = await start([faultInjectionPlugin(), routePlugin([{ key: 'GET /head', priority: 'explicit', handler: () => ({ text: 'handler' }) }])])
  host.get(faultControlCapability).add({ matcher: { kind: 'exact', method: 'GET', path: '/head' }, mode: { kind: 'http-status', status: 503 } })
  const response = await host.get(httpCapability).fetch(new Request('http://local/head', { method: 'HEAD' }))
  expect(response.status).toBe(503); expect(await response.text()).toBe('')
})

it('destroy terminates a real socket without a fabricated HTTP response', async () => {
  const host = await start([faultInjectionPlugin(), nodeHttpPlugin({ port: 0 })])
  const address = host.get(listenerCapability).address; if (!address) throw new Error('missing listener')
  const socket = connect(address.port, '127.0.0.1'); const chunks: Buffer[] = []
  socket.on('data', (chunk: Buffer) => chunks.push(chunk))
  const closed = new Promise<void>((resolve, reject) => { socket.once('close', () => resolve()); socket.once('error', reject) })
  socket.write(`GET /x HTTP/1.1\r\nHost: localhost:${address.port}\r\nx-mock-destroy: 1\r\n\r\n`)
  await closed; expect(Buffer.concat(chunks).length).toBe(0)
})

it('unsupported HTTP scenario versions cannot overwrite an existing file', async () => {
  const dir = await directory()
  const host = await start([faultInjectionPlugin(), adminPlugin({ scenarios: fileScenariosStore({ dir }) })])
  const http = host.get(httpCapability)
  await http.fetch(request('/databehave/scenarios', { name: 'saved', overrides: [] }))
  const before = await readFile(join(dir, 'saved.json'), 'utf8')
  const response = await http.fetch(request('/databehave/scenarios', { name: 'saved', version: 2, overrides: [] }))
  expect(response.status).toBe(400)
  expect(await readFile(join(dir, 'saved.json'), 'utf8')).toBe(before)
})

/** External storage provider: no filesystem assumptions or host capability registration. */
const memoryScenarios = (): ScenariosStore => {
  const saved = new Map<string, Scenario>()
  return {
    async list() { return [...saved.values()].map((scenario) => ({ name: scenario.name, count: scenario.overrides.length, created: scenario.created ?? '' })) },
    async get(name) { return saved.get(name) ?? null },
    async save(name, overrides) {
      const scenario: Scenario = { name, overrides, version: 1, created: '2026-01-01T00:00:00Z' }
      saved.set(name, scenario)
      return scenario
    },
    async remove(name) { return saved.delete(name) },
  }
}

it('supports an external in-memory store through the admin UI and scenario API', async () => {
  const scenarios = memoryScenarios()
  const host = await start([faultInjectionPlugin(), adminPlugin({ scenarios })])
  const http = host.get(httpCapability); const faults = host.get(faultControlCapability)
  faults.add({ matcher: { kind: 'global' }, mode: { kind: 'http-status', status: 503 } })
  expect((await http.fetch(request('/databehave'))).status).toBe(200)
  const saved = await http.fetch(request('/databehave/scenarios', { name: 'memory' }))
  expect(saved.status).toBe(201)
  expect(await scenarios.get('memory')).toMatchObject({ name: 'memory', version: 1 })
  expect(await (await http.fetch(request('/databehave/scenarios'))).json()).toMatchObject({ scenarios: [{ name: 'memory', count: 1 }] })
  expect((await http.fetch(request('/databehave/scenarios/memory'))).status).toBe(200)
  faults.clear()
  expect((await http.fetch(new Request('http://local/databehave/scenarios/memory/load', { method: 'POST' }))).status).toBe(200)
  expect(faults.list()[0]?.mode).toEqual({ kind: 'http-status', status: 503 })
  expect((await http.fetch(new Request('http://local/databehave/scenarios/memory', { method: 'DELETE' }))).status).toBe(200)
  expect(await scenarios.get('memory')).toBeNull()
})

it.each([
  undefined, false, [], { name: 4, overrides: [sample] },
  { name: 'invalid', version: 2, overrides: [sample] },
  { name: 'invalid', created: 4, overrides: [sample] },
  { name: 'invalid', overrides: [sample, null] },
  { name: 'invalid', overrides: [sample, { ...sample, mode: { kind: 'unknown' } }] },
])('validates the entire external provider result before replacing live state: %j', async (raw) => {
  const scenarios = memoryScenarios()
  // Simulate an untyped third-party provider violating its declared return contract.
  Object.defineProperty(scenarios, 'get', { value: async () => raw })
  const host = await start([faultInjectionPlugin(), adminPlugin({ scenarios })])
  const faults = host.get(faultControlCapability)
  faults.add({ matcher: { kind: 'global' }, mode: { kind: 'http-status', status: 401 } })
  const before = faults.list()
  const http = host.get(httpCapability)
  expect((await http.fetch(request('/databehave/scenarios/invalid'))).status).toBe(400)
  expect((await http.fetch(new Request('http://local/databehave/scenarios/invalid/load', { method: 'POST' }))).status).toBe(400)
  expect(faults.list()).toEqual(before)
})
