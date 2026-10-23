# @databehave/core

Explicit, typed plugin composition with no product dependencies or global registry.

Requires Node.js 24.22.1+ (24.x) or 26.12.1+ (26.x); supported majors are 24 and 26. See the
[plugin author guide](../../docs/plugins.md) and [runnable plugin example](../../examples/plugin.mjs).

```ts
import { capability, createHost, type Plugin } from '@databehave/core'

const greeting = capability<{ text: string }>('example/greeting', 1)
const provider: Plugin = {
  id: 'greeting',
  apiVersion: 1,
  provides: [greeting],
  setup(ctx) { ctx.provide(greeting, { text: 'Hello' }) },
}
const consumer: Plugin = {
  id: 'printer',
  apiVersion: 1,
  requires: [greeting],
  setup() {},
  activate(ctx) { console.log(ctx.use(greeting).text) },
}
const host = createHost({ plugins: [consumer, provider] })
await host.start()
await host.close()
```

Capability identity is its nonempty, trimmed name and positive integer version. Separate
copies of a contract match by those values. Generic tokens connect the capability's
value type to `provide`, `use`, and `get`; JavaScript values are trusted to honor that
contract. Names should be package-qualified. Duplicate providers of the same name/version,
missing requirements, duplicate plugin IDs, invalid API versions and cycles fail before
setup. Different capability versions may coexist when explicitly provided and required.
Plugins may only provide declared capabilities and consume declared requirements.
`host.get(token)` is for the application's composition boundary; it does not extend the
service's lifetime past host shutdown. Omitted plugins contribute no capabilities.

`createHost` validates the complete graph, runs synchronous setup in dependency order,
then invokes seal callbacks. Setup must not perform I/O or acquire resources. Async setup
and seal callbacks are rejected; trusted plugin code is not sandboxed and cannot be
forcibly undone. Setup contexts expire when their setup returns. Seal callbacks run after
all setup contributions and should seal feature-owned registries. Register contributions
through those feature contracts only while registration remains open.

Registration snapshots plugin identities and callback references. Object literals and class implementations
are supported; callbacks retain their original receiver, including private fields. Reassigning a handler
after construction does not replace the registered handler. Receiver and closure state remain plugin-owned.

Startup runs separate `prepare`, `activate`, then `open` barriers. Each phase is sequential:
providers precede consumers, and available independent plugins follow configuration order.
Context `order` always gives the original configuration index, allowing feature-owned
middleware ordering independent of dependency ordering. All preparation finishes before
any activation, and all activation finishes before any external ingress opens.

Call `ctx.defer(dispose)` immediately when acquiring each resource. Only `open` may call
`ctx.ownIngress({ stopAccepting, drainAndClose })`; do not also register the same ingress
as an ordinary disposer. Close stops all registered ingress synchronously, aborts the
lifetime signal, waits for the current startup hook, drains ingress in reverse acquisition
order, and disposes other resources in reverse acquisition order. A hook completing after
cancellation may still register its acquisitions; late ingress stops immediately. Its
context expires on completion, so detached background acquisition is unsupported. Hooks
must cooperate with cancellation, and ingress implementations own bounded draining.

Concurrent `start()` calls share one promise, as do all `close()` calls. Close during
startup prevents subsequent hooks/phases and rejects startup after cleanup. Repeated
start after a completed start returns that original promise and never restarts the host.
Closing before start rejects a later start. Failure is terminal: create a new host to retry.
Cleanup continues after errors and rejects with `AggregateError`; startup cleanup errors
also retain the original startup error as the first error and `cause`. If cleanup succeeds,
startup rejects with the original failure and close succeeds. States are `ready`, `starting`,
`running`, `closing`, `closed`, and `failed`.

Run `pnpm typecheck`, `pnpm test`, and `pnpm build` in the project development container.
The root `api:check` command verifies the package API report in `etc/core.api.md`.
Use `api:update` when intentionally changing the public contract.
