/**
 * Unit tests for the CLI helpers.
 *
 * The CLI entry script (`src/bin.ts`) only wires these helpers to
 * `process.argv` / spawn, so covering the helpers is sufficient to
 * pin the argv, URL composition, and opener-selection branches.
 */
import { describe, expect, it } from 'vitest'

import {
  composeAdminUrl,
  HELP_TEXT,
  parseCliArgs,
  resolveOpener,
} from '../src/bin-helpers.js'

describe('parseCliArgs', () => {
  it('returns defaults when no args are given', () => {
    expect(parseCliArgs([])).toEqual({
      open: false,
      help: false,
      unknown: [],
    })
  })

  it('captures the first positional as configPath', () => {
    const opts = parseCliArgs(['my.config.jsonc'])
    expect(opts.configPath).toBe('my.config.jsonc')
    expect(opts.open).toBe(false)
  })

  it('parses --open in any position', () => {
    expect(parseCliArgs(['--open', 'cfg.json'])).toMatchObject({
      open: true,
      configPath: 'cfg.json',
    })
    expect(parseCliArgs(['cfg.json', '--open'])).toMatchObject({
      open: true,
      configPath: 'cfg.json',
    })
  })

  it('parses -h and --help', () => {
    expect(parseCliArgs(['-h']).help).toBe(true)
    expect(parseCliArgs(['--help']).help).toBe(true)
  })

  it('collects unknown flags and surplus positionals', () => {
    const opts = parseCliArgs(['--bogus', 'cfg.json', 'extra'])
    expect(opts.unknown).toEqual(['--bogus', 'extra'])
    expect(opts.configPath).toBe('cfg.json')
  })

  it('treats --watch (removed in 0.5.0) as an unknown flag', () => {
    expect(parseCliArgs(['--watch', 'cfg.json']).unknown).toEqual(['--watch'])
  })

  it('exposes HELP_TEXT listing --open and omits --watch', () => {
    expect(HELP_TEXT).toMatch(/--open/)
    expect(HELP_TEXT).not.toMatch(/--watch/)
  })
})

describe('composeAdminUrl', () => {
  it('returns null when admin is undefined', () => {
    expect(composeAdminUrl({ host: '127.0.0.1', port: 8000 }, undefined)).toBeNull()
  })

  it('returns null when admin.enabled !== true (false)', () => {
    expect(
      composeAdminUrl({ host: '127.0.0.1', port: 8000 }, { enabled: false }),
    ).toBeNull()
  })

  it('returns null when admin.enabled is omitted', () => {
    expect(composeAdminUrl({ host: '127.0.0.1', port: 8000 }, {})).toBeNull()
  })

  it('uses the declared admin.path when enabled', () => {
    expect(
      composeAdminUrl(
        { host: '127.0.0.1', port: 8000 },
        { enabled: true, path: '/__admin__' },
      ),
    ).toBe('http://127.0.0.1:8000/__admin__')
  })

  it('defaults the path to /databehave', () => {
    expect(
      composeAdminUrl({ host: '127.0.0.1', port: 8000 }, { enabled: true }),
    ).toBe('http://127.0.0.1:8000/databehave')
  })

  it('rewrites the 0.0.0.0 wildcard to 127.0.0.1', () => {
    expect(
      composeAdminUrl(
        { host: '0.0.0.0', port: 8000 },
        { enabled: true, path: '/databehave' },
      ),
    ).toBe('http://127.0.0.1:8000/databehave')
  })

  it('rewrites the :: wildcard to 127.0.0.1', () => {
    expect(
      composeAdminUrl({ host: '::', port: 9000 }, { enabled: true }),
    ).toBe('http://127.0.0.1:9000/databehave')
  })

  it('falls back to /databehave when admin.path is an empty string', () => {
    expect(
      composeAdminUrl(
        { host: '127.0.0.1', port: 8000 },
        { enabled: true, path: '' },
      ),
    ).toBe('http://127.0.0.1:8000/databehave')
  })

  it('rewrites an empty host to 127.0.0.1', () => {
    expect(
      composeAdminUrl({ host: '', port: 8000 }, { enabled: true }),
    ).toBe('http://127.0.0.1:8000/databehave')
  })
})

describe('resolveOpener', () => {
  it('uses `open` on darwin', () => {
    expect(resolveOpener('darwin', 'http://x')).toEqual({
      cmd: 'open',
      args: ['http://x'],
    })
  })

  it('uses `cmd /c start "" <url>` on win32', () => {
    expect(resolveOpener('win32', 'http://x')).toEqual({
      cmd: 'cmd',
      args: ['/c', 'start', '', 'http://x'],
    })
  })

  it('falls back to `xdg-open` on other platforms', () => {
    expect(resolveOpener('linux', 'http://x')).toEqual({
      cmd: 'xdg-open',
      args: ['http://x'],
    })
    expect(resolveOpener('freebsd' as NodeJS.Platform, 'http://x').cmd).toBe(
      'xdg-open',
    )
  })
})
