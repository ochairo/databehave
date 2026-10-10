import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHost, type Host, type Plugin } from '@databehave/core'

/** A fresh composition for one application instance. */
export interface Configuration {
  readonly plugins: readonly Plugin[]
}

/** ESM configuration factories create independent plugin instances on each invocation. */
export type ConfigurationFactory = () => Configuration | Promise<Configuration>

/** Type-check a configuration factory without evaluating it or acquiring resources. */
export const defineConfig = (factory: ConfigurationFactory): ConfigurationFactory => factory

/** Explicit local configuration module and optional application lifetime cancellation. */
export interface RunOptions {
  readonly config: string
  readonly signal?: AbortSignal
}

/** Running host and cleanup of the caller's cancellation subscription. */
export interface RunHandle {
  readonly host: Host
  close(): Promise<void>
}

const isConfiguration = (value: unknown): value is Configuration => {
  if (value === null || typeof value !== 'object' || !('plugins' in value)) return false
  const plugins: unknown = value.plugins
  return Array.isArray(plugins) && plugins.every((plugin: unknown) =>
    plugin !== null && typeof plugin === 'object' &&
    'id' in plugin && typeof plugin.id === 'string' &&
    'apiVersion' in plugin && plugin.apiVersion === 1 &&
    'setup' in plugin && typeof plugin.setup === 'function')
}

const aborted = (): Error => new Error('Application startup was cancelled', { cause: 'aborted' })

/** Import only the explicitly selected local ESM module; plugins are trusted application code. */
export const run = async (options: RunOptions): Promise<RunHandle> => {
  if (options.signal?.aborted) throw aborted()
  const path = resolve(options.config)
  if (!path.endsWith('.mjs') && !path.endsWith('.js')) {
    throw new Error('Use an ESM .mjs or .js configuration exporting a default configuration factory; see the migration guide')
  }
  const module: { default?: unknown } = await import(pathToFileURL(path).href)
  if (typeof module.default !== 'function') {
    throw new Error('Configuration must export a default factory returning { plugins: [...] }')
  }
  const configuration: unknown = await module.default()
  if (!isConfiguration(configuration)) throw new Error('Configuration factory must return valid plugins')
  if (options.signal?.aborted) throw aborted()
  const host = createHost(configuration)
  let closing: Promise<void> | undefined
  const close = (): Promise<void> => {
    if (!closing) {
      options.signal?.removeEventListener('abort', onAbort)
      closing = host.close()
    }
    return closing
  }
  const onAbort = (): void => {
    // Observe rejection immediately; run()/the returned handle still retain and report it.
    void close().catch(() => {})
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    await host.start()
    if (options.signal?.aborted) {
      await close()
      throw aborted()
    }
    return { host, close }
  } catch (error) {
    options.signal?.removeEventListener('abort', onAbort)
    try { await close() } catch (cleanupError) {
      if (cleanupError === error) throw error
      throw new AggregateError([error, cleanupError], 'Application startup and cleanup failed', { cause: error })
    }
    throw error
  }
}

/** Validated CLI arguments; feature options belong to the selected plugins. */
export type CliArguments =
  | { readonly kind: 'help' }
  | { readonly kind: 'run'; readonly config: string }
  | { readonly kind: 'error'; readonly message: string }

export const parseArguments = (arguments_: readonly string[]): CliArguments => {
  if (arguments_.length === 1 && (arguments_[0] === '--help' || arguments_[0] === '-h')) return { kind: 'help' }
  if (arguments_.length !== 1 || !arguments_[0] || arguments_[0].startsWith('-')) {
    return { kind: 'error', message: 'Expected one ESM configuration path' }
  }
  return { kind: 'run', config: arguments_[0] }
}
