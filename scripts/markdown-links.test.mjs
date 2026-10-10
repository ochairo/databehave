import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkMarkdownLinks } from './markdown-links.mjs'

test('checks inline/reference/image links and duplicate headings while ignoring code examples', async () => {
  const root = await mkdtemp(join(tmpdir(), 'databehave-docs-'))
  try {
    await writeFile(join(root, 'target.md'), '# Hello `world`\n# Hello world\n')
    await writeFile(join(root, 'readme.md'), '[first](target.md#hello-world)\n[second][ref]\n[ref]: target.md#hello-world-1\n```md\n[fake](absent.md)\n```\n![image](missing.png)\n[bad](target.md#absent)\n[missing](absent.md)\n')
    const errors = await checkMarkdownLinks([join(root, 'readme.md')], root)
    assert.equal(errors.length, 3)
    assert.ok(errors.some((error) => error.includes('missing anchor')))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rejects path escapes, private targets and symlinks before reading target content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'databehave-docs-'))
  try {
    await symlink('/etc', join(root, 'outside'))
    await writeFile(join(root, 'readme.md'), '[a](../other.md)\n[b](.env)\n[c](outside/passwd)\n')
    const errors = await checkMarkdownLinks([join(root, 'readme.md')], root)
    assert.equal(errors.length, 3)
    assert.ok(errors[2].includes('symlink escapes'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rejects an ordinary documentation link that resolves to a private path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'databehave-docs-'))
  try {
    await writeFile(join(root, '.env.fixture.md'), '# Synthetic fixture\n')
    await symlink('.env.fixture.md', join(root, 'visible.md'))
    await writeFile(join(root, 'readme.md'), '[alias](visible.md#synthetic-fixture)\n')
    const errors = await checkMarkdownLinks([join(root, 'readme.md')], root)
    assert.equal(errors.length, 1)
    assert.match(errors[0], /private symlink target/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
