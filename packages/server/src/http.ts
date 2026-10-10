import { capability } from '@databehave/core'
import type { CorsConfig, Handler, Method, MockRequest, MockResponse, RouteKey } from './types.js'

/** A contributed route; explicit routes replace generated defaults with the same key. */
export interface RouteDefinition {
  readonly key: RouteKey
  readonly handler: Handler
  readonly priority: 'explicit' | 'generated'
  readonly source?: string
  readonly metadata?: Readonly<Record<string, unknown>>
  /** Override application CORS, or false when the route owner supplies its own policy. */
  readonly cors?: CorsConfig | false
}

/** Registered in setup, materialized exactly once after every plugin has prepared. */
export interface RouteSource {
  readonly owner: string
  readonly order: number
  materialize(): readonly RouteDefinition[]
}

/** Frozen resolved route metadata exposed after HTTP activation. Exact paths match first;
 * parameterized ties follow source composition order, then source declaration order. */
export interface ResolvedRoute extends RouteDefinition {
  readonly owner: string
  readonly method: Method
  readonly path: string
}

/** Final outcome, including transport effects which cannot be represented by Fetch responses. */
export type HttpOutcome =
  | { readonly kind: 'response'; readonly response: Response }
  | { readonly kind: 'terminate'; readonly reason: string }

/** One final observation per request, after decoration and HEAD body suppression. */
export interface HttpObservation {
  readonly request: MockRequest
  readonly outcome: HttpOutcome
  readonly durationMs: number
  readonly error?: unknown
}

/** Fixed pipeline phase with explicit composition order, independent of dependency sorting. */
export type HttpMiddleware = {
  readonly owner: string
  readonly order: number
} & (
  | { readonly stage: 'preflight' | 'validation' | 'interception'; readonly handle: (request: MockRequest) => MockResponse | void | Promise<MockResponse | void> }
  | { readonly stage: 'decoration'; readonly handle: (request: MockRequest, response: MockResponse) => MockResponse | void | Promise<MockResponse | void> }
  | { readonly stage: 'error'; readonly handle: (request: MockRequest, error: unknown) => MockResponse | void | Promise<MockResponse | void> }
  | { readonly stage: 'observation'; readonly handle: (observation: HttpObservation) => void | Promise<void> }
)

/** Listener bind intent passed to every guard before any socket opens. */
export interface HttpBind {
  readonly host: string
  readonly port: number
}

/** Feature-owned policy registered before HTTP registration is sealed. */
export interface BindGuard {
  readonly owner: string
  check(bind: HttpBind): void | Promise<void>
}

/** HTTP registration, resolved catalog, request dispatch, and pre-bind policy contract. */
export interface HttpRuntime {
  /** Shared logical/transport shutdown policy; deadline uses performance.now(). */
  readonly drainTimeoutMs: number
  readonly drainDeadline: number | undefined
  registerRoutes(source: RouteSource): void
  registerMiddleware(middleware: HttpMiddleware): void
  registerBindGuard(guard: BindGuard): void
  readonly routes: readonly ResolvedRoute[]
  /** Resolve with dispatch precedence, including HEAD fallback; available after activation. */
  resolveRoute(method: string, path: string): ResolvedRoute | undefined
  checkBind(bind: HttpBind): Promise<void>
  dispatch(request: Request): Promise<HttpOutcome>
  fetch(request: Request): Promise<Response>
}

export const httpCapability = capability<HttpRuntime>('databehave.http', 1)

/** A terminal transport effect; the pipeline observes it without running response decorators. */
export class HttpTransportTermination extends Error {
  constructor(message = 'Connection terminated by HTTP policy') {
    super(message)
    this.name = 'HttpTransportTermination'
  }
}

/** Fetch has no socket to terminate; callers receive this explicit unsupported-effect error. */
export class UnsupportedTransportError extends Error {
  constructor(readonly reason: string) {
    super(`Transport termination is unsupported by fetch: ${reason}`)
    this.name = 'UnsupportedTransportError'
  }
}

/** Terminate the actual HTTP connection when invoked by a handler or middleware. */
export const terminateTransport = (reason?: string): never => {
  throw new HttpTransportTermination(reason)
}
