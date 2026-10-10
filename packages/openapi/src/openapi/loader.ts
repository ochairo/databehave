/**
 * Parse a JSON OpenAPI document.
 *
 * Consumers hand `@databehave/openapi` the raw text — how they obtained it
 * (`fs.readFile`, `fetch`, bundler `?raw` import) is up to them.
 *
 * `@databehave/openapi` is JSON-only. Convert YAML up-front
 * (`yq -o=json spec.yaml > spec.json`) and pass the JSON bytes through.
 */
import type { OasDoc } from './walker.js'

/**
 * Parse a JSON OpenAPI document.
 *
 * `sourcePath` is optional metadata used only to enrich error messages
 * and to refuse YAML inputs by extension with an actionable hint.
 */
export const parseOpenApi = (text: string, sourcePath?: string): OasDoc => {
  // Strip a leading UTF-8 BOM (U+FEFF) if present — common when the
  // OAS document was authored in Windows tooling or saved as
  // "UTF-8 with BOM". Without this, the very first `JSON.parse`
  // throws "Unexpected token" with no actionable hint.
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  if (sourcePath !== undefined && /\.ya?ml$/i.test(sourcePath)) {
    throw new Error(
      'JSON-only spec loader. Convert YAML first: yq -o=json <file>.yaml > <file>.json',
    )
  }
  const where = sourcePath !== undefined ? ` at ${sourcePath}` : ''
  try {
    const parsed: unknown = JSON.parse(stripped)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('document must be an object')
    }
    if ('paths' in parsed && (typeof parsed.paths !== 'object' || parsed.paths === null || Array.isArray(parsed.paths))) {
      throw new Error('paths must be an object')
    }
    return parsed as OasDoc
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      `@databehave/openapi/openapi: failed to parse JSON OpenAPI document${where}: ${msg}`,
    )
  }
}
