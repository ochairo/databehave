import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, parse, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'

export const packageDirectories = Object.freeze(['core', 'schema', 'server', 'cli', 'openapi', 'admin'])
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestFile = 'release-manifest.json'
const sbomFile = 'sbom.cdx.json'
const dependencyFields = ['dependencies', 'optionalDependencies', 'peerDependencies']

function check(condition, message) {
  if (!condition) throw new Error(message)
}
function keys(value, expected, label) {
  check(value && typeof value === 'object' && !Array.isArray(value), `Invalid ${label}`)
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `Unexpected ${label} fields`)
}
function revision(value) {
  check(typeof value === 'string' && /^[a-f0-9]{40}$/.test(value), 'Expected a full lowercase source SHA')
}
function digest(bytes) {
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  }
}
async function regularFile(path) {
  check((await lstat(path)).isFile(), `Expected regular file: ${path}`)
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    check(stat.isFile() && stat.nlink === 1, `Expected regular file without hard links: ${path}`)
    return await handle.readFile()
  } finally { await handle.close() }
}
async function directory(path) {
  const absolute = resolve(path)
  let current = parse(absolute).root
  for (const part of absolute.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part)
    const stat = await lstat(current)
    check(stat.isDirectory() && !stat.isSymbolicLink(), `Expected real directory: ${current}`)
  }
  check(await realpath(absolute) === absolute, `Unsafe directory: ${absolute}`)
  return absolute
}

export function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', timeout: 300_000 })
  if (result.error) throw result.error
  check(result.status === 0, `${command} failed (${result.signal ?? result.status}); stopped without retry`)
}

export async function releasePackages(root = repository) {
  const packages = await Promise.all(packageDirectories.map(async directory => {
    const metadata = JSON.parse(await readFile(join(root, 'packages', directory, 'package.json'), 'utf8'))
    check(metadata.name === `@databehave/${directory}`, `Unexpected package name: ${directory}`)
    check(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(metadata.version), `Invalid version: ${metadata.name}`)
    return { directory, ...metadata }
  }))
  const ordered = []
  const pending = new Map(packages.map(item => [item.name, item]))
  while (pending.size) {
    const ready = [...pending.values()].find(item => dependencyFields.every(field =>
      Object.keys(item[field] ?? {}).every(name => !pending.has(name))))
    check(ready, 'Cyclic release package dependencies')
    ordered.push(ready)
    pending.delete(ready.name)
  }
  return ordered
}
function publishedDependencies(metadata, packages) {
  return Object.fromEntries(dependencyFields.map(field => [field, Object.fromEntries(
    Object.entries(metadata[field] ?? {}).map(([name, range]) => {
      if (!range.startsWith('workspace:')) return [name, range]
      const target = packages.find(item => item.name === name)
      check(target, `Unknown workspace dependency: ${name}`)
      const specifier = range.slice('workspace:'.length)
      check(['*', '^', '~'].includes(specifier), `Unsupported workspace dependency: ${range}`)
      return [name, `${specifier === '*' ? '' : specifier}${target.version}`]
    }),
  )]))
}

