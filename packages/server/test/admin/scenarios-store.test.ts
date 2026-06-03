import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createScenariosStore,
  isValidScenarioName,
} from '../../src/admin/scenarios-store.js'
import type { StickyOverride } from '../../src/admin/admin-types.js'

const sample = (id = 'a'): StickyOverride => ({
  id,
  matcher: { kind: 'global' },
  mode: { kind: 'http-status', status: 503 },
  createdAt: '2026-01-01T00:00:00.000Z',
  description: 'sample',
})

describe('scenarios-store', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dbk-scn-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('isValidScenarioName accepts and rejects', () => {
    expect(isValidScenarioName('ok')).toBe(true)
    expect(isValidScenarioName('a_B-1')).toBe(true)
    expect(isValidScenarioName('')).toBe(false)
    expect(isValidScenarioName('a/b')).toBe(false)
    expect(isValidScenarioName('a'.repeat(65))).toBe(false)
    expect(isValidScenarioName('with space')).toBe(false)
  })

  it('list() on missing dir returns []', async () => {
    const store = createScenariosStore({ dir: join(dir, 'nope') })
    expect(await store.list()).toEqual([])
  })

  it('save then list then get round-trip', async () => {
    const store = createScenariosStore({ dir })
    const saved = await store.save('s1', [sample('1'), sample('2')])
    expect(saved.name).toBe('s1')
    expect(saved.overrides).toHaveLength(2)
    expect(saved.created).toMatch(/T.*Z$/)

    const list = await store.list()
    expect(list).toEqual([
      { name: 's1', count: 2, created: saved.created },
    ])

    const got = await store.get('s1')
    expect(got?.overrides).toHaveLength(2)
    expect(got?.created).toBe(saved.created)
  })

  it('save uses atomic rename (no leftover tmp files on success)', async () => {
    const store = createScenariosStore({ dir })
    await store.save('atomic', [sample('1')])
    const entries = await readdir(dir)
    expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0)
    expect(entries).toContain('atomic.json')
  })

  it('save rejects invalid names', async () => {
    const store = createScenariosStore({ dir })
    await expect(store.save('bad/name', [])).rejects.toThrow(/invalid/i)
  })

  it('get returns null for invalid + missing names', async () => {
    const store = createScenariosStore({ dir })
    expect(await store.get('bad/name')).toBeNull()
    expect(await store.get('does-not-exist')).toBeNull()
  })

  it('get returns null on malformed file rather than throw', async () => {
    const store = createScenariosStore({ dir })
    await writeFile(join(dir, 'broken.json'), 'not-json{', 'utf8')
    expect(await store.get('broken')).toBeNull()
  })

  it('list skips malformed files and non-scenario files', async () => {
    const store = createScenariosStore({ dir })
    await store.save('good', [sample('1')])
    await writeFile(join(dir, 'broken.json'), 'not-json{', 'utf8')
    await writeFile(join(dir, 'README.md'), '# notes', 'utf8')
    await writeFile(join(dir, 'bad name.json'), '{}', 'utf8')
    const list = await store.list()
    expect(list.map((s) => s.name)).toEqual(['good'])
  })

  it('list returns mtime as created when file lacks created field', async () => {
    const store = createScenariosStore({ dir })
    await writeFile(
      join(dir, 'plain.json'),
      JSON.stringify({ overrides: [sample('1')] }),
      'utf8',
    )
    const [entry] = await store.list()
    expect(entry?.created).toMatch(/T.*Z$/)
    expect(entry?.count).toBe(1)
  })

  it('list sorts alphabetically', async () => {
    const store = createScenariosStore({ dir })
    await store.save('z', [])
    await store.save('a', [])
    await store.save('m', [])
    expect((await store.list()).map((s) => s.name)).toEqual(['a', 'm', 'z'])
  })

  it('remove returns true on hit, false on miss / invalid name', async () => {
    const store = createScenariosStore({ dir })
    await store.save('toRemove', [sample()])
    expect(await store.remove('toRemove')).toBe(true)
    expect(await store.remove('toRemove')).toBe(false)
    expect(await store.remove('bad/name')).toBe(false)
  })

  it('save creates the directory on first write', async () => {
    const fresh = join(dir, 'nested', 'deep')
    const store = createScenariosStore({ dir: fresh })
    await store.save('first', [sample()])
    const text = await readFile(join(fresh, 'first.json'), 'utf8')
    const parsed = JSON.parse(text) as { name: string }
    expect(parsed.name).toBe('first')
  })

  it('treats overrides field defensively when reading', async () => {
    const store = createScenariosStore({ dir })
    await writeFile(
      join(dir, 'weird.json'),
      JSON.stringify({ overrides: 'not-an-array' }),
      'utf8',
    )
    const got = await store.get('weird')
    expect(got?.overrides).toEqual([])
  })

  it('list tolerates non-array overrides in file', async () => {
    const store = createScenariosStore({ dir })
    await writeFile(
      join(dir, 'oops.json'),
      JSON.stringify({ overrides: 'x', created: '2026-01-01T00:00:00.000Z' }),
      'utf8',
    )
    const [entry] = await store.list()
    expect(entry?.count).toBe(0)
  })
})
