/**
 * Minimal JSONC → JSON sanitizer (zero-dep).
 *
 * Transforms JSONC source into strict JSON by:
 *   1. Replacing `// line comments` with spaces (newline preserved)
 *   2. Replacing `/* block comments * /` with spaces / newlines
 *   3. Removing trailing commas immediately before `}` or `]`
 *
 * Character positions (line + column) are preserved so any subsequent
 * `JSON.parse` error messages point at the right spot in the original
 * source. The output is byte-for-byte parseable by the native
 * `JSON.parse` — no JSON5 numeric/identifier extensions are accepted.
 *
 * Single-pass character scanner. String contents (including escaped
 * quotes) are passed through untouched, so `//`, `/*`, and `,` inside
 * string literals are never mistaken for syntax tokens.
 */

/**
 * Strip JSONC features from `input` so the result is strict JSON.
 *
 * Always safe to call on valid JSON (it becomes a no-op pass-through).
 */
export const stripJsonc = (input: string): string => {
  const n = input.length
  const out: string[] = []
  /** Index in `out` of the last structural `,` seen at the top level
   *  (or `-1` if none is currently a candidate for trailing-removal). */
  let lastCommaIdx = -1
  let i = 0

  while (i < n) {
    const c = input[i]!
    const next = i + 1 < n ? input[i + 1]! : ''

    // --- string literal: copy verbatim, honour escapes ---
    if (c === '"') {
      out.push(c)
      i++
      while (i < n) {
        const sc = input[i]!
        if (sc === '\\' && i + 1 < n) {
          out.push(sc, input[i + 1]!)
          i += 2
          continue
        }
        out.push(sc)
        i++
        if (sc === '"') break
      }
      // A string literal is a value token — clears any pending comma
      // tracking only when it isn't the first thing after `,`.
      // Actually: it does NOT clear, because the next non-ws token
      // after the string (`:` for keys, `,`/`]`/`}` for values) does
      // the right thing. Strings themselves are passed through.
      continue
    }

    // --- line comment ---
    if (c === '/' && next === '/') {
      out.push(' ', ' ')
      i += 2
      while (i < n && input[i] !== '\n') {
        out.push(' ')
        i++
      }
      continue
    }

    // --- block comment ---
    if (c === '/' && next === '*') {
      out.push(' ', ' ')
      i += 2
      while (i < n) {
        if (input[i] === '*' && i + 1 < n && input[i + 1] === '/') {
          out.push(' ', ' ')
          i += 2
          break
        }
        out.push(input[i] === '\n' ? '\n' : ' ')
        i++
      }
      continue
    }

    if (c === ',') {
      lastCommaIdx = out.length
      out.push(c)
      i++
      continue
    }

    if (c === '}' || c === ']') {
      if (lastCommaIdx >= 0) {
        let onlyWs = true
        for (let k = lastCommaIdx + 1; k < out.length; k++) {
          const ch = out[k]!
          if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') {
            onlyWs = false
            break
          }
        }
        if (onlyWs) out[lastCommaIdx] = ' '
      }
      lastCommaIdx = -1
      out.push(c)
      i++
      continue
    }

    if (c === '{' || c === '[') {
      lastCommaIdx = -1
      out.push(c)
      i++
      continue
    }

    // Whitespace keeps the trailing-comma tracker alive.
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      out.push(c)
      i++
      continue
    }

    // Any other character (numbers, true/false/null, etc.) is a value
    // token — it invalidates the trailing-comma candidate.
    lastCommaIdx = -1
    out.push(c)
    i++
  }

  return out.join('')
}
