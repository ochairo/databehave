import { request } from 'node:http'
import { createHost } from '@databehave/core'
import { httpPlugin, listenerCapability, nodeHttpPlugin, routesPlugin } from '@databehave/server'
import { expect, it, vi } from 'vitest'
import { openapiPlugin, placeholderGeneratorPlugin, requestValidationPlugin } from '../src/index.js'

it('sends 413 over the socket before an oversized request reaches EOF, without executing its handler', async () => {
  const handler = vi.fn(() => ({ text: 'unreachable' }))
  const host = createHost({ plugins: [
    httpPlugin(), placeholderGeneratorPlugin(),
    openapiPlugin({ document: JSON.stringify({
      openapi: '3.0.3', info: { title: 'stream-limit', version: '1' }, paths: {
        '/body': { post: {
          requestBody: { content: { 'application/json': {} } },
          responses: { 200: { description: 'ok' } },
        } },
      },
    }) }),
    requestValidationPlugin({ maxBodyBytes: 4 }), routesPlugin({ 'POST /body': handler }),
    nodeHttpPlugin(),
  ] })
  await host.start()
  const address = host.get(listenerCapability).address
  if (!address) throw new Error('Missing listener address')
  const client = request({ host: '127.0.0.1', port: address.port, path: '/body', method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
  try {
    const response = new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      client.on('error', reject)
      client.setTimeout(2000, () => client.destroy(new Error('No response before request EOF')))
      client.on('response', incoming => {
        let body = ''
        incoming.setEncoding('utf8')
        incoming.on('data', (chunk: string) => { body += chunk })
        incoming.on('error', reject)
        incoming.on('end', () => resolve({ status: incoming.statusCode, body }))
      })
    })
    // No end(): the server must reject from the chunk, without waiting for EOF.
    client.write('"large"')
    const result = await response
    expect(result.status).toBe(413)
    expect(JSON.parse(result.body)).toMatchObject({ status: 413 })
    expect(client.writableEnded).toBe(false)
    expect(handler).not.toHaveBeenCalled()
  } finally {
    client.destroy()
    await host.close()
  }
})