// Inspect bytes without extracting files or running code from the archive.
export function tarballMetadata(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 })
  let metadata
  const paths = new Set()
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) {
      check(tar.subarray(offset).every(byte => byte === 0), 'Data after archive terminator')
      break
    }
    const text = (start, length) => header.subarray(start, start + length).toString().split('\0')[0]
    check(header.subarray(257, 265).equals(Buffer.from('ustar\x0000')), 'Expected POSIX ustar archive')
    const checksum = text(148, 8).trim()
    const actualChecksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0)
    check(/^[0-7]+$/.test(checksum) && Number.parseInt(checksum, 8) === actualChecksum, 'Invalid archive checksum')
    const prefix = text(345, 155)
    const name = `${prefix ? `${prefix}/` : ''}${text(0, 100)}`
    const kind = text(156, 1)
    check(['', '0', '5'].includes(kind), `Unsupported archive entry: ${name} (${kind})`)
    const path = kind === '5' && name.endsWith('/') ? name.slice(0, -1) : name
    check((path.startsWith('package/') || (path === 'package' && kind === '5')) && !path.includes('\\') && path.split('/').every(part => part && part !== '..' && part !== '.'), `Unsafe archive path: ${name}`)
    check(!paths.has(path), `Duplicate archive path: ${name}`)
    paths.add(path)
    const rawSize = text(124, 12).trim()
    check(/^[0-7]+$/.test(rawSize), `Invalid archive size: ${name}`)
    const size = Number.parseInt(rawSize, 8)
    check(kind !== '5' || size === 0, `Directory contains archive data: ${name}`)
    check(offset + 512 + size <= tar.length, `Truncated archive: ${name}`)
    if (name === 'package/package.json') {
      check(kind !== '5', 'Package metadata must be a regular file')
      metadata = JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString())
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  check(metadata, 'Missing package/package.json')
  return metadata
}
function validateMetadata(bytes, expected, packages) {
  const actual = tarballMetadata(bytes)
  check(actual.name === expected.name && actual.version === expected.version, `Tarball identity mismatch: ${expected.name}`)
  for (const [field, dependencies] of Object.entries(publishedDependencies(expected, packages))) {
    assert.deepEqual(actual[field] ?? {}, dependencies, `Tarball ${field} mismatch: ${expected.name}`)
  }
  assert.deepEqual(actual.publishConfig ?? {}, expected.publishConfig ?? {}, `Tarball publishConfig mismatch: ${expected.name}`)
  for (const key of Object.keys(actual.publishConfig ?? {})) {
    check(['access', 'provenance'].includes(key), `Unsupported publishConfig: ${key}`)
  }
  if (actual.publishConfig?.access !== undefined) check(actual.publishConfig.access === 'public', 'Expected public access')
  if (actual.publishConfig?.provenance !== undefined) check(actual.publishConfig.provenance === true, 'Expected provenance')
}

