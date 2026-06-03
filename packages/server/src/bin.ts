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

  const handle: RunHandle = await run({
    config: opts.configPath,
    open: opts.open,
  })

  const shutdown = (signal: string): void => {
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
}

main().catch((err) => {
  console.error('[@databehave/server] failed to start', err)
  process.exit(1)
})
