/**
 * Programmatic `run()` smoke tests + CLI smoke.
 *
 * Covers:
 *   - boot via `run({ config })`, `/health` round-trip, `close()`
 *     frees the port (re-bind succeeds).
 *   - `open: true` without `admin` logs the skip line and does
 *     not spawn a browser.
 *   - the binary still parses `--help` and rejects an unknown flag
 *     with exit 2 (mirrors `test/admin/cli-exit-codes.test.ts` shape).
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { run } from '../src/run.js'

const writeJsonConfig = async (path: string, body: unknown): Promise<void> => {
  await writeFile(path, JSON.stringify(body, null, 2), 'utf8')
}

const probePort = (port: number, host: string): Promise<boolean> =>
  new Promise((resolve) => {
    const s = createServer()
    s.once('error', () => resolve(false))
    s.listen(port, host, () => {
      s.close(() => resolve(true))
    })
  })

let tmp: string

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'db-kit-run-'))
})

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('run()', () => {
  it('boots, serves /health (declared route), and frees the port on close', async () => {
    const configPath = join(tmp, 'plain.json')
    await writeJsonConfig(configPath, {
      server: { host: '127.0.0.1', port: 0 },
      endpoints: {
        'GET /health': { response: { status: 200, json: { ok: true } } },
      },
    })

    const handle = await run({ config: configPath })
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

    const res = await fetch(`${handle.url}/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)

    const port = Number(handle.url.split(':').pop())
    await handle.close()
    // idempotent
    await handle.close()

    expect(await probePort(port, '127.0.0.1')).toBe(true)
  }, 15_000)

  it('open:true without admin logs the skip line (no browser spawn)', async () => {
    const configPath = join(tmp, 'open-skip.json')
    await writeJsonConfig(configPath, {
      server: { host: '127.0.0.1', port: 0 },
      endpoints: {
        'GET /health': { response: { status: 200, json: { ok: true } } },
      },
    })

    const infoLines: string[] = []
    const origInfo = console.info
    console.info = (...args: unknown[]): void => {
      infoLines.push(args.map((a) => String(a)).join(' '))
      origInfo(...(args as Parameters<typeof origInfo>))
    }

    try {
      const handle = await run({ config: configPath, open: true })
      expect(
        infoLines.some((l) => /--open: admin is not enabled/.test(l)),
      ).toBe(true)
      await handle.close()
    } finally {
      console.info = origInfo
    }
  }, 10_000)

})

const cliPath = join(process.cwd(), 'dist', 'bin.js')
const hasDist = existsSync(cliPath)
const describeCli = hasDist ? describe : describe.skip

describeCli('bin smoke (after `pnpm build`)', () => {
  it('--help prints usage and exits 0', () => {
    const result = spawnSync('node', [cliPath, '--help'], {
      encoding: 'utf8',
      timeout: 5_000,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/Usage: databehave-server/)
    expect(result.stdout).toMatch(/--open/)
    expect(result.stdout).not.toMatch(/--watch/)
  })

  it('rejects an unknown flag with exit 2', () => {
    const result = spawnSync('node', [cliPath, '--bogus', 'cfg.json'], {
      encoding: 'utf8',
      timeout: 5_000,
    })
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/unknown option/)
  })

  it('boots and exits 0 on SIGINT (smoke)', async () => {
    if (process.platform === 'win32') return
    const configPath = join(tmp, 'bin-smoke.json')
    await writeJsonConfig(configPath, {
      server: { host: '127.0.0.1', port: 0 },
      endpoints: {
        'GET /ping': { response: { status: 200, json: { ok: true } } },
      },
    })
    const child = spawn('node', [cliPath, configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stderrChunks: string[] = []
    child.stderr.on('data', (b) => stderrChunks.push(String(b)))
    const exit = new Promise<number | null>((resolve) =>
      child.on('exit', (code) => resolve(code)),
    )
    await new Promise((r) => setTimeout(r, 500))
    child.kill('SIGINT')
    const code = await exit
    expect(code, stderrChunks.join('')).toBe(0)
  }, 15_000)
})
