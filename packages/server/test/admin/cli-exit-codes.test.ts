import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Subprocess regression guard for the CLI exit-code contract.
 *
 * The server's bind-policy check (admin enabled + non-loopback host without
 * `bind: "any"`) MUST reject `server.listen()`, propagate through the
 * `await` in `main()`, and fire `main().catch(() => process.exit(1))`.
 * A leak here would make CI silently succeed with no server running —
 * see https://github.com/ochairo/@databehave/server (CHANGELOG 0.3.x).
 *
 * Skipped when `dist/bin.js` is absent so `vitest --watch` does not
 * trigger a build. Run `pnpm build` first.
 *
 * Happy-path SIGINT cases are skipped on Windows where signal semantics
 * for spawned Node processes differ enough to make these smoke-level
 * assertions flaky.
 */

const cliPath = join(process.cwd(), 'dist', 'bin.js')
const hasDist = existsSync(cliPath)
const skipReason = hasDist
  ? null
  : 'dist/bin.js missing — run `pnpm build` to enable CLI subprocess tests'
const isWindows = process.platform === 'win32'

const describeCli = hasDist ? describe : describe.skip

let tmpDir: string

const writeConfig = (name: string, body: unknown): string => {
  const p = join(tmpDir, name)
  writeFileSync(p, JSON.stringify(body))
  return p
}

beforeAll(() => {
  if (skipReason) console.warn(`[cli-exit-codes] ${skipReason}`)
  tmpDir = mkdtempSync(join(tmpdir(), 'db-kit-cli-'))
})

afterAll(() => {
  // tmpdir entries are small JSON; OS cleanup is sufficient.
})

describeCli('cli exit codes', () => {
  it('exits non-zero with bind-policy error on stderr when admin+0.0.0.0', () => {
    const configPath = writeConfig('bind-bad.json', {
      server: { host: '0.0.0.0', port: 0 },
      endpoints: {
        'GET /ping': { response: { status: 200, json: { ok: true } } },
      },
      admin: { enabled: true },
    })

    const result = spawnSync('node', [cliPath, configPath], {
      encoding: 'utf8',
      timeout: 10_000,
    })

    expect(result.status).not.toBe(0)
    expect(result.status).not.toBeNull()
    expect(result.stderr).toMatch(/admin is enabled/)
    expect(result.stderr).toMatch(/0\.0\.0\.0/)
  })

  it('exits 2 with usage message when no config path is given', () => {
    const result = spawnSync('node', [cliPath], {
      encoding: 'utf8',
      timeout: 5_000,
    })
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/Usage: databehave-server/)
  })

  const itHappy = isWindows ? it.skip : it

  itHappy(
    'starts cleanly and exits 0 on SIGINT (no admin)',
    async () => {
      const configPath = writeConfig('plain.json', {
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

      const exit = new Promise<number | null>((resolve) => {
        child.on('exit', (code) => resolve(code))
      })

      await new Promise((r) => setTimeout(r, 500))
      child.kill('SIGINT')
      const code = await exit
      expect(code, stderrChunks.join('')).toBe(0)
    },
    15_000,
  )

  itHappy(
    'starts cleanly with admin + loopback and exits 0 on SIGINT',
    async () => {
      const configPath = writeConfig('admin-loopback.json', {
        server: { host: '127.0.0.1', port: 0 },
        endpoints: {
          'GET /ping': { response: { status: 200, json: { ok: true } } },
        },
        admin: { enabled: true },
      })

      const child = spawn('node', [cliPath, configPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const stderrChunks: string[] = []
      child.stderr.on('data', (b) => stderrChunks.push(String(b)))

      const exit = new Promise<number | null>((resolve) => {
        child.on('exit', (code) => resolve(code))
      })

      await new Promise((r) => setTimeout(r, 500))
      child.kill('SIGINT')
      const code = await exit
      expect(code, stderrChunks.join('')).toBe(0)
    },
    15_000,
  )
})
