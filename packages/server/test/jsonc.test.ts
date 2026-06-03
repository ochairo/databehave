import { describe, expect, it } from 'vitest'

import { stripJsonc } from '../src/jsonc.js'

const parse = (s: string): unknown => JSON.parse(stripJsonc(s))

describe('stripJsonc', () => {
  it('is a no-op on plain valid JSON', () => {
    const json = '{"a":1,"b":[1,2,3],"c":"hi"}'
    expect(stripJsonc(json)).toBe(json)
  })

  it('strips // line comments to end of line', () => {
    expect(parse('{ "a": 1 // a comment\n, "b": 2 }')).toEqual({ a: 1, b: 2 })
  })

  it('preserves newlines so line numbers are kept', () => {
    const out = stripJsonc('// hi\n{"a":1}')
    expect(out.startsWith('     \n')).toBe(true)
    expect(JSON.parse(out)).toEqual({ a: 1 })
  })

  it('strips /* block comments */ including multi-line', () => {
    const src = `{
      /* this is
         a block
         comment */
      "a": 1
    }`
    expect(parse(src)).toEqual({ a: 1 })
    // Newlines inside block comments are preserved.
    expect(stripJsonc(src).split('\n').length).toBe(src.split('\n').length)
  })

  it('removes trailing comma before }', () => {
    expect(parse('{ "a": 1, }')).toEqual({ a: 1 })
  })

  it('removes trailing comma before ]', () => {
    expect(parse('[ 1, 2, 3, ]')).toEqual([1, 2, 3])
  })

  it('removes trailing comma followed by comments before ]', () => {
    expect(parse('[ 1, 2, /* trailing */ ]')).toEqual([1, 2])
  })

  it('does NOT treat // inside strings as a comment', () => {
    expect(parse('{ "url": "http://example.com//foo" }')).toEqual({
      url: 'http://example.com//foo',
    })
  })

  it('does NOT treat /* inside strings as a comment', () => {
    expect(parse('{ "s": "/* not a comment */" }')).toEqual({
      s: '/* not a comment */',
    })
  })

  it('does NOT treat , inside strings as a trailing comma', () => {
    expect(parse('{ "s": "x,", "n": 1 }')).toEqual({ s: 'x,', n: 1 })
  })

  it('handles escaped quotes inside strings', () => {
    expect(parse('{ "s": "a\\"b//c" }')).toEqual({ s: 'a"b//c' })
  })

  it('handles backslash before quote (regression: do not exit string early)', () => {
    expect(parse('{ "s": "a\\\\", "n": 1 }')).toEqual({ s: 'a\\', n: 1 })
  })

  it('handles nested arrays with trailing commas at multiple depths', () => {
    expect(parse('{ "a": [1, [2, 3,], 4,], "b": 5, }')).toEqual({
      a: [1, [2, 3], 4],
      b: 5,
    })
  })

  it('handles empty object and empty array unchanged', () => {
    expect(parse('{}')).toEqual({})
    expect(parse('[]')).toEqual([])
  })

  it('strips JSONC features when surrounded by whitespace and comments', () => {
    const src = `// header comment
{
  // a comment
  "a": 1, // inline trailing
  /* block */
  "b": [
    1, // one
    2, // two
    3, /* three */
  ],
}
// trailing comment
`
    expect(parse(src)).toEqual({ a: 1, b: [1, 2, 3] })
  })

  it('preserves column position for JSON.parse error messages', () => {
    // `true` ends at column 13 in the original; comment before it
    // becomes spaces, so JSON.parse still sees `true` at column 13.
    const src = '{ "a": /**/ true }'
    const out = stripJsonc(src)
    expect(out.indexOf('true')).toBe(src.indexOf('true'))
  })

  it('handles // comment with no trailing newline (EOF)', () => {
    expect(parse('{"a":1}\n// trailing\n')).toEqual({ a: 1 })
    expect(parse('{"a":1}// no newline at eof')).toEqual({ a: 1 })
  })

  it('handles /* comment that runs to EOF without closing */ gracefully', () => {
    // Malformed input — we just consume the rest. Subsequent JSON.parse
    // will fail with a normal SyntaxError, which is acceptable.
    const out = stripJsonc('{"a":1} /* never closed')
    expect(out.startsWith('{"a":1} ')).toBe(true)
    // The remaining text after the opening "/*" is wiped to spaces.
    expect(out.slice(8)).toMatch(/^\s*$/)
  })
})
