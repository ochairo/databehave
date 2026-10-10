import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { packageDirectories, verifyBundle } from './release.mjs'

const root = resolve('.')
const [artifactDirectory, sourceSha, ...extra] = process.argv.slice(2)
assert.ok(artifactDirectory && sourceSha && !extra.length, 'Usage: node scripts/packaged-consumer.mjs ARTIFACT_DIR SOURCE_SHA')
const bundle = resolve(artifactDirectory)
const release = await verifyBundle(bundle, sourceSha)
const fixture = await mkdtemp(join(tmpdir(), 'databehave-packages-'))
const names = packageDirectories
function command(commandName, args, cwd = root) {
  const result = spawnSync(commandName, args, { cwd, encoding: 'utf8', timeout: 30_000 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${commandName} failed: ${result.stdout}\n${result.stderr}`)
  return result.stdout
}
async function consumer(label, packages, source) {
  const directory = join(fixture, label)
  for (const name of packages) {
    const target = join(directory, 'node_modules/@databehave', name)
    await mkdir(target, { recursive: true })
    await cp(join(fixture, 'extracted', name), target, { recursive: true })
  }
  const file = join(directory, 'consumer.mjs')
  await writeFile(file, source)
  return import(pathToFileURL(file).href)
}
try {
  for (const item of release.packages) {
    const name = item.name.split('/')[1]
    const archive = join(bundle, item.tarball)
    const directory = join(fixture, 'extracted', name)
    await mkdir(directory, { recursive: true })
    command('tar', ['-xzf', archive, '--strip-components=1', '-C', directory])
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    assert.equal(manifest.repository?.url, 'git+https://github.com/ochairo/databehave.git', `${name}: provenance repository`)
    assert.equal(manifest.repository?.directory, `packages/${name}`, `${name}: package source directory`)
    assert.ok(!JSON.stringify(manifest).includes('workspace:'), `${name}: unresolved workspace dependency`)
    await readFile(join(directory, 'LICENSE'))
    const entries = command('tar', ['-tzf', archive]).split('\n')
    assert.ok(!entries.some(file => /(?:^|\/)(?:src|test|node_modules|coverage)\//.test(file)), `${name}: leaked development files`)
  }
  const schema = await consumer('schema-only', ['schema'], `
    import { createSchemaRuntime, defineKind, defineBehavior } from '@databehave/schema/runtime'
    import { standardKinds, standardBehaviors } from '@databehave/schema/standard'
    import { obj, arr } from '@databehave/schema'
    const coin = defineKind({ id:'coin',version:1,
      checkMetadata(node) { if(node?.kind!=='coin') throw Error('bad coin');return node },
      generate:(_node,ctx)=>ctx.leafRng().int(1,9),
      validate(_node,value,ctx) { if(typeof value!=='number') ctx.issues.push({path:ctx.path,code:'coin',message:'number required'}); return value },
      children:()=>[],rebuild:node=>({...node}) })
    const twice = defineBehavior({id:'twice',version:1,phase:'sample',checkMetadata: value=>value,
      appliesTo:node=>node.kind==='coin',merge:(_old,next)=>next,generate:(_m,_n,_c,next)=>2*next(),
      validate:(_m,_n,_v,_c,next)=>next(),serialize:value=>value})
    const runtime=createSchemaRuntime({kinds:[...standardKinds,coin],behaviors:[...standardBehaviors,twice]})
    const shape=obj({coins:arr(twice.apply(coin.schema({}),true)).length(2)})
    export const value=runtime.mock(shape,{seed:42})
    export const valid=runtime.safeParse(shape,value).ok
    const restored=runtime.deserializeSchema(runtime.serializeSchema(shape))
    export const roundtrip=runtime.mock(restored,{seed:42})
    const legacy={$databehaveVersion:1,node:{kind:'number',int:true,min:7,max:7}}
    export const migrated=runtime.serializeSchema(runtime.fromIR(legacy.node))
  `)
  assert.equal(schema.valid, true)
  assert.deepEqual(schema.roundtrip, schema.value)
  assert.equal(schema.migrated.$databehaveVersion, 2)
  const minimal = await consumer('http-only', ['core', 'server'], `
    import {createHost} from '@databehave/core'
    import {httpPlugin,httpCapability} from '@databehave/server'
    class ExternalRoutes {
      id='external.routes';apiVersion=1;requires=[httpCapability];#payload={external:true}
      setup(ctx){ctx.use(httpCapability).registerRoutes({owner:this.id,order:ctx.order,materialize:()=>[
        {key:'GET /external',priority:'explicit',handler:()=>({json:this.#payload})}]})}
    }
    const app=createHost({plugins:[new ExternalRoutes(),httpPlugin()]});await app.start()
    try { exportResult=await (await app.get(httpCapability).fetch(new Request('http://local/external'))).json() }
    finally {await app.close()}
    var exportResult;export {exportResult}
  `)
  assert.deepEqual(minimal.exportResult, { external: true })
  const external = await consumer('schema-free-openapi', ['core', 'server', 'openapi'], `
    import { createHost } from '@databehave/core'
    import { httpPlugin, httpCapability, nodeHttpPlugin, listenerCapability } from '@databehave/server'
    import { openapiPlugin, openapiGeneratorCapability, mockModePlugin } from '@databehave/openapi'
    export const exportResult = []
    const provider = {
      id: 'external.responses', apiVersion: 1, provides: [openapiGeneratorCapability],
      setup(ctx) {
        ctx.provide(openapiGeneratorCapability, {
          failureMode: 'throw', compile: (_schema, { status }) => () => ({ source: 'external', status }),
        })
      },
    }
    const schema = { content: { 'application/json': { schema: { type: 'object' } } } }
    const host = createHost({ plugins: [
      httpPlugin(), provider,
      openapiPlugin({ document: JSON.stringify({ paths: { '/x': { get: { responses: { 200: schema, 500: schema } } } } }) }),
      mockModePlugin({ allowHeaderOverride: true }),
      nodeHttpPlugin({ host: '127.0.0.1', port: 0 }),
    ] })
    await host.start()
    try {
      const http = host.get(httpCapability)
      exportResult.push(await (await http.fetch(new Request('http://x/x'))).json())
      exportResult.push(await (await http.fetch(new Request('http://x/x', { headers: { 'x-mock-status': '500' } }))).json())
      const address = host.get(listenerCapability).address
      if (!address) throw new Error('Listener address was not published')
      const response = await fetch('http://127.0.0.1:' + address.port + '/x', { headers: { 'x-mock-status': '500' } })
      exportResult.push({ transportStatus: response.status, body: await response.json() })
    } finally { await host.close() }
  `)
  assert.deepEqual(external.exportResult, [{ source: 'external', status: 200 }, { source: 'external', status: 500 }, { transportStatus: 500, body: { source: 'external', status: 500 } }])
  const full = await consumer('full', names, `
    import {createHost} from '@databehave/core'
    import {httpPlugin,httpCapability,nodeHttpPlugin,listenerCapability} from '@databehave/server'
    import {openapiPlugin,requestValidationPlugin} from '@databehave/openapi'
    import {schemaGeneratorPlugin} from '@databehave/openapi/schema'
    import * as builders from '@databehave/schema'
    import {adminPlugin,faultInjectionPlugin} from '@databehave/admin'
    import {defineConfig} from '@databehave/cli'
    const config=defineConfig(()=>({plugins:[httpPlugin(),
      schemaGeneratorPlugin({builders,runtime:builders.standardRuntime}),
      openapiPlugin({document:JSON.stringify({paths:{'/x':{get:{responses:{201:{content:{'application/json':{schema:{type:'integer',minimum:1,maximum:1}}}}}}}}})}),
      requestValidationPlugin(),faultInjectionPlugin(),adminPlugin(),
      nodeHttpPlugin({host:'127.0.0.1',port:0})]}))
    const app=createHost(await config());await app.start()
    var results;
    try {const http=app.get(httpCapability), response=await http.fetch(new Request('http://local/x'));
      const address=app.get(listenerCapability).address;
      const html=await (await fetch('http://127.0.0.1:'+address.port+'/databehave')).text();
      const asset=await http.fetch(new Request('http://local/databehave/ui.js'));
      results={status:response.status,body:await response.json(),html:html.includes('/databehave/ui.js'),asset:asset.status};
    }finally{await app.close()}
    export {results}
  `)
  assert.deepEqual(full.results, { status: 201, body: 1, html: true, asset: 200 })
  const cli = join(fixture, 'full/node_modules/@databehave/cli/dist/bin.js')
  assert.match(command(process.execPath, [cli, '--help']), /Usage: databehave/)
  const emptyConfig = join(fixture, 'full/config.mjs')
  await writeFile(emptyConfig, 'export default () => ({plugins:[]})')
  assert.match(command(process.execPath, [cli, emptyConfig]), /ready/)
  console.log('All six bundle tarballs passed schema-only, HTTP-only, schema-free OpenAPI fetch/HTTP, full composition, and CLI consumers.')
} finally { await rm(fixture, { recursive: true, force: true }) }
