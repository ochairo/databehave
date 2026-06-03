import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadConfig } from '../../src/json-config.js'

let dir: string
const writeJson = (name: string, obj: unknown): string => {
  const p = join(dir, name)
  writeFileSync(p, JSON.stringify(obj, null, 2))
  return p
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'db-kit-admin-cfg-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('loadConfig — admin pass-through', () => {
  it('threads admin through and supplements openapiBody from openapi file', async () => {
    const oas = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {},
    })
    const oasPath = join(dir, 'openapi.json')
    writeFileSync(oasPath, oas)
    const cfgPath = writeJson('cfg.json', {
      openapi: './openapi.json',
      admin: { enabled: true, path: '/_mock' },
    })
    const { config } = await loadConfig(cfgPath)
    expect(config.admin).toBeDefined()
    expect(config.admin?.enabled).toBe(true)
    expect(config.admin?.openapiBody).toBe(oas)
  })

  it('respects caller-provided openapiBody (does not overwrite)', async () => {
    const oas = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {},
    })
    writeFileSync(join(dir, 'openapi.json'), oas)
    const cfgPath = writeJson('cfg.json', {
      openapi: './openapi.json',
      admin: { enabled: true, openapiBody: '{"explicit":true}' },
    })
    const { config } = await loadConfig(cfgPath)
    expect(config.admin?.openapiBody).toBe('{"explicit":true}')
  })

  it('omits admin when not declared', async () => {
    const cfgPath = writeJson('cfg.json', {})
    const { config } = await loadConfig(cfgPath)
    expect(config.admin).toBeUndefined()
  })
})
