import { describe, expect, it, vi } from 'vitest'
import { prepareCatalog } from '../src/catalog.js'
import { createRequestValidationContext, validateRequest } from '../src/middleware/request-validation.js'
import { requestValidationPlugin } from '../src/index.js'
import { startOpenApi } from './helpers.js'

const document = (requestBody: unknown, method = 'post') => ({
  openapi: '3.0.3', info: { title: 'body', version: '1' },
  paths: { '/body': { [method]: { requestBody, responses: { 200: { description: 'ok' } } } } },
})
const jsonBody = { content: { 'application/json': { schema: { type: 'string' } } } }
const context = async (requestBody: unknown = jsonBody, maxBodyBytes = 32, method = 'post') =>
  createRequestValidationContext(await prepareCatalog(document(requestBody, method), {
    failureMode: 'throw', compile: () => () => ({}),
  }), { maxBodyBytes })

const request = (body?: BodyInit, signal?: AbortSignal, method = 'POST', contentType = 'application/json') => {
  const init: RequestInit & { duplex: 'half' } = {
    method, duplex: 'half', headers: { 'content-type': contentType },
    ...(body === undefined ? {} : { body }), ...(signal === undefined ? {} : { signal }),
  }
  return new Request('http://localhost/body', init)
}

describe('bounded request body validation', () => {
  it('rejects overflow before EOF, cancels both tee branches, and does not await the source cancel hook', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('"too large"')) }, cancel,
    })
    const req = request(stream)
    const result = await validateRequest(req, await context(jsonBody, 4))
    expect(result?.status).toBe(413)
    await expect.poll(() => cancel.mock.calls.length).toBe(1)
    expect(req.bodyUsed).toBe(true)
    await expect(req.text()).rejects.toThrow()
  })

  it.each(['resolve', 'reject'] as const)('observes a %s source cancellation promise', async outcome => {
    const cancel = vi.fn(() => outcome === 'resolve' ? Promise.resolve() : Promise.reject(new Error('cancel failed')))
    const req = request(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(5)) }, cancel,
    }))
    expect((await validateRequest(req, await context(jsonBody, 4)))?.status).toBe(413)
    await expect.poll(() => cancel.mock.calls.length).toBe(1)
  })

  it('counts bytes across split UTF-8 chunks and preserves the original body at the exact limit', async () => {
    const bytes = new TextEncoder().encode('"😀"')
    const make = () => request(new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
      controller.close()
    } }))
    const req = make()
    expect(await validateRequest(req, await context(jsonBody, bytes.length))).toBeNull()
    expect(await req.json()).toBe('😀')
    expect((await validateRequest(make(), await context(jsonBody, bytes.length - 1)))?.status).toBe(413)
  })

  it.each([false, true])('rejects read failures for required=%s instead of accepting an absent body', async required => {
    const req = request(new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('private failure')) } }))
    const result = await validateRequest(req, await context({ ...jsonBody, required }))
    expect(result?.status).toBe(400)
    expect(await result?.text()).not.toContain('private failure')
  })

  it('aborts a pending read and cancels both branches without waiting for source cancellation', async () => {
    const abort = new AbortController()
    let pulled!: () => void
    const reading = new Promise<void>(resolve => { pulled = resolve })
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const req = request(new ReadableStream<Uint8Array>({ pull() { pulled() }, cancel }), abort.signal)
    const pending = validateRequest(req, await context())
    await reading
    abort.abort()
    expect((await pending)?.status).toBe(400)
    await expect.poll(() => cancel.mock.calls.length).toBe(1)
  })

  it('rejects an already-aborted optional absent body', async () => {
    const abort = new AbortController()
    abort.abort()
    expect((await validateRequest(request(undefined, abort.signal), await context()))?.status).toBe(400)
  })

  it('rejects a disturbed body as a read failure', async () => {
    const req = request('"valid"')
    await req.text()
    expect((await validateRequest(req, await context()))?.status).toBe(400)
  })

  it.each(['POST', 'OPTIONS'])('enforces required %s bodies independently of schema presence', async method => {
    const ctx = await context({ required: true, content: { 'application/json': {} } }, 32, method.toLowerCase())
    expect((await validateRequest(request(undefined, undefined, method), ctx))?.status).toBe(422)
    expect((await validateRequest(request('', undefined, method), ctx))?.status).toBe(422)
    expect((await validateRequest(request('{bad', undefined, method), ctx))?.status).toBe(400)
    expect((await validateRequest(request('text', undefined, method, 'text/plain'), ctx))?.status).toBe(415)
    expect(await validateRequest(request('{}', undefined, method), ctx)).toBeNull()
  })

  it('checks non-JSON body presence and bounds without parsing JSON', async () => {
    const ctx = await context({ required: true, content: { 'text/plain': {} } }, 4)
    expect((await validateRequest(request(undefined), ctx))?.status).toBe(422)
    expect(await validateRequest(request('text', undefined, 'POST', 'text/plain'), ctx)).toBeNull()
    expect((await validateRequest(request('large', undefined, 'POST', 'text/plain'), ctx))?.status).toBe(413)
  })

  it('does not mistake BOM bytes for absent JSON', async () => {
    expect((await validateRequest(request('\uFEFF'), await context()))?.status).toBe(400)
  })

  it('allows an absent optional body with a zero limit, but rejects every byte', async () => {
    const ctx = await context(jsonBody, 0)
    expect(await validateRequest(request(), ctx)).toBeNull()
    expect((await validateRequest(request('0'), ctx))?.status).toBe(413)
  })

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid maxBodyBytes %s', async limit => {
    await expect(context(jsonBody, limit)).rejects.toThrow('maxBodyBytes must be a nonnegative safe integer')
  })

  it('never executes the handler after overflow or a body read failure; valid bodies remain readable', async () => {
    const handler = vi.fn(async (req: { raw(): Request }) => ({ json: await req.raw().json() }))
    const http = await startOpenApi({
      document: JSON.stringify(document(jsonBody)), plugins: [requestValidationPlugin({ maxBodyBytes: 4 })],
      routes: { 'POST /body': handler },
    })
    expect((await http.fetch(request('"large"'))).status).toBe(413)
    expect((await http.fetch(request(new ReadableStream<Uint8Array>({ start(c) { c.error(new Error('failed')) } })))).status).toBe(400)
    const abort = new AbortController()
    const aborted = http.fetch(request(new ReadableStream<Uint8Array>(), abort.signal))
    abort.abort()
    expect((await aborted).status).toBe(400)
    expect(handler).not.toHaveBeenCalled()
    const valid = await http.fetch(request('"ok"'))
    expect(valid.status).toBe(200)
    expect(await valid.json()).toBe('ok')
    expect(handler).toHaveBeenCalledOnce()
  })
})
