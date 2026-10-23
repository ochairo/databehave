# @databehave/admin

Requires Node.js 24.22.1+ (24.x) or 26.12.1+ (26.x); supported majors are 24 and 26. See the
[plugin author guide](../../docs/plugins.md) and [migration guide](../../MIGRATION.md).

Optional fault injection and a native Web Components admin panel. Importing or using `@databehave/server` does not import or build this package's UI assets.

```ts
import { createHost } from '@databehave/core'
import { httpPlugin, nodeHttpPlugin, routesPlugin } from '@databehave/server'
import { adminPlugin, faultInjectionPlugin, fileScenariosStore } from '@databehave/admin'

const host = createHost({ plugins: [
  httpPlugin(),
  routesPlugin({ 'GET /health': () => ({ json: { ok: true } }) }),
  faultInjectionPlugin({ allowDestroy: false }),
  adminPlugin({ scenarios: fileScenariosStore({ dir: './mock-scenarios' }) }),
  nodeHttpPlugin({ host: '127.0.0.1', port: 3000 }),
] })
await host.start()
// Admin: http://127.0.0.1:3000/databehave
// Later: await host.close()
```

`faultInjectionPlugin` owns per-instance overrides and `x-mock-*` request interception. Headers take precedence over exact, path and global sticky overrides. Set `headers: false` to disable request headers while keeping sticky overrides. `allowDestroy: false` converts destroy requests to 503; otherwise HTTP performs transport termination. Delays and hangs cancel when the client disconnects or the host closes. HEAD uses the effective handler method for fault matching.

`faultControlCapability` exposes `add`, `remove`, `list`, `clear`, and atomic `replace`. Control plugins register excluded URL prefixes with `excludePathPrefix` during setup. Admin registers its own prefix so global faults cannot break the control API.

`adminPlugin` requires HTTP and fault control. Its options are `path` (default `/databehave`), `ui` (default true), `bind` (`loopback-only` or explicit `any`), `cors`, `scenarios` (a `ScenariosStore` provider), and `openapiBody` (an optional callback returning prepared JSON text for schema details). The route list always comes from HTTP's resolved catalog, including explicit-route precedence; document text does not define routes. `ui: false` omits HTML and asset routes. Omitting `scenarios` disables scenario endpoints. `ScenariosStore` has `list`, `get`, `save` and `remove` methods, with no filesystem or host lifecycle requirement. An external plugin can supply its own store and own any resources it needs. Admin validates complete provider results before replacing live overrides.

All bind guards run before any listener opens. The default accepts `127.0.0.1`, `::1`, and `localhost`; `bind: 'any'` explicitly permits other addresses. `cors: 'auto'` permits wildcard origins for the loopback default and uses same-origin for exposed admin. Browser opening is separate and opt-in: add `openAdminBrowserPlugin()` to open the panel after the listener binds. It has no effect with `ui: false`. Omit this plugin in headless environments.

`fileScenariosStore({ dir })` uses `<name>.json` under the explicitly chosen directory. Names contain only letters, numbers, `_` and `-`, at most 64 characters. Existing valid unversioned scenario files remain readable and are never automatically rewritten. New saves use `version: 1`. Invalid JSON, invalid overrides and unsupported versions fail explicitly on reads/loads; list skips unreadable or invalid entries. Invalid later entries cannot partially replace live state or overwrite a saved scenario. Save writes an owned temporary file then renames it atomically; failures clean that temporary file. Saving or loading is an explicit admin action.

The previous server `admin` configuration, server-owned assets, and admin-specific transport sentinel were removed. Compose these plugins explicitly. Build assets with `pnpm --filter @databehave/admin build`; published assets are available through `@databehave/admin/assets/*`. `pnpm --filter @databehave/admin typecheck` includes strict browser TypeScript, and `test` runs Node unit/integration tests. Browser verification is owned by the workspace's Playwright runner.

Admin owns its CORS policy even when general `corsPlugin()` is present. Restrictive modes reject disallowed,
malformed and opaque `Origin` values before mutation, including simple requests without a browser preflight.
Allowlist responses reflect one permitted origin. Origin-less local clients remain allowed. This policy is separate
from authentication. Both preflights and ordinary responses honor it regardless of plugin composition order.
