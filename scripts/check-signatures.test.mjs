import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkSignatures, lockedPackages } from './check-signatures.mjs'

const integrity = `sha512-${'A'.repeat(86)}==`
const lock = { lockfileVersion: '9.0', packages: {
  '@appthreat/sqlite3@6.0.9': { resolution: { integrity } },
  'example@1.0.0': { resolution: { integrity } },
  'example@2.0.0': { resolution: { integrity }, os: ['darwin'], optional: true },
} }

test('projects aliases, duplicate versions and platform alternatives as complete direct dependencies', async () => {
  let directory
  await checkSignatures(lock, async (args, options) => {
    directory = options.cwd
    assert.equal(options.env.NODE_OPTIONS, undefined)
    assert.equal(options.env.npm_config_registry, undefined)
    if (args[0] === '--version') return '11.19.0\n'
    assert.deepEqual(args, ['audit', 'signatures', '--registry=https://registry.npmjs.org'])
    const root = JSON.parse(await readFile(join(directory, 'package.json')))
    assert.equal(Object.keys(root.dependencies).length, 3)
    assert.equal(root.dependencies['locked-0'], 'npm:@appthreat/sqlite3@6.0.9')
    for (const [index, metadata] of lockedPackages(lock).entries()) {
      assert.deepEqual(JSON.parse(await readFile(join(directory, 'node_modules', `locked-${index}`, 'package.json'))), metadata)
    }
    return 'audited 3 packages in 1s'
  })
  await assert.rejects(stat(directory), { code: 'ENOENT' })
})

test('fails closed for unsupported lock identities and resolutions', () => {
  for (const invalid of [
    { ...lock, lockfileVersion: '10.0' },
    { ...lock, packages: {} },
    { ...lock, packages: { 'file:../local': { resolution: { integrity } } } },
    { ...lock, packages: { 'example@1.0.0': { resolution: { integrity, tarball: 'https://other.example/a.tgz' } } } },
    { ...lock, packages: { 'example@1.0.0': { resolution: { integrity: 'invalid' } } } },
  ]) assert.throws(() => lockedPackages(invalid))
})

test('propagates audit failures and incomplete coverage, cleans up after either', async () => {
  for (const failure of [new Error('invalid signature/network failure'), 'audited 2 packages in 1s']) {
    let directory
    await assert.rejects(checkSignatures(lock, (args, options) => {
      directory = options.cwd
      if (args[0] === '--version') return '11.19.0'
      if (failure instanceof Error) throw failure
      return failure
    }))
    await assert.rejects(stat(directory), { code: 'ENOENT' })
  }
})
