/**
 * File-backed scenarios registry.
 *
 * A *scenario* is a named JSON snapshot of one or more sticky
 * overrides. Scenarios live as `<name>.json` files inside the
 * explicitly configured directory. Names are
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
import { mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { validateOverrides, validateScenario, isValidScenarioName, ScenarioValidationError } from './validation.js'

import type { Scenario, ScenarioSummary } from './admin-types.js'
import type { ScenariosStore } from './scenarios.js'

/** Filesystem scope explicitly chosen by application composition. */
export interface FileScenariosStoreOptions {
  readonly dir: string
}

const isENOENT = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'

const parseScenario = (text: string, name: string): Scenario => {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new ScenarioValidationError('Malformed scenario JSON') }
  return validateScenario(raw, name)
}

/** Create a file adapter without reading, writing, or acquiring resources until called. */
export const fileScenariosStore = (
  opts: FileScenariosStoreOptions,
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
        const parsed = parseScenario(text, name)
        out.push({
          name,
          count: parsed.overrides.length,
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
      const parsed = parseScenario(text, name)
      return parsed
    } catch (err) {
      if (isENOENT(err)) return null
      throw err
    }
  }

  const save: ScenariosStore['save'] = async (name, overrides) => {
    if (!isValidScenarioName(name)) {
      throw new Error(`@databehave/admin: invalid scenario name: ${JSON.stringify(name)}`)
    }
    const validated = validateOverrides(overrides)
    const scenario: Scenario = {
      version: 1,
      name,
      overrides: validated,
      created: new Date().toISOString(),
    }
    const serialized = JSON.stringify(scenario, null, 2)
    await mkdir(dir, { recursive: true })
    const final = filePath(name)
    const tmp = `${final}.${randomBytes(6).toString('hex')}.tmp`
    const handle = await open(tmp, 'wx')
    try {
      try { await handle.writeFile(serialized, 'utf8') } finally { await handle.close() }
      await rename(tmp, final)
    } catch (error) {
      try { await unlink(tmp) } catch (cleanupError) {
        if (!isENOENT(cleanupError)) throw new AggregateError([error, cleanupError], 'Scenario save and temporary cleanup failed')
      }
      throw error
    }
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

  return { list, get, save, remove }
}
