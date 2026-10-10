import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { gunzipSync, gzipSync } from 'node:zlib'
import { packageDirectories, prepareBundle, publishBundle, releasePackages, tarballMetadata, verifyBundle } from './release.mjs'

const sourceSha = 'a'.repeat(40)
const tool = { name: '@cyclonedx/cdxgen', version: '12.0.0' }
const hash = bytes => ({ sha256: createHash('sha256').update(bytes).digest('hex'), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` })
function archive(metadata, name = 'package/package.json', kind = '0') {
  const bytes = Buffer.from(JSON.stringify(metadata))
  const header = Buffer.alloc(512)
  header.write(name)
  header.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124)
  header.write(kind, 156)
  header.write('ustar\x0000', 257)
  header.fill(32, 148, 156)
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148)
  return gzipSync(Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512), Buffer.alloc(1024)]))
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'databehave-release-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bundle = join(root, 'bundle')
  await mkdir(bundle)
  await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: { [tool.name]: tool.version } }))
  await mkdir(join(root, 'node_modules', tool.name), { recursive: true })
  await writeFile(join(root, 'node_modules', tool.name, 'package.json'), JSON.stringify(tool))
  for (const name of packageDirectories) {
    await mkdir(join(root, 'packages', name, 'dist'), { recursive: true })
    await writeFile(join(root, 'packages', name, 'package.json'), JSON.stringify({
      name: `@databehave/${name}`, version: '1.0.0',
      dependencies: name === 'core' ? {} : { '@databehave/core': 'workspace:^' },
    }))
  }
  const packages = await releasePackages(root)
  const entries = []
  for (const item of packages) {
    const bytes = archive({ ...item, dependencies: item.directory === 'core' ? {} : { '@databehave/core': '^1.0.0' } })
    const tarball = `databehave-${item.directory}-${item.version}.tgz`
    await writeFile(join(bundle, tarball), bytes)
    entries.push({ name: item.name, version: item.version, tarball, ...hash(bytes) })
  }
  const sbom = Buffer.from(JSON.stringify({ bomFormat: 'CycloneDX' }))
  await writeFile(join(bundle, 'sbom.cdx.json'), sbom)
  const manifest = { formatVersion: 1, sourceSha, packages: entries, sbom: { file: 'sbom.cdx.json', ...hash(sbom), tool } }
  const save = () => writeFile(join(bundle, 'release-manifest.json'), JSON.stringify(manifest))
  await save()
  return { root, bundle, manifest, save }
}

test('verifies the complete dependency-ordered package set', async t => {
  const { root, bundle, manifest } = await fixture(t)
  assert.deepEqual(await verifyBundle(bundle, sourceSha, { root }), manifest)
})

test('rejects unsafe archive paths and link entries before extraction', () => {
  for (const name of ['../package.json', 'package/../outside', '/package/package.json', 'package/dir\\outside', 'package//package.json', 'package/package.json/']) {
    assert.throws(() => tarballMetadata(archive({}, name)), /Unsafe archive path/)
  }
  for (const kind of ['1', '2', 'x', 'g']) {
    assert.throws(() => tarballMetadata(archive({}, 'package/package.json', kind)), /Unsupported archive entry/)
  }
})

test('rejects parser differences in checksums and data after the terminator', () => {
  const bytes = gunzipSync(archive({ name: 'safe' }))
  const corrupted = Buffer.from(bytes)
  corrupted[0] ^= 1
  assert.throws(() => tarballMetadata(gzipSync(corrupted)), /checksum/)
  assert.throws(() => tarballMetadata(gzipSync(Buffer.concat([bytes, bytes]))), /terminator/)
})

for (const mutation of ['tamper', 'wrong SHA', 'missing', 'extra', 'path escape', 'symlink', 'hardlink', 'directory', 'version', 'order', 'metadata', 'metadata alias', 'SBOM', 'tool']) {
  test(`rejects ${mutation} before any npm invocation`, async t => {
    const { root, bundle, manifest, save } = await fixture(t)
    const tarball = join(bundle, manifest.packages.at(-1).tarball)
    let sha = sourceSha
    if (mutation === 'tamper') await writeFile(tarball, 'changed')
    if (mutation === 'wrong SHA') sha = 'b'.repeat(40)
    if (mutation === 'missing') await rm(tarball)
    if (mutation === 'extra') await writeFile(join(bundle, 'unexpected.txt'), 'extra')
    if (mutation === 'path escape') { manifest.packages.at(-1).tarball = '../outside.tgz'; await save() }
    if (mutation === 'symlink' || mutation === 'hardlink') {
      const target = join(root, 'substitute.tgz')
      await writeFile(target, await readFile(tarball))
      await rm(tarball)
      await (mutation === 'symlink' ? symlink : link)(target, tarball)
    }
    if (mutation === 'directory') { await rm(tarball); await mkdir(tarball) }
    if (mutation === 'version') { manifest.packages.at(-1).version = '9.9.9'; await save() }
    if (mutation === 'order') { manifest.packages.reverse(); await save() }
    if (mutation === 'metadata') {
      const bytes = archive({ name: '@databehave/wrong', version: '1.0.0' })
      await writeFile(tarball, bytes)
      Object.assign(manifest.packages.at(-1), hash(bytes)); await save()
    }
    if (mutation === 'metadata alias') {
      const original = gunzipSync(await readFile(tarball)).subarray(0, -1024)
      const substitute = gunzipSync(archive({ name: '@other/substitute', version: '9.0.0' }, 'package//package.json'))
      const bytes = gzipSync(Buffer.concat([original, substitute]))
      await writeFile(tarball, bytes)
      Object.assign(manifest.packages.at(-1), hash(bytes)); await save()
    }
    if (mutation === 'SBOM') await writeFile(join(bundle, 'sbom.cdx.json'), '{}')
    if (mutation === 'tool') { manifest.sbom.tool.version = '99.0.0'; await save() }
    const calls = []
    await assert.rejects(publishBundle(bundle, sha, { root, runner: (...args) => calls.push(args) }))
    assert.equal(calls.length, 0)
  })
}

test('rejects a symlink artifact directory', async t => {
  const { root, bundle } = await fixture(t)
  const alias = join(root, 'alias')
  await symlink(bundle, alias)
  await assert.rejects(verifyBundle(alias, sourceSha, { root }), /real directory/)
})

test('stops on the first publish failure without retrying', async t => {
  const { root, bundle, manifest } = await fixture(t)
  const calls = []
  await assert.rejects(publishBundle(bundle, sourceSha, { root, runner: (command, args) => {
    calls.push([command, args])
    if (calls.length === 2) throw new Error('synthetic registry failure')
  } }), /earlier packages may have succeeded/)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map(([, args]) => args[1]), manifest.packages.slice(0, 2).map(item => join(bundle, item.tarball)))
})

test('dry-run uses the identical ordered publish arguments plus --dry-run', async t => {
  const { root, bundle, manifest } = await fixture(t)
  const publication = []
  const dryRun = []
  await publishBundle(bundle, sourceSha, { root, runner: (command, args) => publication.push([command, args]) })
  await publishBundle(bundle, sourceSha, { root, dryRun: true, runner: (command, args) => dryRun.push([command, args]) })
  assert.equal(publication.length, packageDirectories.length)
  for (let index = 0; index < publication.length; index++) {
    assert.deepEqual(publication[index], ['npm', ['publish', join(bundle, manifest.packages[index].tarball), '--ignore-scripts', '--provenance', '--access', 'public', '--registry', 'https://registry.npmjs.org', '--tag', 'latest']])
    assert.deepEqual(dryRun[index], ['npm', [...publication[index][1], '--dry-run']])
  }
})

test('revalidates bytes between publication effects', async t => {
  const { root, bundle, manifest } = await fixture(t)
  let calls = 0
  await assert.rejects(publishBundle(bundle, sourceSha, { root, runner: async () => {
    calls++
    await writeFile(join(bundle, manifest.packages.at(-1).tarball), 'changed after initial validation')
  } }), /digest mismatch/)
  assert.equal(calls, 1)
})

test('prepare packs each built package once and disables SBOM dependency installation', async t => {
  const { root, bundle } = await fixture(t)
  const destination = join(root, 'prepared')
  const calls = []
  await prepareBundle(destination, sourceSha, { root, runner: async (command, args) => {
    calls.push([command, args])
    if (args[0] === '--filter') {
      const name = args[1].split('/')[1]
      const file = `databehave-${name}-1.0.0.tgz`
      await writeFile(join(destination, file), await readFile(join(bundle, file)))
    } else await writeFile(join(destination, 'sbom.cdx.json'), await readFile(join(bundle, 'sbom.cdx.json')))
  } })
  assert.equal(calls.length, packageDirectories.length + 1)
  assert.deepEqual(calls.at(-1), ['pnpm', ['exec', 'cdxgen', '-t', 'js', '--no-install-deps', '--no-babel', '-o', join(destination, 'sbom.cdx.json'), root]])
  assert.equal((await readdir(destination)).length, packageDirectories.length + 2)
  await assert.rejects(prepareBundle(destination, sourceSha, { root }), /empty artifact directory/)
})
