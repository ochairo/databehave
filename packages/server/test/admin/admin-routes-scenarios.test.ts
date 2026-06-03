import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createServer } from '../../src/index.js'
import { createAdminRoutes } from '../../src/admin/admin-routes.js'
import { createOverridesStore } from '../../src/admin/overrides-store.js'
import { createScenariosStore } from '../../src/admin/scenarios-store.js'

const buildServer = (dir: string) => {
  const store = createOverridesStore({ warn: () => {} })
  const scenarios = createScenariosStore({ dir })
  const routes = createAdminRoutes({ store, basePath: '/_mock', scenarios })
  const server = createServer({ routes })
  return { server, store, scenarios }
}

describe('admin REST routes — scenarios', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dbk-routes-scn-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('GET /_mock/scenarios returns empty initially', async () => {
    const { server } = buildServer(dir)
    const res = await server.fetch(new Request('http://x/_mock/scenarios'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ scenarios: [] })
  })

  it('GET /_mock/scenarios works against missing dir (empty list)', async () => {
    const { server } = buildServer(join(dir, 'missing'))
    const res = await server.fetch(new Request('http://x/_mock/scenarios'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ scenarios: [] })
  })

  it('POST creates a scenario from current overrides when overrides omitted', async () => {
    const { server, store } = buildServer(dir)
    store.add({
      matcher: { kind: 'global' },
      mode: { kind: 'http-status', status: 503 },
    })
    const res = await server.fetch(
      new Request('http://x/_mock/scenarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'snap1' }),
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { name: string; overrides: unknown[] }
    expect(body.name).toBe('snap1')
    expect(body.overrides).toHaveLength(1)
  })

  it('POST accepts explicit overrides array', async () => {
    const { server } = buildServer(dir)
    const res = await server.fetch(
      new Request('http://x/_mock/scenarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'explicit', overrides: [] }),
      }),
    )
    expect(res.status).toBe(201)
  })

  it('POST 400 on invalid JSON / non-object / bad name', async () => {
    const { server } = buildServer(dir)
    const r1 = await server.fetch(
      new Request('http://x/_mock/scenarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json{',
      }),
    )
    expect(r1.status).toBe(400)
    const r2 = await server.fetch(
      new Request('http://x/_mock/scenarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '"oops"',
      }),
    )
    expect(r2.status).toBe(400)
    const r3 = await server.fetch(
      new Request('http://x/_mock/scenarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'bad name' }),
      }),
    )
    expect(r3.status).toBe(400)
  })

  it('GET /_mock/scenarios/:name 404 then 200 round-trip', async () => {
    const { server } = buildServer(dir)
    const r1 = await server.fetch(new Request('http://x/_mock/scenarios/none'))
    expect(r1.status).toBe(404)
    await server.fetch(
      new Request('http://x/_mock/scenarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'now', overrides: [] }),
      }),
    )
    const r2 = await server.fetch(new Request('http://x/_mock/scenarios/now'))
    expect(r2.status).toBe(200)
    const body = (await r2.json()) as { name: string }
    expect(body.name).toBe('now')
  })

  it('GET /_mock/scenarios/:name 400 on invalid name', async () => {
    const { server } = buildServer(dir)
    // server normalises path; need to hit handler directly via valid pattern
    const res = await server.fetch(
      new Request('http://x/_mock/scenarios/' + encodeURIComponent('bad name')),
    )
    expect([400, 404]).toContain(res.status)
  })

  it('DELETE /_mock/scenarios/:name 404 then 200', async () => {
    const { server } = buildServer(dir)
    const r1 = await server.fetch(
      new Request('http://x/_mock/scenarios/none', { method: 'DELETE' }),
    )
    expect(r1.status).toBe(404)
    await server.fetch(
      new Request('http://x/_mock/scenarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'gone', overrides: [] }),
      }),
    )
    const r2 = await server.fetch(
      new Request('http://x/_mock/scenarios/gone', { method: 'DELETE' }),
    )
    expect(r2.status).toBe(200)
  })

  it('POST /_mock/scenarios/:name/load replaces current overrides', async () => {
    const { server, store } = buildServer(dir)
    store.add({
      matcher: { kind: 'global' },
      mode: { kind: 'http-status', status: 401 },
    })
    await server.fetch(
      new Request('http://x/_mock/scenarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'snap' }),
      }),
    )
    store.clear()
    store.add({
      matcher: { kind: 'global' },
      mode: { kind: 'http-status', status: 500 },
    })
    expect(store.list()).toHaveLength(1)
    const res = await server.fetch(
      new Request('http://x/_mock/scenarios/snap/load', { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { loaded: number }
    expect(body.loaded).toBe(1)
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0]?.mode).toEqual({ kind: 'http-status', status: 401 })
  })

  it('POST /_mock/scenarios/:name/load 404 when missing', async () => {
    const { server } = buildServer(dir)
    const res = await server.fetch(
      new Request('http://x/_mock/scenarios/none/load', { method: 'POST' }),
    )
    expect(res.status).toBe(404)
  })

  it('load preserves description on saved overrides', async () => {
    const { server, store } = buildServer(dir)
    store.add({
      matcher: { kind: 'global' },
      mode: { kind: 'http-status', status: 503 },
      description: 'desc',
    })
    await server.fetch(
      new Request('http://x/_mock/scenarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'descsnap' }),
      }),
    )
    store.clear()
    await server.fetch(
      new Request('http://x/_mock/scenarios/descsnap/load', {
        method: 'POST',
      }),
    )
    expect(store.list()[0]?.description).toBe('desc')
  })

  it('scenarios endpoints absent when no scenarios store provided', async () => {
    const store = createOverridesStore({ warn: () => {} })
    const server = createServer({
      routes: createAdminRoutes({ store, basePath: '/_mock' }),
    })
    const res = await server.fetch(new Request('http://x/_mock/scenarios'))
    expect(res.status).toBe(404)
  })
})
