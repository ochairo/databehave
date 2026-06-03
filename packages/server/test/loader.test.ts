/**
 * Unit tests for {@link parseOpenApi}.
 *
 * The integration tests feed already-valid JSON; this file pins the
 * input-validation branches (JSON vs garbage) directly.
 */
import { describe, expect, it } from 'vitest'

import { parseOpenApi } from '../src/openapi/loader.js'

describe('parseOpenApi', () => {
  it('parses a well-formed JSON document', () => {
    const doc = parseOpenApi(
      JSON.stringify({ openapi: '3.0.0', info: { title: 't', version: '0' }, paths: {} }),
    )
    expect(doc).toEqual({
      openapi: '3.0.0',
      info: { title: 't', version: '0' },
      paths: {},
    })
  })

  it('parses a JSON document with leading whitespace', () => {
    const doc = parseOpenApi('\n   \t{"openapi":"3.0.0","paths":{}}')
    expect((doc as { openapi: string }).openapi).toBe('3.0.0')
  })

  it('accepts a JSON document whose root is an array without throwing', () => {
    // `JSON.parse` is permissive; the walker (not the loader) is
    // responsible for shape validation. We only pin that the loader
    // does *not* misclassify a top-level array as garbage.
    expect(() => parseOpenApi('[1,2,3]')).not.toThrow()
  })

  it('throws a friendly error when sourcePath ends in .yaml', () => {
    expect(() =>
      parseOpenApi('openapi: "3.0.0"\npaths: {}\n', '/tmp/spec.yaml'),
    ).toThrow(/JSON-only spec loader\. Convert YAML first: yq -o=json/)
  })

  it('throws a friendly error when sourcePath ends in .yml', () => {
    expect(() =>
      parseOpenApi('openapi: "3.0.0"\npaths: {}\n', '/tmp/spec.yml'),
    ).toThrow(/JSON-only spec loader\. Convert YAML first: yq -o=json/)
  })

  it('throws a clear error on JSON parse failure with the source path', () => {
    expect(() => parseOpenApi('{ "openapi": ', '/tmp/openapi.json')).toThrow(
      /failed to parse JSON OpenAPI document at \/tmp\/openapi\.json/,
    )
  })

  it.todo('accepts non-JSON OpenAPI text directly when a zero-dep strategy is adopted')
})
