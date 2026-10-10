import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { checkMarkdownLinks } from './markdown-links.mjs'

const files = ['README.md', 'MIGRATION.md']
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) await collect(file)
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(file)
  }
}
await collect('docs')
await collect('packages/schema/docs')
for (const entry of await readdir('packages', { withFileTypes: true })) {
  if (entry.isDirectory()) files.push(`packages/${entry.name}/README.md`, `packages/${entry.name}/CHANGELOG.md`)
}
const errors = await checkMarkdownLinks(files, resolve('.'))
if (errors.length) throw new Error(`Broken local documentation links:\n${errors.join('\n')}`)
console.log(`Checked local targets and Markdown anchors in ${files.length} documentation files.`)
