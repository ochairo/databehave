import { ChildProcess, spawn } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHost, type Host, type Plugin } from '@databehave/core'
import { listenerCapability, type HttpBind } from '@databehave/server'
import { adminCapability } from '../src/admin-plugin.js'
import { openAdminBrowserPlugin, resolveBrowserCommand } from '../src/open-browser-plugin.js'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn(() => {
    const child = new actual.ChildProcess()
    vi.spyOn(child, 'kill').mockReturnValue(true)
    return child
  }) }
})
const hosts: Host[] = []
afterEach(async () => { await Promise.all(hosts.splice(0).map((host) => host.close())); vi.restoreAllMocks(); vi.mocked(spawn).mockClear() })
const start = async (address: HttpBind | undefined, ui = true): Promise<Host> => {
  const provider: Plugin = { id: 'test.bound-listener-and-admin', apiVersion: 1, provides: [listenerCapability, adminCapability], setup(ctx) {
    ctx.provide(listenerCapability, { address }); ctx.provide(adminCapability, { path: '/admin', ui })
  } }
  const host = createHost({ plugins: [openAdminBrowserPlugin(), provider] }); hosts.push(host); await host.start(); return host
}

describe('explicit browser opener', () => {
  it('selects platform commands without a shell', () => {
    expect(resolveBrowserCommand('darwin')).toBe('open')
    expect(resolveBrowserCommand('win32')).toBe('explorer.exe')
    expect(resolveBrowserCommand('linux')).toBe('xdg-open')
  })
  it.each(['127.0.0.1', '0.0.0.0', '::', '::1'])('opens only the bound admin URL for %s', async (host) => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await start({ host, port: 4321 })
    const urlHost = host === '::1' ? '[::1]' : '127.0.0.1'
    expect(spawn).toHaveBeenCalledWith(resolveBrowserCommand(process.platform), [`http://${urlHost}:4321/admin`], { stdio: 'ignore', shell: false })
  })
  it('does nothing without a listener address or when the UI is disabled', async () => {
    await start(undefined); await start({ host: '127.0.0.1', port: 4321 }, false)
    expect(spawn).not.toHaveBeenCalled()
  })
  it('reports opener failure and disposes a still-running child', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const child = new ChildProcess(); const kill = vi.spyOn(child, 'kill').mockReturnValue(true)
    vi.mocked(spawn).mockReturnValueOnce(child)
    const host = await start({ host: '127.0.0.1', port: 4321 })
    child.emit('error', new Error('no opener'))
    expect(warn).toHaveBeenCalledWith('Unable to open admin browser: no opener')
    await host.close(); expect(kill).toHaveBeenCalledOnce()
  })
})
