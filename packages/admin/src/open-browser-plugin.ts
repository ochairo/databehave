import { spawn } from 'node:child_process'
import type { Plugin } from '@databehave/core'
import { listenerCapability } from '@databehave/server'
import { adminCapability } from './admin-plugin.js'
import { emitAdminBanner } from './banner.js'

/** Select an argument-based opener without a shell. */
export const resolveBrowserCommand = (platform: NodeJS.Platform): string =>
  platform === 'darwin' ? 'open' : platform === 'win32' ? 'explorer.exe' : 'xdg-open'

/** Explicit opt-in browser opener; application composition authorizes this local effect. */
export const openAdminBrowserPlugin = (): Plugin => ({
  id: 'databehave.admin.open-browser', apiVersion: 1,
  requires: [listenerCapability, adminCapability],
  setup() {},
  open(ctx) {
    const admin = ctx.use(adminCapability)
    const address = ctx.use(listenerCapability).address
    if (!admin.ui || !address) return
    const host = address.host === '0.0.0.0' || address.host === '::' ? '127.0.0.1' : address.host
    const urlHost = host.includes(':') ? `[${host}]` : host
    const url = `http://${urlHost}:${address.port}${admin.path}`
    emitAdminBanner(urlHost, address.port, admin.path)
    const command = resolveBrowserCommand(process.platform)
    const child = spawn(command, [url], { stdio: 'ignore', shell: false })
    ctx.defer(() => { if (child.exitCode === null) child.kill() })
    child.on('error', (error) => {
      // eslint-disable-next-line no-console
      console.warn(`Unable to open admin browser: ${error.message}`)
    })
    child.unref()
  },
})
