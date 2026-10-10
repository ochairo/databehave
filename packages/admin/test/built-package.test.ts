import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { createHost } from '@databehave/core'
import { httpCapability, httpPlugin } from '@databehave/server'
import { adminPlugin, faultInjectionPlugin } from '@databehave/admin'

it('the emitted public package serves its exported production assets', async () => {
  const host = createHost({ plugins: [httpPlugin(), faultInjectionPlugin(), adminPlugin({})] })
  try {
    await host.start()
    const response = await host.get(httpCapability).fetch(new Request('http://local/databehave'))
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('src="/databehave/ui.js"')
    const require = createRequire(import.meta.url)
    const exportedAsset = require.resolve('@databehave/admin/assets/ui.js')
    expect((await readFile(exportedAsset, 'utf8')).length).toBeGreaterThan(100)
  } finally { await host.close() }
})
