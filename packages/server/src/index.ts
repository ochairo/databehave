/** Public HTTP contracts and optional HTTP plugins. Feature packages depend on this boundary. */
export { httpPlugin, type HttpOptions } from './server.js'
export {
  httpCapability, terminateTransport, HttpTransportTermination, UnsupportedTransportError,
  type HttpRuntime, type HttpMiddleware, type HttpOutcome, type HttpObservation,
  type HttpBind, type BindGuard, type RouteDefinition, type RouteSource, type ResolvedRoute,
} from './http.js'
export { nodeHttpPlugin, listenerCapability, type HttpListener, type NodeHttpOptions } from './node-http.js'
export { routesPlugin } from './plugins/routes.js'
export { corsPlugin } from './plugins/cors.js'
export { accessLogPlugin, type AccessLogOptions } from './plugins/access-log.js'
export { parseRouteKey, parseRoutePattern, matchPattern, type RoutePattern, type PatternSegment, type ParsedRouteKey } from './route-key.js'
export type { LogFormatOptions } from './log.js'
export type { Handler, Method, MockRequest, MockResponse, MockResponseBody, ObservedMethod, RouteKey, CorsConfig } from './types.js'
