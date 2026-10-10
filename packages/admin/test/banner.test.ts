import { describe, expect, it, vi } from 'vitest'

import {
  emitAdminBanner,
  formatAdminBanner,
} from '../src/banner.js'

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
    expect(info.mock.calls[0]![0]).toContain('admin panel ready')
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

})
