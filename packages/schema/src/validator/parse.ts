/**
 * Validator — verify that a value conforms to a schema.
 *
 * `parse` throws ConformError. `safeParse` returns a discriminated result.
 *
 * Behavioral axes are enforced in addition to shape:
 *   - `domain` (`values` and `lookup`)
 *   - `invariants` (single-record) and `correlate` (multi-field, same axis)
 *   - `derived` (value must equal what `derivedFrom(...)` would compute)
 */

import type { GenContext, InvariantFn } from '../foundation/axes.js'
import { ConformError, type Issue } from '../foundation/errors.js'
import type { SchemaNode } from '../foundation/ir.js'
import type { Infer, Schema } from '../foundation/types.js'

export type SafeParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ConformError }

export const parse = <S extends Schema>(schema: S, value: unknown): Infer<S> => {
  const issues: Issue[] = []
  const out = check(schema._node, value, [], issues, undefined, undefined)
  if (issues.length > 0) throw new ConformError(issues)
  return out as Infer<S>
}

export const safeParse = <S extends Schema>(schema: S, value: unknown): SafeParseResult<Infer<S>> => {
  const issues: Issue[] = []
  const out = check(schema._node, value, [], issues, undefined, undefined)
  if (issues.length > 0) return { ok: false, error: new ConformError(issues) }
  return { ok: true, value: out as Infer<S> }
}

const EMPTY_PARENT: Readonly<Record<string, unknown>> = Object.freeze({})

