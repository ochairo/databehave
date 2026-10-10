#!/usr/bin/env node
import { parseArguments, run } from './index.js'

const usage = 'Usage: databehave <config.mjs>\n       databehave --help\n'
const arguments_ = parseArguments(process.argv.slice(2))
if (arguments_.kind === 'help') process.stdout.write(usage)
else if (arguments_.kind === 'error') {
  process.stderr.write(`${arguments_.message}\n${usage}`)
  process.exitCode = 2
} else {
  const lifetime = new AbortController()
  const stop = (): void => lifetime.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  // A composition with no remaining active resources should dispose and exit successfully.
  process.once('beforeExit', stop)
  try {
    const handle = await run({ config: arguments_.config, signal: lifetime.signal })
    process.stdout.write('[databehave] ready\n')
    if (!lifetime.signal.aborted) {
      await new Promise<void>(resolve => lifetime.signal.addEventListener('abort', () => resolve(), { once: true }))
    }
    await handle.close()
  } catch (error) {
    if (!(lifetime.signal.aborted && error instanceof Error &&
          (error.cause === 'aborted' || error.message === 'Host closed during startup'))) {
      console.error('[databehave] failed:', error)
      process.exitCode = 1
    }
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    process.removeListener('beforeExit', stop)
  }
}
