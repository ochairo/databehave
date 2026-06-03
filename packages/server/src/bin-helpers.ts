/**
 * Pure helpers for the `@databehave/server` CLI.
 *
 * Everything in this module is side-effect-free (or accepts injected
 * side effects) so it can be unit-tested without spawning child
 * processes or opening sockets. The thin executable entry point
 * (`bin.ts`) wires these together.
 */
/** Parsed CLI invocation. `configPath` is the first positional arg. */
export interface CliOptions {
  open: boolean
  help: boolean
  configPath?: string
  unknown: string[]
}

export const HELP_TEXT = `Usage: databehave-server [options] <config>

Options:
  --open           After the server is listening, open the admin UI in
                   the default browser. No-op (with a log line) when
                   admin is absent or admin.enabled !== true.
  -h, --help       Show this help and exit.
`

/**
 * Parse argv (without `node` / script name). Unknown flags are
 * collected into `unknown` for the entry point to reject — we never
 * silently ignore an unrecognized option.
 */
export const parseCliArgs = (argv: readonly string[]): CliOptions => {
  const opts: CliOptions = {
    open: false,
    help: false,
    unknown: [],
  }
  for (const a of argv) {
    if (a === '--open') opts.open = true
    else if (a === '-h' || a === '--help') opts.help = true
    else if (a.startsWith('-')) opts.unknown.push(a)
    else if (opts.configPath === undefined) opts.configPath = a
    else opts.unknown.push(a)
  }
  return opts
}

/** Subset of the listen handle we need to build the admin URL. */
export interface ListenInfo {
  readonly host: string
  readonly port: number
}

/** Subset of the resolved admin config we care about for --open. */
export interface AdminUrlInfo {
  readonly enabled?: boolean
  readonly path?: string
}

/**
 * Build the URL `--open` should hit. Returns `null` when the admin
 * panel is not active (no `admin`, or `enabled !== true`) — the
 * caller surfaces that as a skip-with-log message. Hosts bound to
 * `0.0.0.0` / `::` are rewritten to the matching loopback so the
 * browser doesn't try to dial the wildcard.
 */
export const composeAdminUrl = (
  handle: ListenInfo,
  admin: AdminUrlInfo | undefined,
): string | null => {
  if (!admin || admin.enabled !== true) return null
  const host =
    handle.host === '0.0.0.0' || handle.host === '::' || handle.host === ''
      ? '127.0.0.1'
      : handle.host
  const path = typeof admin.path === 'string' && admin.path !== '' ? admin.path : '/databehave'
  return `http://${host}:${handle.port}${path}`
}

/** Platform-specific browser opener. Pure — returns the spawn args. */
export const resolveOpener = (
  platform: NodeJS.Platform,
  url: string,
): { cmd: string; args: string[] } => {
  if (platform === 'darwin') return { cmd: 'open', args: [url] }
  // On Windows, `start` is a `cmd.exe` builtin. The empty string is
  // the (required) window title — without it `start` treats the URL
  // as the title and opens nothing.
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '', url] }
  return { cmd: 'xdg-open', args: [url] }
}
