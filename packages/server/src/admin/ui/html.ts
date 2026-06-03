/**
 * Minimal helpers used by the native Web Component admin UI.
 *
 *   esc(value)   — escape a string for safe interpolation into HTML.
 *   attr(value)  — escape + double-quote, returns `"…"` ready for an
 *                  attribute, or `""` for nullish.
 *   html`…`      — template literal tag that auto-escapes interpolated
 *                  values. Pass `raw('<b>x</b>')` to opt out for a
 *                  fragment you've already sanitised.
 *
 * Returned strings get assigned to `element.innerHTML`; there is no
 * VDOM, no diffing — each component re-renders its own subtree.
 */

const escMap: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export const esc = (v: unknown): string => {
  if (v == null) return ''
  return String(v).replace(/[&<>"']/g, (c) => escMap[c] ?? c)
}

export const attr = (v: unknown): string => `"${esc(v)}"`

const RAW = Symbol('raw')
type RawHtml = { [RAW]: true; value: string }
export const raw = (s: string): RawHtml => ({ [RAW]: true, value: s })

const isRaw = (v: unknown): v is RawHtml =>
  typeof v === 'object' && v !== null && (v as { [RAW]?: true })[RAW] === true

export const html = (strings: TemplateStringsArray, ...values: unknown[]): string => {
  let out = ''
  for (let i = 0; i < strings.length; i++) {
    out += strings[i] ?? ''
    if (i < values.length) {
      const v = values[i]
      if (Array.isArray(v)) {
        for (const item of v) out += isRaw(item) ? item.value : esc(item)
      } else if (isRaw(v)) {
        out += v.value
      } else if (v === false || v == null) {
        // skip falsy interpolations entirely
      } else {
        out += esc(v)
      }
    }
  }
  return out
}
