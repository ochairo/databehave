import type { OpenApiDoc, OpenApiSchema } from '../types'
import { esc } from '../html'

const resolveRef = (ref: string, doc: OpenApiDoc | null): OpenApiSchema | undefined => {
  const key = ref.replace(/^#\/components\/schemas\//, '')
  return doc?.components?.schemas?.[key]
}
const typeOf = (s: OpenApiSchema | undefined): string => {
  if (!s) return 'any'
  if (s.$ref) return s.$ref.split('/').pop() ?? 'ref'
  if (s.type === 'array') return `${typeOf(s.items)}[]`
  return s.type ?? (s.properties ? 'object' : 'any')
}

/**
 * Pure render helper used by `<dbh-spec-zone>`. Returns the schema
 * tree as an HTML string. Implemented as a plain function (not a
 * custom element) because the tree is purely declarative and re-renders
 * with its parent.
 */
export const renderSchemaTree = (
  schema: OpenApiSchema | undefined,
  doc: OpenApiDoc | null,
  depth = 0,
  name?: string,
  required?: boolean,
): string => {
  if (!schema) return `<span class="type">any</span>`
  if (depth > 6) return `<span class="type">…</span>`
  const resolved = schema.$ref ? resolveRef(schema.$ref, doc) ?? schema : schema
  const label = name
    ? `<span class="key">${esc(name)}${required ? '<span class="req">*</span>' : ''}: </span>`
    : ''
  const typ = `<span class="type">${esc(typeOf(resolved))}</span>`
  const open = depth < 2 ? ' open' : ''
  if (resolved.type === 'object' || resolved.properties) {
    return `<details${open}><summary>${label}${typ}</summary>` +
      Object.entries(resolved.properties ?? {})
        .map(([k, v]) => renderSchemaTree(v, doc, depth + 1, k, resolved.required?.includes(k)))
        .join('') +
      `</details>`
  }
  if (resolved.type === 'array') {
    return `<details${open}><summary>${label}${typ}</summary>` +
      renderSchemaTree(resolved.items, doc, depth + 1) +
      `</details>`
  }
  return `<div style="margin-left:${depth ? 14 : 0}px">${label}${typ}</div>`
}
