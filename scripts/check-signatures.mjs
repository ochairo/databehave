import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'

export function lockedPackages(lock) {
  assert.equal(lock.lockfileVersion, '9.0', 'Unsupported lockfile version')
  assert.ok(lock.packages && Object.keys(lock.packages).length, 'No locked packages')
  return Object.entries(lock.packages).map(([identity, metadata]) => {
    const match = /^((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(identity)
    assert.ok(match, `Unsupported registry identity: ${identity}`)
    assert.deepEqual(Object.keys(metadata.resolution ?? {}), ['integrity'], `Unsupported resolution: ${identity}`)
    assert.match(metadata.resolution.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/, `Invalid integrity: ${identity}`)
    return { name: match[1], version: match[2] }
  })
}

const execute = (args, options) => execFileSync('npm', args, { ...options, encoding: 'utf8', timeout: 300_000, maxBuffer: 16 * 1024 * 1024 })

// npm owns signature/attestation verification. This projection avoids npm misreading
// pnpm's aliased peer edges; it does not authenticate installed bytes or lock digests.
export async function checkSignatures(lock, runner = execute) {
  const packages = lockedPackages(lock)
  const root = await mkdtemp(join(tmpdir(), 'databehave-signatures-'))
  try {
    const dependencies = {}
    for (const [index, metadata] of packages.entries()) {
      const alias = `locked-${index}`
      dependencies[alias] = `npm:${metadata.name}@${metadata.version}`
      const target = join(root, 'node_modules', alias)
      await mkdir(target, { recursive: true })
      await writeFile(join(target, 'package.json'), JSON.stringify(metadata))
    }
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'signature-audit', private: true, dependencies }))
    await writeFile(join(root, 'user.npmrc'), '')
    await writeFile(join(root, 'global.npmrc'), '')
    const options = { cwd: root, env: {
      PATH: process.env.PATH, HOME: root, TMPDIR: root, LANG: 'C', NO_COLOR: '1',
      npm_config_userconfig: join(root, 'user.npmrc'), npm_config_globalconfig: join(root, 'global.npmrc'),
      npm_config_cache: join(root, 'cache'), npm_config_update_notifier: 'false',
    } }
    assert.equal((await runner(['--version'], options)).trim(), '11.19.1', 'Use the pinned Node 24.22.1/npm 11.19.1 quality runtime')
    const output = await runner(['audit', 'signatures', '--registry=https://registry.npmjs.org'], options)
    assert.equal(Number(/audited (\d+) packages? in/.exec(output)?.[1]), packages.length, 'Incomplete signature coverage')
    return output
  } finally { await rm(root, { recursive: true, force: true }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(await checkSignatures(parse(await readFile('pnpm-lock.yaml', 'utf8'))))
}
