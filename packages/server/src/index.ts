/**
 * Public entry point for `@databehave/server`.
 *
 * Re-exports the surface that consumers are allowed to use. Internal
 * modules (`request`, `response`, `route-key`) are not re-exported on
 * purpose — they are implementation details.
 *
 * `@databehave/server` is standalone — it ships with an in-server
 * OAS-driven mock generator and pulls no DSL dependency at runtime.
 * For richer mock data (distributions, datasets, FK-aware generation)
 * install the DSL package separately and import it directly.
 */

export { defineConfig } from './define.js'
export { run, type RunHandle, type RunOptions } from './run.js'
export { createServer } from './server.js'
export { seedFor, type SeedInput } from './openapi/seed.js'
export {
  loadConfig,
  type EndpointResponse,
  type EndpointSpec,
  type LoadedConfig,
  type LoadConfigOptions,
  type JsonConfig,
} from './json-config.js'
export {
  resolveStatus,
  type MockModeConfig,
  type MockModeLogger,
} from './mock-mode.js'
export type {
  Config,
  CorsConfig,
  Handler,
  ListenHandle,
  ListenOptions,
  Method,
  MockRequest,
  MockResponse,
  MockResponseBody,
  ObservedMethod,
  RouteKey,
  Server,
} from './types.js'

// --- admin (opt-in error-injection panel) ---------------------
export type {
  AdminModeConfig,
  ErrorMode,
  StickyOverride,
  OverrideMatcher,
  AdminModeCors,
} from './admin/admin-types.js'
