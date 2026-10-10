import { describe, it, expect } from 'vitest'
import * as server from '../src/index.js'

const expected = [
  'httpPlugin', 'httpCapability', 'nodeHttpPlugin', 'listenerCapability',
  'routesPlugin', 'corsPlugin', 'accessLogPlugin',
  'terminateTransport', 'HttpTransportTermination', 'UnsupportedTransportError',
  'parseRouteKey', 'parseRoutePattern', 'matchPattern',
].sort()

describe('public HTTP package exports', () => {
  it('exposes the plugin and HTTP contribution contracts', () => {
    expect(Object.keys(server).sort()).toEqual(expected)
  })

  it('does not assemble OpenAPI, schema, admin, or legacy configuration', () => {
    for (const name of ['obj', 'str', 'mock', 'openapiPlugin', 'adminPlugin', 'defineConfig', 'loadConfig', 'createServer', 'run']) {
      expect(server).not.toHaveProperty(name)
    }
  })
})
