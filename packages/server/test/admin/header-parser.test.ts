import { describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'

import { parseHeaderMode } from '../../src/admin/header-parser.js'

const h = (obj: Record<string, string>) => obj

describe('parseHeaderMode', () => {
  it('returns none when no x-mock-* headers are present', () => {
    expect(parseHeaderMode(h({ 'content-type': 'application/json' }))).toEqual({
      kind: 'none',
    })
  })

  it('maps x-mock-status → http-status', () => {
    expect(parseHeaderMode(h({ 'x-mock-status': '500' }))).toEqual({
      kind: 'mode',
      mode: { kind: 'http-status', status: 500 },
    })
  })

  it('rejects non-numeric x-mock-status', () => {
    const r = parseHeaderMode(h({ 'x-mock-status': 'oops' }))
    expect(r.kind).toBe('error')
  })

  it('maps x-mock-business-failure → business-failure', () => {
    expect(
      parseHeaderMode(h({ 'x-mock-business-failure': 'hello' }))
    ).toEqual({
      kind: 'mode',
      mode: { kind: 'business-failure', message: 'hello' },
    })
  })

  it('parses x-mock-business-failure-extra (base64 JSON)', () => {
    const extra = Buffer.from(JSON.stringify({ errorCode: 'X' })).toString(
      'base64'
    )
    expect(
      parseHeaderMode(
        h({
          'x-mock-business-failure': 'm',
          'x-mock-business-failure-extra': extra,
        })
      )
    ).toEqual({
      kind: 'mode',
      mode: {
        kind: 'business-failure',
        message: 'm',
        extra: { errorCode: 'X' },
      },
    })
  })

  it('rejects non-object extra', () => {
    const extra = Buffer.from(JSON.stringify(['arr'])).toString('base64')
    const r = parseHeaderMode(
      h({
        'x-mock-business-failure': 'm',
        'x-mock-business-failure-extra': extra,
      })
    )
    expect(r.kind).toBe('error')
  })

  it('maps x-mock-body with status + content-type', () => {
    const body = Buffer.from(JSON.stringify({ a: 1 })).toString('base64')
    expect(
      parseHeaderMode(
        h({
          'x-mock-body': body,
          'x-mock-body-status': '422',
          'x-mock-body-content-type': 'text/plain',
        })
      )
    ).toEqual({
      kind: 'mode',
      mode: {
        kind: 'custom-body',
        body: { a: 1 },
        status: 422,
        contentType: 'text/plain',
      },
    })
  })

  it('reports invalid base64 / json in x-mock-body', () => {
    const r = parseHeaderMode(h({ 'x-mock-body': '!!!not-base64!!!' }))
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toMatch(/x-mock-body/)
  })

  it('maps x-mock-empty', () => {
    expect(parseHeaderMode(h({ 'x-mock-empty': '1' }))).toEqual({
      kind: 'mode',
      mode: { kind: 'empty-body' },
    })
    expect(
      parseHeaderMode(h({ 'x-mock-empty': '1', 'x-mock-empty-status': '418' }))
    ).toEqual({
      kind: 'mode',
      mode: { kind: 'empty-body', status: 418 },
    })
  })

  it('maps x-mock-malformed', () => {
    expect(parseHeaderMode(h({ 'x-mock-malformed': '1' }))).toEqual({
      kind: 'mode',
      mode: { kind: 'malformed-json' },
    })
  })

  it('maps x-mock-hang and x-mock-destroy', () => {
    expect(parseHeaderMode(h({ 'x-mock-hang': '1' }))).toEqual({
      kind: 'mode',
      mode: { kind: 'hang' },
    })
    expect(parseHeaderMode(h({ 'x-mock-destroy': '1' }))).toEqual({
      kind: 'mode',
      mode: { kind: 'destroy' },
    })
  })

  it('x-mock-delay alone → delay with no inner', () => {
    expect(parseHeaderMode(h({ 'x-mock-delay': '1500' }))).toEqual({
      kind: 'mode',
      mode: { kind: 'delay', ms: 1500 },
    })
  })

  it('x-mock-delay + x-mock-status → delay wrapping http-status', () => {
    expect(
      parseHeaderMode(h({ 'x-mock-delay': '500', 'x-mock-status': '503' }))
    ).toEqual({
      kind: 'mode',
      mode: {
        kind: 'delay',
        ms: 500,
        then: { kind: 'http-status', status: 503 },
      },
    })
  })

  it('rejects delay + hang and delay + destroy', () => {
    expect(
      parseHeaderMode(h({ 'x-mock-delay': '1', 'x-mock-hang': '1' })).kind
    ).toBe('error')
    expect(
      parseHeaderMode(h({ 'x-mock-delay': '1', 'x-mock-destroy': '1' })).kind
    ).toBe('error')
  })

  it('rejects two terminal modes together', () => {
    const r = parseHeaderMode(
      h({ 'x-mock-status': '500', 'x-mock-business-failure': 'm' })
    )
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toMatch(/conflicting/i)
  })

  it('rejects negative x-mock-delay', () => {
    expect(parseHeaderMode(h({ 'x-mock-delay': '-1' })).kind).toBe('error')
  })
})

describe('header-parser supplemental', () => {
  it('x-mock-malformed with explicit status', () => {
    const res = parseHeaderMode({ 'x-mock-malformed': '1', 'x-mock-malformed-status': '418' })
    expect(res).toEqual({ kind: 'mode', mode: { kind: 'malformed-json', status: 418 } })
  })
  it('x-mock-malformed without status defaults to undefined', () => {
    const res = parseHeaderMode({ 'x-mock-malformed': '1' })
    expect(res).toEqual({ kind: 'mode', mode: { kind: 'malformed-json' } })
  })
  it('rejects non-integer malformed status', () => {
    const res = parseHeaderMode({ 'x-mock-malformed': '1', 'x-mock-malformed-status': 'abc' })
    expect(res.kind).toBe('error')
  })
})
