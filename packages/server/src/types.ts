/**
 * Public types for @databehave/server.
 *
 * Request, response, handler and common HTTP option types are exported
 * from here. Internal types (route table, dispatch result, etc.) stay
 * inside their respective modules.
 */

/** HTTP methods dispatched by the server. */
export type Method = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'head' | 'options'

/** Methods observed on incoming requests, including HEAD and OPTIONS. */
export type ObservedMethod = Method

/**
 * Config key shape: `'METHOD /absolute-path'`.
 *
 * Method is upper-case. Path must start with `/`. Path segments
 * starting with `:` are dynamic parameters captured into
 * `MockRequest.params` (e.g. `'GET /users/:id'`).
 */
export type RouteKey = `${Uppercase<Method>} /${string}`

/**
 * Request facade for the mock framework. Hides the underlying web
 * `Request` so handlers stay decoupled from the HTTP runtime.
 *
 * Named `MockRequest` (not `Request`) to avoid shadowing the Web
 * Fetch `globalThis.Request` at consumer call sites.
 */
export interface MockRequest {
  readonly method: ObservedMethod
  /** Resolved handler method; HEAD may use GET while method remains head. */
  readonly effectiveMethod: ObservedMethod
  /** Aborted on caller disconnect or host shutdown. */
  readonly signal: AbortSignal
  /** Full URL as received. */
  readonly url: string
  /** Pathname only, e.g. `/api/v1/foo`. */
  readonly path: string
  /**
   * Query parameters. Multi-valued keys keep only the last value here;
   * use `queryAll` to get every value.
   */
  readonly query: Readonly<Record<string, string>>
  /** Every query value, indexed by key. */
  readonly queryAll: Readonly<Record<string, readonly string[]>>
  /**
   * Path parameters extracted by the matcher.
   *
   * E.g. a route `'GET /users/:id'` matched against `/users/42`
   * yields `{ id: '42' }`. Empty for routes without `:` segments.
   */
  readonly params: Readonly<Record<string, string>>
  /** Header names are lower-cased. */
  readonly headers: Readonly<Record<string, string>>
  /** Parse the request body as JSON. Throws on invalid JSON. */
  json<T = unknown>(): Promise<T>
  /** Read the request body as text. */
  text(): Promise<string>
  /** Escape hatch: get the raw web `Request`. Use sparingly. */
  raw(): globalThis.Request
}

/**
 * Response body variants. Exactly one of `json` / `text` / `html` /
 * `raw` / `empty` must be set.
 */
export type MockResponseBody =
  | { json: unknown; text?: never; html?: never; raw?: never; empty?: never }
  | { json?: never; text: string; html?: never; raw?: never; empty?: never }
  | { json?: never; text?: never; html: string; raw?: never; empty?: never }
  | { json?: never; text?: never; html?: never; raw: BodyInit; empty?: never }
  | { json?: never; text?: never; html?: never; raw?: never; empty: true }

/**
 * Full response shape for the mock framework. Status defaults to 200.
 * Headers are merged into the runtime-provided defaults (Content-Type
 * from the body variant).
 *
 * Named `MockResponse` (not `Response`) to avoid shadowing the Web
 * Fetch `globalThis.Response` at consumer call sites.
 */
export type MockResponse = MockResponseBody & {
  status?: number
  headers?: Readonly<Record<string, string>>
}

/** Handler signature. May be sync or async. */
export type Handler =
  (req: MockRequest) => MockResponse | Promise<MockResponse>

/** CORS knobs. All fields are optional. */
export interface CorsConfig {
  /**
   * Resolve the value for `Access-Control-Allow-Origin`. Receives
   * the request `Origin` header (empty string if absent). Defaults
   * to mirroring the request origin, or `'*'` when none is present.
   */
  origin?: (origin: string) => string
  /** Allow credentials (cookies). Defaults to `false`. */
  credentials?: boolean
  /** Headers exposed to the browser via `Access-Control-Expose-Headers`. */
  exposeHeaders?: readonly string[]
  /** Methods accepted on preflight. Defaults to `['GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS']`. */
  allowMethods?: readonly string[]
  /** Headers accepted on preflight. Defaults to `['content-type','authorization']`. */
  allowHeaders?: readonly string[]
  /** Cache-time for preflight in seconds. Defaults to `86400`. */
  maxAge?: number
}
