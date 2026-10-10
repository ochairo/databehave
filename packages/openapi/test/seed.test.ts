import { describe, expect, it } from 'vitest'

import { seedFor } from '../src/index.js'

describe('seedFor', () => {
  it('returns just the endpoint when no extra fields are provided', () => {
    expect(seedFor({ endpoint: '/api/v1/foo' })).toBe('/api/v1/foo')
  })

  it('appends sorted extras as `k=v|k=v`', () => {
    expect(
      seedFor({
        endpoint: '/api/v1/foo',
        extra: { b: 'B', a: 1, c: true },
      }),
    ).toBe('/api/v1/foo|a=1|b=B|c=true')
  })

  it('appends date= and day= in canonical order', () => {
    expect(
      seedFor({
        endpoint: '/api/v1/foo',
        from: '2024-04-01',
        dayOffset: 3,
        extra: { x: '1' },
      }),
    ).toBe('/api/v1/foo|x=1|date=2024-04-01|day=3')
  })

  it('is order-insensitive in the extras object', () => {
    const a = seedFor({ endpoint: '/e', extra: { a: 1, b: 2 } })
    const b = seedFor({ endpoint: '/e', extra: { b: 2, a: 1 } })
    expect(a).toBe(b)
  })

  it('JSON-stringifies object / array extras so distinct shapes differ', () => {
    const a = seedFor({ endpoint: '/e', extra: { filter: { id: 1 } } })
    const b = seedFor({ endpoint: '/e', extra: { filter: { id: 2 } } })
    expect(a).not.toBe(b)
    expect(a).toBe('/e|filter={"id":1}')
  })

  it('sorts object keys recursively so insertion order does not perturb the seed', () => {
    const a = seedFor({
      endpoint: '/e',
      extra: { filter: { name: 'a', id: 1, nested: { z: 1, a: 2 } } },
    })
    const b = seedFor({
      endpoint: '/e',
      extra: { filter: { nested: { a: 2, z: 1 }, id: 1, name: 'a' } },
    })
    expect(a).toBe(b)
  })
})
