import { describe, expect, it } from 'vitest'
import { validateMatcher, validateMode, validateOverrides } from '../src/validation.js'

describe('shared scenario domain validation', () => {
  it.each([null, {}, { kind: 'unknown' }, { kind: 'http-status', status: '500' }, { kind: 'http-status', status: 199 }, { kind: 'http-status', status: 600 }, { kind: 'http-status', status: 201.5 }, { kind: 'business-failure' }, { kind: 'business-failure', message: 'x', extra: [] }, { kind: 'custom-body' }, { kind: 'custom-body', body: null, status: '400' }, { kind: 'custom-body', body: null, contentType: 5 }, { kind: 'empty-body', status: null }, { kind: 'malformed-json', status: false }, { kind: 'delay', ms: -1 }, { kind: 'delay', ms: Infinity }, { kind: 'delay', ms: 1, then: {} }, { kind: 'delay', ms: 1, then: { kind: 'delay', ms: 1 } }, { kind: 'delay', ms: 1, then: { kind: 'hang' } }, { kind: 'delay', ms: 1, then: { kind: 'destroy' } }])('rejects invalid mode %j', (raw) => {
    const [value, error] = validateMode(raw); expect(value).toBeNull(); expect(error).toBeTypeOf('string')
  })
  it.each([{ kind: 'http-status', status: 503 }, { kind: 'business-failure', message: 'x' }, { kind: 'business-failure', message: 'x', extra: { code: 'E' } }, { kind: 'custom-body', body: {} }, { kind: 'custom-body', body: 'x', status: 200, contentType: 'text/plain' }, { kind: 'empty-body' }, { kind: 'empty-body', status: 204 }, { kind: 'malformed-json' }, { kind: 'malformed-json', status: 200 }, { kind: 'delay', ms: 0 }, { kind: 'delay', ms: 1, then: { kind: 'http-status', status: 502 } }, { kind: 'hang' }, { kind: 'destroy' }])('accepts valid mode %j', (raw) => {
    expect(validateMode(raw)).toEqual([raw, null])
  })
  it.each([null, {}, { kind: 'unknown' }, { kind: 'exact', path: '/' }, { kind: 'exact', method: 'GET', path: 'bad' }, { kind: 'path', path: false }, { kind: 'global', methods: 2 }, { kind: 'global', methods: [2] }, { kind: 'global', methods: [' '] }])('rejects invalid matcher %j', (raw) => {
    expect(validateMatcher(raw)[0]).toBeNull()
  })
  it('normalizes method filters and accepts all matcher kinds', () => {
    expect(validateMatcher({ kind: 'global', methods: ['get', ' post '] })[0]).toEqual({ kind: 'global', methods: ['GET', 'POST'] })
    expect(validateMatcher({ kind: 'global', methods: [] })[0]).toEqual({ kind: 'global' })
    expect(validateMatcher({ kind: 'global' })[0]).toEqual({ kind: 'global' })
    expect(validateMatcher({ kind: 'path', path: '/x' })[0]).toEqual({ kind: 'path', path: '/x' })
    expect(validateMatcher({ kind: 'exact', method: 'get', path: '/x' })[0]).toEqual({ kind: 'exact', method: 'get', path: '/x' })
  })
  it('requires array entries, persisted identity and valid optional description', () => {
    const entry = { matcher: { kind: 'global' }, mode: { kind: 'hang' } }
    for (const raw of [null, {}, [null], [entry], [{ ...entry, id: 'a', createdAt: '', description: 1 }]]) {
      expect(() => validateOverrides(raw)).toThrow()
    }
    expect(validateOverrides([{ ...entry, id: 'a', createdAt: '', description: 'ok' }])).toHaveLength(1)
  })
})
