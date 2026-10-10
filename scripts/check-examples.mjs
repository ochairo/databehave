import { mkdtemp, mkdir, cp, readdir, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const fixture = await mkdtemp(join(tmpdir(), 'databehave-examples-'))
try {
  const modules = join(fixture, 'node_modules/@databehave')
  await mkdir(modules, { recursive: true })
  for (const name of ['core', 'schema', 'server']) await symlink(resolve('packages', name), join(modules, name))
  await cp('examples', join(fixture, 'examples'), { recursive: true })
  for (const file of await readdir(join(fixture, 'examples'))) {
    if (file.endsWith('.mjs')) execFileSync(process.execPath, [join(fixture, 'examples', file)], { stdio: 'inherit', timeout: 15_000 })
  }
} finally { await rm(fixture, { recursive: true, force: true }) }