export async function verifyBundle(artifactDirectory, sourceSha, { root = repository } = {}) {
  revision(sourceSha)
  const bundle = await directory(artifactDirectory)
  const manifest = JSON.parse((await regularFile(join(bundle, manifestFile))).toString())
  keys(manifest, ['formatVersion', 'sourceSha', 'packages', 'sbom'], 'manifest')
  check(manifest.formatVersion === 1 && manifest.sourceSha === sourceSha, 'Bundle source revision mismatch')
  const packages = await releasePackages(root)
  check(Array.isArray(manifest.packages) && manifest.packages.length === packages.length, 'Incomplete package set')
  const allowlist = [manifestFile, sbomFile]
  for (let index = 0; index < packages.length; index++) {
    const expected = packages[index]
    const item = manifest.packages[index]
    keys(item, ['name', 'version', 'tarball', 'sha256', 'integrity'], 'package')
    check(item.name === expected.name && item.version === expected.version, 'Package identity or dependency order mismatch')
    check(item.tarball === `databehave-${expected.directory}-${expected.version}.tgz`, 'Unsafe or unexpected tarball name')
    allowlist.push(item.tarball)
  }
  keys(manifest.sbom, ['file', 'sha256', 'integrity', 'tool'], 'SBOM')
  check(manifest.sbom.file === sbomFile, 'Unexpected SBOM path')
  const rootMetadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const tool = sbomTool(rootMetadata)
  assert.deepEqual(manifest.sbom.tool, tool, 'SBOM tool identity mismatch')
  assert.deepEqual((await readdir(bundle)).sort(), allowlist.sort(), 'Missing or unexpected bundle files')
  for (const item of [...manifest.packages, manifest.sbom]) {
    const bytes = await regularFile(join(bundle, item.tarball ?? item.file))
    const hashes = digest(bytes)
    check(hashes.sha256 === item.sha256 && hashes.integrity === item.integrity, `Bundle digest mismatch: ${item.tarball ?? item.file}`)
    if (item.tarball) validateMetadata(bytes, packages.find(expected => expected.name === item.name), packages)
    else check(JSON.parse(bytes.toString()).bomFormat === 'CycloneDX', 'Expected CycloneDX SBOM')
  }
  return manifest
}
function sbomTool(rootMetadata) {
  const name = ['@cyclonedx/cdxgen', '@cdxgen/cdxgen'].find(name => rootMetadata.devDependencies?.[name])
  const version = rootMetadata.devDependencies?.[name]
  check(name && /^\d+\.\d+\.\d+$/.test(version), 'cdxgen must be pinned to an exact version in devDependencies')
  return { name, version }
}
export async function prepareBundle(artifactDirectory, sourceSha, { root = repository, runner = run } = {}) {
  revision(sourceSha)
  const bundle = resolve(artifactDirectory)
  await mkdir(bundle, { recursive: true })
  await directory(bundle)
  check((await readdir(bundle)).length === 0, 'Prepare requires an empty artifact directory')
  const packages = await releasePackages(root)
  const rootMetadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const tool = sbomTool(rootMetadata)
  const installed = JSON.parse(await readFile(join(root, 'node_modules', tool.name, 'package.json'), 'utf8'))
  check(installed.version === tool.version, 'Installed cdxgen version does not match pin')
  for (const metadata of packages) {
    check(!['prepack', 'postpack', 'prepare', 'prepublishOnly'].some(hook => metadata.scripts?.[hook]), `Remove packing/publishing hooks: ${metadata.name}`)
    await directory(join(root, 'packages', metadata.directory, 'dist'))
  }
  const entries = []
  for (const metadata of packages) {
    await runner('pnpm', ['--filter', metadata.name, 'pack', '--pack-destination', bundle], root)
    const tarball = `databehave-${metadata.directory}-${metadata.version}.tgz`
    const bytes = await regularFile(join(bundle, tarball))
    validateMetadata(bytes, metadata, packages)
    entries.push({ name: metadata.name, version: metadata.version, tarball, ...digest(bytes) })
  }
  await runner('pnpm', ['exec', 'cdxgen', '-t', 'js', '--no-install-deps', '--no-babel', '-o', join(bundle, sbomFile), root], root)
  const sbom = await regularFile(join(bundle, sbomFile))
  const manifest = { formatVersion: 1, sourceSha, packages: entries, sbom: { file: sbomFile, ...digest(sbom), tool } }
  await writeFile(join(bundle, manifestFile), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  return verifyBundle(bundle, sourceSha, { root })
}

export async function publishBundle(artifactDirectory, sourceSha, { root = repository, runner = run, dryRun = false } = {}) {
  const bundle = resolve(artifactDirectory)
  const manifest = await verifyBundle(bundle, sourceSha, { root })
  for (const item of manifest.packages) {
    // Recheck the complete bundle immediately before each external effect.
    const current = await verifyBundle(bundle, sourceSha, { root })
    assert.deepEqual(current, manifest, 'Bundle changed during publication')
    const args = ['publish', join(bundle, item.tarball), '--ignore-scripts', '--provenance', '--access', 'public', '--registry', 'https://registry.npmjs.org', '--tag', 'latest']
    if (dryRun) args.push('--dry-run')
    try { await runner('npm', args, root) }
    catch (error) { throw new Error(`Stopped at ${item.name}@${item.version}; earlier packages may have succeeded. Reconcile registry state before explicit recovery. No retry performed.`, { cause: error }) }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, artifactDirectory, sourceSha, ...extra] = process.argv.slice(2)
  try {
    check(artifactDirectory && sourceSha && !extra.length && ['prepare', 'verify', 'dry-run', 'publish'].includes(command), 'Usage: node scripts/release.mjs <prepare|verify|dry-run|publish> ARTIFACT_DIR SOURCE_SHA')
    if (command === 'prepare') await prepareBundle(artifactDirectory, sourceSha)
    else if (command === 'verify') await verifyBundle(artifactDirectory, sourceSha)
    else await publishBundle(artifactDirectory, sourceSha, { dryRun: command === 'dry-run' })
    console.log(`Release ${command} passed for ${sourceSha}`)
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}
