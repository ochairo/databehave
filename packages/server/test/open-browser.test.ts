/**
 * Tests for the config-driven `admin.openBrowserOnStart` flag.
 *
 * The browser opener spawns a detached child process via
 * `node:child_process`; we mock the whole module so the tests can
 * assert the call shape without actually launching `open` /
 * `xdg-open` / `cmd start`. The mock is scoped to this file so other
 * suites (e.g. `programmatic.test.ts` CLI smoke) keep the real
 * implementation.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.fn(() => ({
  on: vi.fn(),
  unref: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

const { run } = await import('../src/run.js')

const writeJsonConfig = async (path: string, body: unknown): Promise<void> => {
  await writeFile(path, JSON.stringify(body, null, 2), 'utf8')
}

let tmp: string

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'db-kit-open-'))
})

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true })
})

afterEach(() => {
  spawnMock.mockClear()
})

const captureInfo = (): { lines: string[]; restore: () => void } => {
  const lines: string[] = []
  const orig = console.info
  console.info = (...args: unknown[]): void => {
    lines.push(args.map((a) => String(a)).join(' '))
  }
  return {
    lines,
    restore: (): void => {
      console.info = orig
    },
  }
}

describe('admin.openBrowserOnStart (default: false)', () => {
  it('does not spawn a browser when the flag is omitted and --open is not passed', async () => {
    const configPath = join(tmp, 'default-no-open.json')
    await writeJsonConfig(configPath, {
      server: { host: '127.0.0.1', port: 0 },
      admin: { enabled: true, path: '/databehave' },
      endpoints: {
        'GET /health': { response: { status: 200, json: { ok: true } } },
      },
    })

    const cap = captureInfo()
    try {
      const handle = await run({ config: configPath })
      expect(spawnMock).not.toHaveBeenCalled()
      expect(cap.lines.some((l) => /--open:/.test(l))).toBe(false)
      expect(cap.lines.some((l) => /listening on http:\/\//.test(l))).toBe(true)
      await handle.close()
    } finally {
      cap.restore()
    }
  }, 10_000)

  it('does not spawn a browser when the flag is explicitly false', async () => {
    const configPath = join(tmp, 'flag-false.json')
    await writeJsonConfig(configPath, {
      server: { host: '127.0.0.1', port: 0 },
      admin: {
        enabled: true,
        path: '/databehave',
        openBrowserOnStart: false,
      },
      endpoints: {
        'GET /health': { response: { status: 200, json: { ok: true } } },
      },
    })

    const cap = captureInfo()
    try {
      const handle = await run({ config: configPath })
      expect(spawnMock).not.toHaveBeenCalled()
      await handle.close()
    } finally {
      cap.restore()
    }
  }, 10_000)
})

describe('admin.openBrowserOnStart: true', () => {
  it('spawns the platform opener exactly once with the resolved admin URL', async () => {
    const configPath = join(tmp, 'flag-true.json')
    await writeJsonConfig(configPath, {
      server: { host: '127.0.0.1', port: 0 },
      admin: {
        enabled: true,
        path: '/databehave',
        openBrowserOnStart: true,
      },
      endpoints: {
        'GET /health': { response: { status: 200, json: { ok: true } } },
      },
    })

    const cap = captureInfo()
    try {
      const handle = await run({ config: configPath })

      expect(spawnMock).toHaveBeenCalledTimes(1)
      const args = spawnMock.mock.calls[0] as unknown as [
        string,
        string[],
        unknown,
      ]
      const spawnedUrl = args[1][args[1].length - 1]
      expect(spawnedUrl).toMatch(
        /^http:\/\/127\.0\.0\.1:\d+\/databehave$/,
      )
      expect(cap.lines.some((l) => /\[@databehave\/server\] --open: http:/.test(l))).toBe(true)
      await handle.close()
    } finally {
      cap.restore()
    }
  }, 10_000)
})
