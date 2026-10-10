import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as nodeRequest } from 'node:http'
import { createHost } from '@databehave/core'
import { corsPlugin, httpPlugin, listenerCapability, nodeHttpPlugin, routesPlugin } from '@databehave/server'
import { describe, expect, it } from 'vitest'
import { adminPlugin, faultControlCapability, faultInjectionPlugin, fileScenariosStore, type AdminModeCors } from '../src/index.js'

const policies: AdminModeCors[] = ['same-origin', 'auto', { origin: ['https://allowed.example', 'https://second.example'] }]

describe('admin origin policy through real HTTP and general CORS', () => {
  for (const cors of ['same-origin', { origin: ['https://allowed.example'] }] as const) {
    it(`rejects forged authority before ${JSON.stringify(cors)} admin mutations`, async () => {
      const host = createHost({ plugins: [httpPlugin(), faultInjectionPlugin(),
        adminPlugin({ cors, ui: false }), nodeHttpPlugin({ host: '127.0.0.1', port: 0 })] })
      await host.start()
      try {
        const address = host.get(listenerCapability).address
        if (!address) throw new Error('Listener did not open')
        const attacker = `attacker.example:${address.port}`
        const send = (authority: string): Promise<number> => new Promise((resolve, reject) => {
          const request = nodeRequest({ host: '127.0.0.1', port: address.port,
            method: 'POST', path: '/databehave/overrides', agent: false,
            headers: { host: authority, origin: `http://${attacker}`, 'content-type': 'text/plain' },
          }, response => {
            response.resume()
            response.on('error', reject)
            response.on('end', () => resolve(response.statusCode ?? 0))
          })
          request.on('error', reject)
          request.end(JSON.stringify({ matcher: { kind: 'global' }, mode: { kind: 'http-status', status: 503 } }))
        })
        expect(await send(`127.0.0.1:${address.port}`)).toBe(403)
        expect(await send(attacker)).toBe(421)
        expect(host.get(faultControlCapability).list()).toEqual([])
      } finally { await host.close() }
    })
  }
  for (const corsFirst of [true, false]) for (const cors of policies) {
    it(`preserves ${JSON.stringify(cors)} policy with general CORS ${corsFirst ? 'first' : 'last'}`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'databehave-cors-'))
      const storage = fileScenariosStore({ dir: directory })
      const admin = adminPlugin({ path: '/control', bind: 'any', cors, scenarios: storage })
      const host = createHost({ plugins: [
        httpPlugin(), faultInjectionPlugin(), routesPlugin({ 'GET /data': () => ({ json: { ok: true } }) }),
        ...(corsFirst ? [corsPlugin(), admin] : [admin, corsPlugin()]),
        nodeHttpPlugin({ host: '127.0.0.1', port: 0 }),
      ] })
      try {
        await host.start()
        const base = `http://127.0.0.1:${host.get(listenerCapability).address?.port}`
        const faults = host.get(faultControlCapability)
        faults.add({ matcher: { kind: 'global' }, mode: { kind: 'http-status', status: 502 } })
        await storage.save('existing', faults.list())
        const original = await readFile(join(directory, 'existing.json'), 'utf8')
        const rejected: [string, string, string | undefined][] = [
          ['GET', '/control/overrides', undefined], ['HEAD', '/control/overrides', undefined],
          ['DELETE', '/control/overrides', undefined], ['DELETE', '/control/scenarios/existing', undefined],
          ['POST', '/control/overrides', JSON.stringify({ matcher: { kind: 'global' }, mode: { kind: 'http-status', status: 503 } })],
          ['OPTIONS', '/control/overrides', undefined], ['OPTIONS', '/control/unknown', undefined],
        ]
        for (const [method, path, body] of rejected) {
          const response = await fetch(base + path, {
            method, headers: { origin: 'https://attacker.example', 'content-type': 'text/plain', 'access-control-request-method': 'DELETE' },
            ...(body === undefined ? {} : { body }),
          })
          expect(response.status).toBe(403)
          expect(response.headers.has('access-control-allow-origin')).toBe(false)
        }
        for (const origin of ['null', '', 'bad-origin', 'https://allowed.example/path']) {
          const response = await fetch(`${base}/control/overrides`, { headers: { origin } })
          expect(response.status).toBe(403)
          expect(response.headers.has('access-control-allow-origin')).toBe(false)
        }
        expect(faults.list()).toHaveLength(1)
        expect(await readFile(join(directory, 'existing.json'), 'utf8')).toBe(original)
        expect((await fetch(`${base}/control/overrides`)).status).toBe(200)
        expect((await fetch(`${base}/control/overrides`, { headers: { origin: base } })).status).toBe(200)
        const app = await fetch(`${base}/data`, { headers: { origin: 'https://attacker.example' } })
        expect(app.headers.get('access-control-allow-origin')).toBe('https://attacker.example')
        const permitted = typeof cors === 'object' ? 'https://second.example' : base
        const preflight = await fetch(`${base}/control/overrides`, { method: 'OPTIONS', headers: { origin: permitted, 'access-control-request-method': 'DELETE' } })
        expect(preflight.status).toBe(204)
        expect(preflight.headers.get('access-control-allow-origin')).toBe(typeof cors === 'object' ? permitted : null)
        const unknown = await fetch(`${base}/control/unknown`, { method: 'OPTIONS', headers: { origin: permitted, 'access-control-request-method': 'DELETE' } })
        expect(unknown.status).toBe(404)
        const plainOptions = await fetch(`${base}/control/overrides`, { method: 'OPTIONS' })
        expect(plainOptions.status).toBe(404)
      } finally {
        await host.close()
        await rm(directory, { recursive: true, force: true })
      }
    })
  }
})
