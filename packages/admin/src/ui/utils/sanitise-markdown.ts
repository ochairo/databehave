/**
 * Tiny safe renderer for OpenAPI `description` strings. Splits on
 * blank lines into paragraphs; renders `\`backtick\`` as <code>;
 * escapes everything else. Returns an HTML string suitable for
 * `dangerouslySetInnerHTML`.
 */
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export const sanitiseMarkdown = (raw: string | undefined): string => {
  if (!raw) return ''
  const paras = raw.split(/\n{2,}/)
  return paras
    .map((p) => {
      const safe = esc(p.trim())
      const withCode = safe.replace(/`([^`]+)`/g, (_m, inner: string) => `<code>${inner}</code>`)
      const withBr = withCode.replace(/\n/g, '<br/>')
      return `<p>${withBr}</p>`
    })
    .join('')
}
