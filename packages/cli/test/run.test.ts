import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defineConfig, parseArguments, run } from '../src/index.js'

test('CLI accepts one configuration path and rejects feature flags/extra paths', () => {
  assert.deepEqual(parseArguments(['--help']), { kind: 'help' })
  assert.deepEqual(parseArguments(['test.mjs']), { kind: 'run', config: 'test.mjs' })
  for (const args of [[], ['--open', 'test.mjs'], ['one.mjs', 'two.mjs']]) {
    assert.equal(parseArguments(args).kind, 'error')
  }
  const factory = () => ({ plugins: [] })
  assert.equal(defineConfig(factory), factory)
})

test('each run invokes the cached ESM factory and creates independent state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'databehave-cli-'))
  try {
    const config = join(dir, 'config.mjs')
    await writeFile(config, `export default () => ({ plugins: [{
      id: 'fixture', apiVersion: 1,
      provides: [{name:'fixture',version:1}],
      setup(ctx) { ctx.provide({name:'fixture',version:1}, {count:0}) }
    }] })`)
    const a = await run({ config })
    const b = await run({ config })
    const token = { name: 'fixture', version: 1 }
    assert.notEqual(a.host.get(token), b.host.get(token))
    assert.equal(a.close(), a.close())
    await Promise.all([a.close(), b.close()])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('bad config and unsupported legacy config fail without starting plugins', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'databehave-cli-'))
  try {
    await assert.rejects(run({ config: join(dir, 'old.jsonc') }), /ESM/)
    for (const source of ['export default {}', 'export default () => ({ plugins: [null] })']) {
      const config = join(dir, `${source.length}.mjs`)
      await writeFile(config, source)
      await assert.rejects(run({ config }), /Configuration/)
    }
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(run({ config: join(dir, 'missing.mjs'), signal: controller.signal }), /cancelled/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('lifetime cancellation closes the host and reports cleanup failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'databehave-cli-'))
  try {
    const config = join(dir, 'config.mjs')
    await writeFile(config, `export default () => ({ plugins: [{
      id:'fixture', apiVersion:1, setup() {},
      activate(ctx) { ctx.defer(() => { throw new Error('cleanup fixture') }) }
    }] })`)
    const controller = new AbortController()
    const handle = await run({ config, signal: controller.signal })
    controller.abort()
    await assert.rejects(handle.close(), /cleanup/)
    assert.equal(handle.host.state, 'failed')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
