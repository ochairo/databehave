import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const update = process.argv.includes('--update')
for (const entry of readdirSync('packages', { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const directory = resolve('packages', entry.name)
  for (const config of readdirSync(directory).filter(name => /^api-extractor(?:\.[\w-]+)?\.json$/.test(name))) {
    const result = spawnSync('pnpm', ['exec', 'api-extractor', 'run', '--config', config, ...(update ? ['--local'] : [])], {
      cwd: directory, stdio: 'inherit',
    })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
}
