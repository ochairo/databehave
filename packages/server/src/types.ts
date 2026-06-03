/**
 * Public types for @databehave/server.
 *
 * Everything a consumer needs to type a config and a handler is exported
 * from here. Internal types (route table, dispatch result, etc.) stay
 * inside their respective modules.
 */

/** HTTP methods @databehave/server dispatches on. */
export type Method = 'get' | 'post' | 'put' | 'delete' | 'patch'

/**
 * HTTP methods that may appear on a {@link MockRequest} but
 * never on a route key. `options` is handled by the CORS preflight
 * pipeline; `head` is allowed through but is never matched by a
 * route (returns 404 by default).
 */
export type ObservedMethod =
  | Method
  | 'options'
  | 'head'

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

/**
 * Top-level config consumed by `createServer`.
 *
 * Hand-written `routes` always win over OAS-derived ones — duplicate keys
 * raise an error at construction time only when both are hand-written.
 */
export interface Config {
  /** Hand-written handlers. Keyed by `'METHOD /path'` or `'METHOD /a/:id'`. */
  routes?: Partial<Record<RouteKey, Handler>>
  /**
   * Raw OpenAPI document as JSON text. When present, @databehave/server
   * generates a handler for every `paths.*.<method>` not already
   * declared in `routes`. Set to `undefined` (the default) to disable.
   */
  openapi?: string
  /**
   * Reporter for OpenAPI walker failures. Walker errors are
   * recoverable — the offending route falls back to a small stub —
   * but consumers usually want to log them so the OAS gap is fixed.
   */
  onOpenApiWalkError?: (
    method: Method,
    routePath: string,
    err: unknown,
  ) => void
  /**
   * Reporter for OAS responses declared with an empty / permissive
   * schema (`schema: {}`). Per JSON Schema this matches any value,
   * so @databehave/server still serves a deterministic stub — but consumers
   * usually want to surface it so the spec gets filled in.
   */
  onOpenApiEmptySchema?: (
    method: Method,
    routePath: string,
    status: number,
  ) => void
  /**
   * Per-request lifecycle hooks.
   *
   * - `onRequest`     — runs before route dispatch. Returning a
   *                     `MockResponse` short-circuits the handler
   *                     (use for auth / kill-switch / mock-mode).
   * - `onResponse`    — runs after the handler. Returning a new
   *                     `MockResponse` replaces it (use to inject
   *                     headers like `x-mock-mode`).
   * - `onError`       — invoked on any thrown handler error. Returning
   *                     a `MockResponse` replaces the default 500.
   * - `onServerError` — invoked on a runtime `http.Server` `'error'`
   *                     event after a successful bind (EMFILE, accept
   *                     failures, etc.). When absent, errors are logged
   *                     via `console.error`. Provide a handler to forward
   *                     them to your structured logger or metrics pipe.
   */
  hooks?: {
    onRequest?: (
      req: MockRequest,
    ) => MockResponse | void | Promise<MockResponse | void>
    onResponse?: (
      req: MockRequest,
      res: MockResponse,
    ) => MockResponse | void | Promise<MockResponse | void>
    onError?: (
      req: MockRequest,
      err: unknown,
    ) => MockResponse | Promise<MockResponse>
    onServerError?: (err: Error) => void
  }
  /**
   * CORS settings. When provided, @databehave/server:
   * - reflects `Access-Control-Allow-Origin` from `origin()`
   * - handles `OPTIONS` preflight requests for every declared route
   * - exposes the listed headers via `Access-Control-Expose-Headers`
   */
  cors?: CorsConfig
  /**
   * Opt-in admin / error-injection panel. Default: disabled. See
   * `AdminModeConfig` and the `Admin mode` section in
   * the README. Existing consumers see zero behavior change.
   */
  admin?: import('./admin/admin-types.js').AdminModeConfig
  /**
   * Opt-in per-request access logs (method, path, status, duration).
   * Default: disabled — no stdout output, no per-request overhead.
   *
   * - `false` (default) — silent.
   * - `true` — shorthand for `{ access: true }` with default knobs.
   * - object — see {@link LogConfig}.
   *
   * Lines are written to **stdout**. The admin enable banner also
   * writes to stdout via `console.info`; stderr carries only runtime
   * warnings and errors. See the `Access logs` README section.
   */
  log?: LogConfig
  /**
   * Opt-in inbound request validation against the OpenAPI document.
   * Default: disabled — `server.fetch(Request)` is byte-identical to
   * the no-validation behaviour when `validation` is omitted or
   * `validation.request !== true`.
   */
  validation?: {
    /** Master switch for inbound request validation. Default `false`. */
    request?: boolean
    /**
     * Hard cap on the JSON request body size (UTF-8 bytes) before
     * `JSON.parse` runs. A request whose body exceeds this is rejected
     * with `413 Payload Too Large` (RFC 7807 problem+json). Default
     * `102400` (100 KB) — matches express's body-parser default. Raise
     * only if the OpenAPI document genuinely declares large request
     * bodies.
     */
    maxBodyBytes?: number
  }
}

/**
 * Per-request access-log configuration. See `Config.log`.
 *
 * - `access` — enable the one-line-per-request access log. Default `true`
 *   when an object is supplied.
 * - `includeAdmin` — when `true`, log admin-panel requests too. Default
 *   `false` so dev consoles aren't flooded by UI traffic.
 * - `colors` — `'auto'` (detect `process.stdout.isTTY`), `'always'`, or
 *   `'never'`. Default `'auto'`. Has no effect on the `json` format.
 * - `format` — `'pretty'` (default, ANSI-coloured one-liner) or `'json'`
 *   (newline-terminated JSON object, suitable for log shippers).
 */
export type LogConfig =
  | false
  | true
  | {
      access?: boolean
      includeAdmin?: boolean
      colors?: 'auto' | 'always' | 'never'
      format?: 'pretty' | 'json'
    }

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
  /** Methods accepted on preflight. Defaults to `['GET','POST','PUT','DELETE','PATCH','OPTIONS']`. */
  allowMethods?: readonly string[]
  /** Headers accepted on preflight. Defaults to `['content-type','authorization']`. */
  allowHeaders?: readonly string[]
  /** Cache-time for preflight in seconds. Defaults to `86400`. */
  maxAge?: number
}

/** Options for `Server.listen`. */
export interface ListenOptions {
  /**
   * Port to bind. Use `0` (the default) to ask the OS for a free
   * port — the actual port is returned in the handle.
   */
  port?: number
  /** Host to bind. Defaults to `127.0.0.1`. */
  host?: string
}

/** Handle returned from a successful `listen()`. */
export interface ListenHandle {
  /** Actual port the server is bound to. */
  readonly port: number
  /** Actual host the server is bound to. */
  readonly host: string
  /** Stop the server. Resolves when every socket is closed. */
  close(): Promise<void>
}

/**
 * Server facade. Pure `fetch(Request) → Response` for tests, plus a
 * Node HTTP `listen()` for dev / e2e usage. The underlying HTTP
 * runtime is an implementation detail and never leaks to consumers.
 */
export interface Server {
  /** Process a single Request → Response. Pure, no socket. */
  fetch(req: globalThis.Request): Promise<globalThis.Response>
  /** Start a Node HTTP server bound to the given port/host. */
  listen(opts?: ListenOptions): Promise<ListenHandle>
}
