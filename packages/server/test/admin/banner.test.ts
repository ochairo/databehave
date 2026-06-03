import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createServer,
  type ListenHandle,
} from '../../src/index.js'
import {
  emitAdminBanner,
  formatAdminBanner,
} from '../../src/admin/banner.js'

describe('admin banner', () => {
  it('format includes host/port/path + ready notice + dev mock label', () => {
    const msg = formatAdminBanner('127.0.0.1', 8000, '/_mock')
    expect(msg).toContain('admin panel ready')
    expect(msg).toContain('http://127.0.0.1:8000/_mock')
    expect(msg).toContain('dev mock')
  })

  it('emitAdminBanner routes through logger.info', () => {
    const info = vi.fn()
    emitAdminBanner('127.0.0.1', 9000, '/_admin', { info })
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][0]).toContain('admin panel ready')
  })

  it('emitAdminBanner uses console.info when no logger', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      emitAdminBanner('127.0.0.1', 1, '/_mock')
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  describe('integration', () => {
    let handle: ListenHandle | undefined
    afterEach(async () => {
      if (handle) await handle.close()
      handle = undefined
    })

    it('emits exactly once when admin enabled', async () => {
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
      try {
        const server = createServer({
          admin: { enabled: true },
        })
        handle = await server.listen({ port: 0, host: '127.0.0.1' })
        const enabled = spy.mock.calls.filter((c) =>
          String(c[0]).includes('admin panel ready'),
        )
        expect(enabled).toHaveLength(1)
      } finally {
        spy.mockRestore()
      }
    })

    it('does NOT emit when admin disabled', async () => {
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
      try {
        const server = createServer({})
        handle = await server.listen({ port: 0, host: '127.0.0.1' })
        const enabled = spy.mock.calls.filter((c) =>
          String(c[0]).includes('admin panel ready'),
        )
        expect(enabled).toHaveLength(0)
      } finally {
        spy.mockRestore()
      }
    })
  })
})
