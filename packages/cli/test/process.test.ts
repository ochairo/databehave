import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const execute = (args: readonly string[], onReady?: () => void) => {
  const child = spawn(process.execPath, [new URL('../src/bin.js', import.meta.url).pathname, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  let errors = ''
  let signalled = false
  child.stdout.on('data', chunk => {
    output += String(chunk)
    if (onReady && !signalled && output.includes('[databehave] ready')) {
      signalled = true
      onReady()
      child.kill('SIGTERM')
    }
  })
  child.stderr.on('data', chunk => { errors += String(chunk) })
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
  return new Promise<{ code: number | null; signal: string | null; output: string; errors: string }>((resolve, reject) => {
    child.on('error', error => { clearTimeout(timeout); reject(error) })
    child.on('exit', (code, signal) => { clearTimeout(timeout); resolve({ code, signal, output, errors }) })
  })
}

test('actual CLI help and argument/configuration failures have defined exit statuses', async () => {
  assert.equal((await execute(['--help'])).code, 0)
  assert.equal((await execute([])).code, 2)
  const missing = await execute(['/missing/databehave-fixture.mjs'])
  assert.equal(missing.code, 1)
  assert.match(missing.errors, /failed/)
})

test('actual CLI SIGTERM awaits disposal and reports disposal failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'databehave-cli-process-'))
  try {
    for (const fails of [false, true]) {
      const marker = join(directory, `closed-${fails}`)
      const config = join(directory, `config-${fails}.mjs`)
      await writeFile(config, `import {writeFile} from 'node:fs/promises';
        export default () => ({plugins:[{id:'process-fixture',apiVersion:1,setup(){},
          activate(ctx){const timer=setInterval(()=>{},100);ctx.defer(async()=>{
            clearInterval(timer);await writeFile(${JSON.stringify(marker)},'closed');
            ${fails ? "throw new Error('fixture disposal failure')" : ''}
          })}
        }]})`)
      let ready = false
      const result = await execute([config], () => { ready = true })
      assert.equal(ready, true)
      assert.equal(result.signal, null)
      assert.equal(result.code, fails ? 1 : 0, result.errors)
      assert.equal(await readFile(marker, 'utf8'), 'closed')
      if (fails) assert.match(result.errors, /fixture disposal failure/)
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('an idle composition runs cleanup and exits without unsettled top-level await', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'databehave-cli-idle-'))
  try {
    const config = join(directory, 'config.mjs')
    const marker = join(directory, 'closed')
    await writeFile(config, `import {writeFile} from 'node:fs/promises';
      export default () => ({plugins:[{id:'idle-fixture',apiVersion:1,setup(){},
        activate(ctx){ctx.defer(()=>writeFile(${JSON.stringify(marker)},'closed'))}
      }]})`)
    const result = await execute([config])
    assert.equal(result.code, 0, result.errors)
    assert.equal(result.signal, null)
    assert.equal(result.errors, '')
    assert.equal(await readFile(marker, 'utf8'), 'closed')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