const check = (
  node: SchemaNode,
  value: unknown,
  path: readonly (string | number)[],
  issues: Issue[],
  root: unknown,
  parent: Readonly<Record<string, unknown>> | undefined,
): unknown => {
  // modifier short-circuits
  const mods = node.mods
  if (value === undefined) {
    if (mods?.optional === true) return undefined
    if (mods?.hasDefault === true) return mods.defaultValue
    issues.push({ path, code: 'required', message: 'required', expected: describe(node) })
    return undefined
  }
  if (value === null) {
    if (mods?.nullable === true) return null
    if (node.kind === 'null') return null
    issues.push({ path, code: 'unexpected-null', message: 'unexpected null', expected: describe(node), received: null })
    return null
  }

  // Domain axis — applies before kind-specific checks.
  const domain = mods?.axes?.domain
  const parentCtx = parent ?? EMPTY_PARENT
  if (domain?.kind === 'values' && !domain.values.includes(value)) {
    issues.push({
      path,
      code: 'domain.not-in-values',
      message: `value not in domain [${domain.values.map((v) => JSON.stringify(v)).join(', ')}]`,
      received: value,
    })
  }
  if (domain?.kind === 'lookup') {
    const keyVal = parentCtx[domain.fromField]
    if (typeof keyVal === 'string') {
      const candidates = domain.map[keyVal]
      if (candidates !== undefined && !candidates.includes(value)) {
        issues.push({
          path,
          code: 'domain.lookup-mismatch',
          message: `value not in lookup domain for ${domain.fromField}=${JSON.stringify(keyVal)} [${candidates
            .map((v) => JSON.stringify(v))
            .join(', ')}]`,
          received: value,
        })
      }
    }
  }

  // Derived axis — the supplied value must equal what `derivedFrom` computes.
  // We compare deeply so structured derived values (objects/arrays) round-trip cleanly.
  if (mods?.axes?.derived !== undefined) {
    const ctx: GenContext = {
      root: root ?? value,
      parent: parentCtx,
      seed: `parse:${path.join('.')}`,
    }
    let expected: unknown
    try {
      expected = mods.axes.derived(ctx)
    } catch (err) {
      issues.push({
        path,
        code: 'derived.callback-threw',
        message: `derived callback threw: ${(err as Error).message}`,
        received: value,
      })
      return value
    }
    if (!deepEqual(expected, value)) {
      issues.push({
        path,
        code: 'derived.mismatch',
        message: 'derived value does not match computed value',
        expected: safeStringify(expected),
        received: value,
      })
    }
  }

  switch (node.kind) {
    case 'string': {
      if (typeof value !== 'string') {
        issues.push({ path, code: 'string.expected', message: 'expected string', expected: 'string', received: value })
        return value
      }
      if (node.min !== undefined && value.length < node.min) {
        issues.push({ path, code: 'string.too-short', message: `length < min ${node.min}`, received: value })
      }
      if (node.max !== undefined && value.length > node.max) {
        issues.push({ path, code: 'string.too-long', message: `length > max ${node.max}`, received: value })
      }
      if (node.pattern !== undefined && !new RegExp(node.pattern).test(value)) {
        issues.push({ path, code: 'string.pattern-mismatch', message: `does not match /${node.pattern}/`, received: value })
      }
      return value
    }
    case 'number': {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        issues.push({ path, code: 'number.expected', message: 'expected number', expected: 'number', received: value })
        return value
      }
      if (node.int && !Number.isInteger(value)) {
        issues.push({ path, code: 'number.not-integer', message: 'expected integer', received: value })
      }
      if (node.min !== undefined && value < node.min) {
        issues.push({ path, code: 'number.too-small', message: `< min ${node.min}`, received: value })
      }
      if (node.max !== undefined && value > node.max) {
        issues.push({ path, code: 'number.too-large', message: `> max ${node.max}`, received: value })
      }
      return value
    }
    case 'decimal': {
      if (typeof value !== 'string') {
        issues.push({ path, code: 'decimal.expected', message: 'expected decimal string', expected: 'string', received: value })
        return value
      }
      if (!/^-?\d+(\.\d+)?$/.test(value)) {
        issues.push({ path, code: 'decimal.not-numeric', message: 'not a numeric string', received: value })
      } else {
        const [, frac = ''] = value.split('.')
        if (frac.length > node.scale) {
          issues.push({
            path,
            code: 'decimal.scale-exceeded',
            message: `scale ${frac.length} exceeds declared scale ${node.scale}`,
            received: value,
          })
        }
      }
      return value
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        issues.push({ path, code: 'boolean.expected', message: 'expected boolean', expected: 'boolean', received: value })
      }
      return value
    }
    case 'null': {
      if (value !== null) {
        issues.push({ path, code: 'null.expected', message: 'expected null', expected: 'null', received: value })
      }
      return value
    }
    case 'literal': {
      if (value !== node.value) {
        issues.push({
          path,
          code: 'literal.not-equal',
          message: `expected literal ${JSON.stringify(node.value)}`,
          received: value,
        })
      }
      return value
    }
    case 'enum': {
      if (!(node.values as readonly unknown[]).includes(value)) {
        issues.push({
          path,
          code: 'enum.not-member',
          message: `not in enum [${node.values.join(', ')}]`,
          received: value,
        })
      }
      return value
    }
    case 'array': {
      if (!Array.isArray(value)) {
        issues.push({ path, code: 'array.expected', message: 'expected array', expected: 'array', received: value })
        return value
      }
      if (node.length !== undefined && value.length !== node.length) {
        issues.push({
          path,
          code: 'array.length-mismatch',
          message: `length ${value.length} ≠ required ${node.length}`,
          received: value,
        })
      }
      if (node.minLength !== undefined && value.length < node.minLength) {
        issues.push({ path, code: 'array.too-short', message: `length < minLength ${node.minLength}` })
      }
      if (node.maxLength !== undefined && value.length > node.maxLength) {
        issues.push({ path, code: 'array.too-long', message: `length > maxLength ${node.maxLength}` })
      }
      return value.map((item, i) => check(node.item, item, [...path, i], issues, root, parent))
    }
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) {
        issues.push({ path, code: 'object.expected', message: 'expected object', expected: 'object', received: value })
        return value
      }
      const out: Record<string, unknown> = {}
      const obj = value as Record<string, unknown>
      const nextRoot = root ?? out
      // Two-pass: non-derived first so derived can see them in `parent`.
      const keys = Object.keys(node.fields)
      const derivedKeys: string[] = []
      for (const key of keys) {
        const field = node.fields[key]!
        if (field.mods?.axes?.derived !== undefined) {
          derivedKeys.push(key)
          continue
        }
        const raw = obj[key]
        // Symmetric with generator (engine.ts: object loop omits optional
        // fields whose value is undefined). The generator's optional-skip
        // and default-application are mutually exclusive (skip wins), so
        // parse omits unconditionally when raw is undefined + optional.
        if (raw === undefined && field.mods?.optional === true) {
          continue
        }
        out[key] = check(field, raw, [...path, key], issues, nextRoot, out)
      }
      for (const key of derivedKeys) {
        const field = node.fields[key]!
        const raw = obj[key]
        if (raw === undefined && field.mods?.optional === true) {
          continue
        }
        out[key] = check(field, raw, [...path, key], issues, nextRoot, out)
      }
      // Enforce object-level invariants (single-record + correlate share this axis).
      const invariants = node.mods?.axes?.invariants
      if (invariants !== undefined && invariants.length > 0) {
        const ctx: GenContext = {
          root: root ?? out,
          parent: parent ?? EMPTY_PARENT,
          seed: `parse:${path.join('.')}`,
        }
        for (let i = 0; i < invariants.length; i += 1) {
          const inv = invariants[i] as InvariantFn
          let ok = false
          try {
            ok = inv(out, ctx)
          } catch (err) {
            issues.push({
              path,
              code: 'invariant.callback-threw',
              message: `invariant[${i}] threw: ${(err as Error).message}`,
              received: out,
            })
            continue
          }
          if (!ok) {
            issues.push({
              path,
              code: 'invariant.failed',
              message: `invariant[${i}] failed`,
              received: out,
            })
          }
        }
      }
      return out
    }
    case 'tuple': {
      if (!Array.isArray(value)) {
        issues.push({ path, code: 'tuple.expected-array', message: 'expected tuple (array)', received: value })
        return value
      }
      if (value.length !== node.items.length) {
        issues.push({
          path,
          code: 'tuple.length-mismatch',
          message: `tuple length ${value.length} ≠ ${node.items.length}`,
        })
      }
      return node.items.map((item, i) => check(item, value[i], [...path, i], issues, root, parent))
    }
    case 'union': {
      // Try each option; succeed on the first with zero issues. When every
      // option fails, surface the issues from the branch that came closest
      // (fewest issues) so debugging an unmatched union doesn't degrade
      // to a single opaque "matches none" message.
      let bestIssues: Issue[] | undefined
      let bestValue: unknown = value
      for (const opt of node.options) {
        const subIssues: Issue[] = []
        const v = check(opt, value, path, subIssues, root, parent)
        if (subIssues.length === 0) return v
        if (bestIssues === undefined || subIssues.length < bestIssues.length) {
          bestIssues = subIssues
          bestValue = v
        }
      }
      issues.push({
        path,
        code: 'union.no-match',
        message: `value matches none of the union options`,
        received: value,
      })
      if (bestIssues) {
        for (const sub of bestIssues) issues.push(sub)
      }
      return bestValue
    }
    case 'discriminated': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        issues.push({
          path,
          code: 'discriminated.expected-object',
          message: 'expected object (discriminated union)',
          expected: `object{${node.key}: ...}`,
          received: value,
        })
        return value
      }
      const tagVal = (value as Record<string, unknown>)[node.key]
      if (typeof tagVal !== 'string' && typeof tagVal !== 'number' && typeof tagVal !== 'boolean') {
        issues.push({
          path: [...path, node.key],
          code: 'discriminated.missing-tag',
          message: `missing discriminator "${node.key}"`,
          expected: Object.keys(node.branches).map((t) => JSON.stringify(t)).join(' | '),
          received: tagVal,
        })
        return value
      }
      const tag = String(tagVal)
      const branch = node.branches[tag]
      if (branch === undefined) {
        issues.push({
          path: [...path, node.key],
          code: 'discriminated.unknown-tag',
          message: `unknown discriminator value ${JSON.stringify(tagVal)}`,
          expected: Object.keys(node.branches).map((t) => JSON.stringify(t)).join(' | '),
          received: tagVal,
        })
        return value
      }
      return check(branch, value, path, issues, root, parent)
    }
  }

  // Single-value (non-object) invariants — run after kind-specific checks.
  // (Object-kind invariants are handled inside the object branch with the
  //  assembled `out` value, so this block is unreachable for objects.)
}

const describe = (node: SchemaNode): string => {
  switch (node.kind) {
    case 'literal':
      return `literal ${JSON.stringify(node.value)}`
    case 'enum':
      return `enum [${node.values.join(', ')}]`
    case 'array':
      return `array<${describe(node.item)}>`
    case 'object':
      return `object{${Object.keys(node.fields).join(', ')}}`
    case 'decimal':
      return `decimal(${node.precision}, ${node.scale})`
    case 'union':
      return `union(${node.options.map(describe).join(' | ')})`
    case 'discriminated':
      return `discriminated(${node.key}: ${Object.keys(node.branches).join(' | ')})`
    case 'tuple':
      return `tuple[${node.items.length}]`
    default:
      return node.kind
  }
}

const safeStringify = (v: unknown): string => {
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  if (Array.isArray(b)) return false
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao)
  const bk = Object.keys(bo)
  if (ak.length !== bk.length) return false
  for (const k of ak) if (!deepEqual(ao[k], bo[k])) return false
  return true
}
