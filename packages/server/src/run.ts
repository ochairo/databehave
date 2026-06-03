/**
 * Programmatic `run()` entry — boots the kit's HTTP server from a
 * JSONC config file and optionally opens the admin UI in the default
 * browser after `listening` is observed.
 *
 * This is the implementation that both `bin.ts` (CLI) and direct
 * library consumers route through. Keeping a single code path here
 * means the binary and the `import { run } from '@databehave/server'`
 * surface behave identically (same log lines, same error model).
 *
 * `RunHandle.close()` is idempotent.
 *
 * The kit ships no watcher. Use `tsx watch server.ts` (or any
 * process supervisor) in dev — see README.
 */
import { spawn } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'

import { composeAdminUrl, resolveOpener } from './bin-helpers.js'
import { loadConfig } from './json-config.js'
import { createServer } from './server.js'
import type { ListenHandle } from './types.js'

/** Options accepted by `run()`. */
export interface RunOptions {
  /** Path to the databehave config (JSONC). Resolved relative to `process.cwd()`. */
  config: string
  /**
   * After the server emits `listening`, open the admin URL in the
   * default browser. No-op (with a log line) when `admin` is
   * absent or `admin.enabled !== true`. Default: `false`.
   *
   * ORed with `admin.openBrowserOnStart` from the resolved
   * config — either trigger launches the browser exactly once.
   */
  open?: boolean
}

/** Handle returned by `run()`. */
export interface RunHandle {
  /** The bound HTTP URL, e.g. `"http://127.0.0.1:8000"`. */
  url: string
  /** Stop the server. Idempotent: a second call is a no-op. Resolves once the port is free. */
  close(): Promise<void>
}

/** Spawn the platform browser opener detached, log on failure. */
const openInBrowser = (url: string): void => {
  const { cmd, args } = resolveOpener(process.platform, url)
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
    child.on('error', (err) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[@databehave/server] could not open browser (${cmd}): ${msg}`)
    })
    child.unref()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[@databehave/server] could not open browser (${cmd}): ${msg}`)
  }
}

/**
 * Boot a single server instance from the JSONC config at `configPath`.
 * Logs the standard `listening on …` line and, when `open` is set,
 * the `--open: …` URL (or the admin-disabled skip line).
 */
const bootOnce = async (
  configPath: string,
  open: boolean,
): Promise<ListenHandle> => {
  const { config, server: listenOpts } = await loadConfig(configPath)
  const server = createServer(config)
  const handle = await server.listen(listenOpts)
  console.info(`[@databehave/server] listening on http://${handle.host}:${handle.port}`)
  const shouldOpen = open || config.admin?.openBrowserOnStart === true
  if (shouldOpen) {
    const url = composeAdminUrl(handle, config.admin)
    if (url === null) {
      console.info(
        '[@databehave/server] --open: admin is not enabled — not opening browser',
      )
    } else {
      console.info(`[@databehave/server] --open: ${url}`)
      openInBrowser(url)
    }
  }
  return handle
}

/**
 * Programmatic entry. Resolves AFTER the server has emitted
 * `listening`.
 */
export const run = async (opts: RunOptions): Promise<RunHandle> => {
  const configPath = isAbsolute(opts.config)
    ? opts.config
    : resolve(process.cwd(), opts.config)
  const open = opts.open === true

  const handle: ListenHandle = await bootOnce(configPath, open)
  const url = `http://${handle.host}:${handle.port}`

  let closed = false
  return {
    url,
    async close(): Promise<void> {
      if (closed) return
      closed = true
      try {
        await handle.close()
      } catch {
        // best-effort during shutdown
      }
    },
  }
}
