import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import GithubSlugger from 'github-slugger'

const parser = unified().use(remarkParse)
const privateTarget = (path) => path.split('/').some((part) => /^(?:\.env(?:\.|$)|id_)|\.(?:key|pem)$/.test(part))
const textOf = (node) => node.value ?? node.children?.map(textOf).join('') ?? ''
const inside = (root, file) => {
  const path = relative(root, file)
  return path !== '..' && !path.startsWith('../') && !isAbsolute(path)
}

export async function checkMarkdownLinks(files, root) {
  const repository = await realpath(root)
  const cache = new Map()
  const errors = []
  async function document(file) {
    if (cache.has(file)) return cache.get(file)
    const tree = parser.parse(await readFile(file, 'utf8'))
    const anchors = new Set()
    const links = []
    const slugger = new GithubSlugger()
    function visit(node) {
      if (node.type === 'heading') {
        const text = textOf(node)
        anchors.add(slugger.slug(text))
        const explicit = /\{#([^}]+)\}$/.exec(text)
        if (explicit) anchors.add(explicit[1])
      }
      if (node.type === 'html') {
        for (const match of node.value.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) anchors.add(match[1])
      }
      if (['link', 'image', 'definition'].includes(node.type)) links.push(node.url)
      node.children?.forEach(visit)
    }
    visit(tree)
    const result = { anchors, links }
    cache.set(file, result)
    return result
  }
  for (const input of files) {
    const file = await realpath(input)
    if (!inside(repository, file)) throw new Error(`Documentation outside repository: ${input}`)
    if (privateTarget(file)) throw new Error('Private target is not documentation')
    for (const link of (await document(file)).links) {
      if (/^[a-z][a-z\d+.-]*:/i.test(link) || link.startsWith('//')) continue
      try {
        const [location, fragment] = link.split('#', 2)
        const pathname = decodeURIComponent(location.split('?', 1)[0])
        if (privateTarget(pathname)) throw new Error('private target is not documentation')
        let target = pathname ? resolve(pathname.startsWith('/') ? repository : dirname(file), pathname.replace(/^\//, '')) : file
        if (!inside(repository, target)) throw new Error('target escapes repository')
        target = await realpath(target)
        if (!inside(repository, target)) throw new Error('symlink escapes repository')
        if (privateTarget(target)) throw new Error('private symlink target is not documentation')
        const info = await stat(target)
        if (fragment && info.isFile() && extname(target) === '.md') {
          const anchor = decodeURIComponent(fragment)
          if (!(await document(target)).anchors.has(anchor)) throw new Error(`missing anchor #${anchor}`)
        }
      } catch (error) {
        errors.push(`${relative(repository, file)}: ${link}: ${error.message}`)
      }
    }
  }
  return errors
}
