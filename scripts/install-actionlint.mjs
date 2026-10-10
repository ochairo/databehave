import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm, copyFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

// Official release checksums; update version and both hashes together.
const version = '1.7.12'
const targets = {
  x64: ['amd64', '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8'],
  arm64: ['arm64', '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6'],
}
const target = targets[process.arch]
if (process.platform !== 'linux' || !target) throw new Error('actionlint installer supports Linux x64/arm64')
if (process.argv.length !== 3) throw new Error('Usage: node scripts/install-actionlint.mjs DESTINATION_DIRECTORY')
const destination = resolve(process.argv[2])
const temporary = await mkdtemp(join(tmpdir(), 'databehave-actionlint-'))
try {
  const response = await fetch(`https://github.com/rhysd/actionlint/releases/download/v${version}/actionlint_${version}_linux_${target[0]}.tar.gz`, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`actionlint download failed: HTTP ${response.status}`)
  const archive = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(archive).digest('hex') !== target[1]) throw new Error('actionlint checksum mismatch')
  const file = join(temporary, 'actionlint.tar.gz')
  await writeFile(file, archive)
  execFileSync('tar', ['-xzf', file, '-C', temporary, 'actionlint'])
  await mkdir(destination, { recursive: true })
  await copyFile(join(temporary, 'actionlint'), join(destination, 'actionlint'))
  await chmod(join(destination, 'actionlint'), 0o755)
} finally { await rm(temporary, { recursive: true, force: true }) }
