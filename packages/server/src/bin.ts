#!/usr/bin/env node
/**
 * `@databehave/server` CLI — thin wrapper around the programmatic
 * `run()` entry. Parses argv, delegates lifecycle to `run()`, and
 * wires `SIGINT` / `SIGTERM` to the returned `RunHandle.close()`.
 *
 * All server / opener wiring lives in `./run.ts`, so
 * `import { run } from '@databehave/server'` and `npx @databehave/server …`
 * are observationally equivalent (same log lines, same error model).
 *
 * Flags:
 *
 *   --open           After `listening`, open the admin URL.
 *   -h, --help       Print usage and exit 0.
 *
 * Exit codes: 0 on clean shutdown, 1 on bootstrap failure, 2 on bad
 * usage (unknown flag or missing config path).
 */
import { HELP_TEXT, parseCliArgs } from './bin-helpers.js'
import { run, type RunHandle } from './run.js'

const isAbortLikeError = (err: unknown): boolean => {
  if (err instanceof Error && err.name === 'AbortError') return true
  if (typeof err !== 'object' || err === null) return false
  const maybeCode = (err as { code?: unknown }).code
  const maybeName = (err as { name?: unknown }).name
  return maybeCode === 'ABORT_ERR' || maybeName === 'AbortError'
}

const main = async (): Promise<void> => {
  const opts = parseCliArgs(process.argv.slice(2))
  if (opts.help) {
    process.stdout.write(HELP_TEXT)
    return
  }
  if (opts.unknown.length > 0) {
    console.error(
      `[@databehave/server] unknown option(s): ${opts.unknown.join(' ')}`,
    )
    process.stderr.write(HELP_TEXT)
    process.exit(2)
  }
  if (!opts.configPath) {
    process.stderr.write(HELP_TEXT)
    process.exit(2)
  }

  let handle: RunHandle | null = null
  let pendingSignal: string | null = null
  let shuttingDown = false

  const shutdown = (signal: string): void => {
    if (shuttingDown) return
    if (handle === null) {
      pendingSignal = signal
      return
    }
    shuttingDown = true
    console.info(`[@databehave/server] shutting down (${signal})`)
    handle
      .close()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error('[@databehave/server] failed to close', err)
        process.exit(1)
      })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  try {
    handle = await run({
      config: opts.configPath,
      open: opts.open,
    })
    if (pendingSignal !== null) shutdown(pendingSignal)
  } catch (err) {
    if (pendingSignal !== null && isAbortLikeError(err)) {
      process.exit(0)
    }
    throw err
  }
}

main().catch((err) => {
  console.error('[@databehave/server] failed to start', err)
  process.exit(1)
})
