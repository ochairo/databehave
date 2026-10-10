import { afterEach } from 'vitest'
import { createHost } from '@databehave/core'
import type { Host, Plugin } from '@databehave/core'
import { httpCapability, httpPlugin, routesPlugin } from '@databehave/server'
import type { Handler, RouteKey } from '@databehave/server'
import { openapiPlugin, placeholderGeneratorPlugin } from '../src/index.js'
import type { OpenApiOptions } from '../src/index.js'

const hosts: Host[] = []
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.close())) })

/** Test fixture using only the public plugin composition contract. */
export const startOpenApi = async ({ routes = {}, plugins = [], provider = placeholderGeneratorPlugin(), ...options }: OpenApiOptions & {
  readonly routes?: Readonly<Partial<Record<RouteKey, Handler>>>
  readonly plugins?: readonly Plugin[]
  readonly provider?: Plugin
}) => {
  const host = createHost({ plugins: [httpPlugin(), provider, openapiPlugin(options), routesPlugin(routes), ...plugins] })
  hosts.push(host)
  await host.start()
  return host.get(httpCapability)
}
