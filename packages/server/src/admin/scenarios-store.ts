/**
 * File-backed scenarios registry.
 *
 * A *scenario* is a named JSON snapshot of one or more sticky
 * overrides. Scenarios live as `<name>.json` files inside the
 * configured directory (default `<cwd>/mock-scenarios`). Names are
 * sanitised — only `[A-Za-z0-9_-]`, max 64 chars — so they map
 * directly to safe filenames and round-trip through HTTP path
 * segments without escaping.
 *
 * The directory is opt-in: a missing dir yields an empty list rather
 * than throwing. The first save creates the dir.
 *
 * Writes are atomic: write to `<name>.json.<tmp>` then rename, so a
 * partial write never produces a half-parsed file.
 */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Scenario, ScenarioSummary, StickyOverride } from './admin-types.js'

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/

export const isValidScenarioName = (name: string): boolean => NAME_RE.test(name)

export interface ScenariosStore {
  readonly dir: string
  list(): Promise<ScenarioSummary[]>
  get(name: string): Promise<Scenario | null>
  save(name: string, overrides: readonly StickyOverride[]): Promise<Scenario>
  remove(name: string): Promise<boolean>
}

interface CreateScenariosStoreOptions {
  readonly dir: string
}

const isENOENT = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'

export const createScenariosStore = (
  opts: CreateScenariosStoreOptions,
): ScenariosStore => {
  const { dir } = opts

  const filePath = (name: string): string => join(dir, `${name}.json`)

  const list: ScenariosStore['list'] = async () => {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch (err) {
      if (isENOENT(err)) return []
      throw err
    }
    const out: ScenarioSummary[] = []
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      const name = entry.slice(0, -5)
      if (!isValidScenarioName(name)) continue
      try {
        const full = join(dir, entry)
        const [text, st] = await Promise.all([readFile(full, 'utf8'), stat(full)])
        const parsed = JSON.parse(text) as Scenario
        out.push({
          name,
          count: Array.isArray(parsed.overrides) ? parsed.overrides.length : 0,
          created: parsed.created ?? st.mtime.toISOString(),
        })
      } catch {
        // skip unreadable / malformed files; the UI still works.
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name))
    return out
  }

  const get: ScenariosStore['get'] = async (name) => {
    if (!isValidScenarioName(name)) return null
    try {
      const text = await readFile(filePath(name), 'utf8')
      const parsed = JSON.parse(text) as Scenario
      return {
        name,
        overrides: Array.isArray(parsed.overrides) ? parsed.overrides : [],
        ...(parsed.created !== undefined ? { created: parsed.created } : {}),
      }
    } catch (err) {
      if (isENOENT(err)) return null
      return null
    }
  }

  const save: ScenariosStore['save'] = async (name, overrides) => {
    if (!isValidScenarioName(name)) {
      throw new Error(`@databehave/server: invalid scenario name: ${JSON.stringify(name)}`)
    }
    await mkdir(dir, { recursive: true })
    const scenario: Scenario = {
      name,
      overrides: [...overrides],
      created: new Date().toISOString(),
    }
    const final = filePath(name)
    const tmp = `${final}.${randomBytes(6).toString('hex')}.tmp`
    await writeFile(tmp, JSON.stringify(scenario, null, 2), 'utf8')
    await rename(tmp, final)
    return scenario
  }

  const remove: ScenariosStore['remove'] = async (name) => {
    if (!isValidScenarioName(name)) return false
    try {
      await unlink(filePath(name))
      return true
    } catch (err) {
      if (isENOENT(err)) return false
      throw err
    }
  }

  return { dir, list, get, save, remove }
}
