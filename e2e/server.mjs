import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createHost } from '../packages/core/dist/index.js'
import { httpPlugin, nodeHttpPlugin, routesPlugin, corsPlugin } from '../packages/server/dist/index.js'
import { faultInjectionPlugin, adminPlugin, fileScenariosStore } from '../packages/admin/dist/index.js'

const scenariosDir = await mkdtemp(join(tmpdir(), 'databehave-e2e-'))
const app = createHost({ plugins: [
  httpPlugin(),
  corsPlugin(),
  routesPlugin({
    'GET /hello': () => ({ json: { message: 'hello' } }),
    'HEAD /head': () => ({ empty: true }),
    'OPTIONS /options': () => ({ empty: true }),
  }),
  faultInjectionPlugin(),
  adminPlugin({ cors: 'same-origin', scenarios: fileScenariosStore({ dir: scenariosDir }) }),
  nodeHttpPlugin({ host: '127.0.0.1', port: 17843 }),
] })
const foreign = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end('<!doctype html><title>Local origin fixture</title>')
})
let closing
const close = () => {
  if (!closing) closing = app.close().finally(async () => {
    await new Promise(resolve => foreign.close(resolve))
    await rm(scenariosDir, { recursive: true, force: true })
  })
  return closing
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { void close().catch(error => { console.error(error); process.exitCode = 1 }) })
}
try {
  await app.start()
  await new Promise((resolve, reject) => { foreign.once('error', reject); foreign.listen(17844, '127.0.0.1', resolve) })
} catch (error) { await close(); throw error }
