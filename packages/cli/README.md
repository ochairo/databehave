# @databehave/cli

Requires Node.js 24 or 26; supported majors are 24 and 26. See the
[workspace quickstart](../../README.md#start-a-mock-server) and [migration guide](../../MIGRATION.md).

Run an explicit ESM plugin configuration with `databehave ./databehave.mjs`.
Export a factory so repeated runs create fresh plugin instances:

```js
import { defineConfig } from '@databehave/cli'
import { httpPlugin, nodeHttpPlugin, routesPlugin } from '@databehave/server'

export default defineConfig(() => ({
  plugins: [
    httpPlugin(),
    routesPlugin({ 'GET /hello': () => ({ json: { hello: 'world' } }) }),
    nodeHttpPlugin({ host: '127.0.0.1', port: 8000 }),
  ],
}))
```

Configuration and plugins execute trusted application code. Install packages explicitly through your package
manager. The CLI does not discover, download or install plugins. Use ordinary JavaScript imports and validate
plugin options at their owning boundary. JSONC configurations must be migrated; see the repository migration guide.

`run({ config, signal? })` returns `{ host, close }` after startup. Shutdown cancels/drains work and reports cleanup
errors. The executable handles SIGINT/SIGTERM and exits with 2 for invalid usage or 1 for startup/cleanup failure.
When no active resources remain, it runs cleanup and exits successfully instead of keeping an idle process alive.
