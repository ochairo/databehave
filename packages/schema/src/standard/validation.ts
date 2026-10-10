import type { Issue } from '../foundation/errors.js'
import type { StandardSchemaNode } from '../foundation/ir.js'
import type { ValidationContext } from '../runtime/contracts.js'

/** Standard kinds retain their required-value diagnostics without constraining external kinds. */
export const validateRequiredValue = (
  node: StandardSchemaNode,
  value: unknown,
  context: ValidationContext,
  next: () => unknown,
): unknown => {
  if (node.kind === 'union') return next()
  if (value === undefined) {
    context.issues.push({
      path: context.path,
      code: 'required',
      message: 'required',
      expected: context.describe(node),
    })
    return undefined
  }
  if (value === null && node.kind !== 'null' && !(node.kind === 'literal' && node.value === null)) {
    context.issues.push({
      path: context.path,
      code: 'unexpected-null',
      message: 'unexpected null',
      expected: context.describe(node),
      received: null,
    })
    return null
  }
  return next()
}

/** Standard validators; composites always recurse through the active runtime. */
export const kindValidators = {
  string: (
    node: Extract<StandardSchemaNode, { kind: 'string' }>,
    value: unknown,
    context: ValidationContext,
  ): unknown => {
    const { path, issues } = context
    if (typeof value !== 'string') {
      issues.push({
        path,
        code: 'string.expected',
        message: 'expected string',
        expected: 'string',
        received: value,
      })
      return value
    }
    if (node.min !== undefined && value.length < node.min) {
      issues.push({
        path,
        code: 'string.too-short',
        message: `length < min ${node.min}`,
        received: value,
      })
    }
    if (node.max !== undefined && value.length > node.max) {
      issues.push({
        path,
        code: 'string.too-long',
        message: `length > max ${node.max}`,
        received: value,
      })
    }
    if (node.pattern !== undefined && !new RegExp(node.pattern).test(value)) {
      issues.push({
        path,
        code: 'string.pattern-mismatch',
        message: `does not match /${node.pattern}/`,
        received: value,
      })
    }
    return value
  },
  number: (
    node: Extract<StandardSchemaNode, { kind: 'number' }>,
    value: unknown,
    context: ValidationContext,
  ): unknown => {
    const { path, issues } = context
    if (typeof value !== 'number' || Number.isNaN(value)) {
      issues.push({
        path,
        code: 'number.expected',
        message: 'expected number',
        expected: 'number',
        received: value,
      })
      return value
    }
    if (node.int && !Number.isInteger(value)) {
      issues.push({
        path,
        code: 'number.not-integer',
        message: 'expected integer',
        received: value,
      })
    }
    if (node.min !== undefined && value < node.min) {
      issues.push({
        path,
        code: 'number.too-small',
        message: `< min ${node.min}`,
        received: value,
      })
    }
    if (node.max !== undefined && value > node.max) {
      issues.push({
        path,
        code: 'number.too-large',
        message: `> max ${node.max}`,
        received: value,
      })
    }
    return value
  },
  decimal: (
    node: Extract<StandardSchemaNode, { kind: 'decimal' }>,
    value: unknown,
    context: ValidationContext,
  ): unknown => {
    const { path, issues } = context
    if (typeof value !== 'string') {
      issues.push({
        path,
        code: 'decimal.expected',
        message: 'expected decimal string',
        expected: 'string',
        received: value,
      })
      return value
    }
    if (!/^-?\d+(\.\d+)?$/.test(value)) {
      issues.push({
        path,
        code: 'decimal.not-numeric',
        message: 'not a numeric string',
        received: value,
      })
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
  },
  boolean: (
    _node: Extract<StandardSchemaNode, { kind: 'boolean' }>,
    value: unknown,
    context: ValidationContext,
  ): unknown => {
    const { path, issues } = context
    if (typeof value !== 'boolean') {
      issues.push({
        path,
        code: 'boolean.expected',
        message: 'expected boolean',
        expected: 'boolean',
        received: value,
      })
    }
    return value
  },
  null: (
    _node: Extract<StandardSchemaNode, { kind: 'null' }>,
    value: unknown,
    context: ValidationContext,
  ): unknown => {
    const { path, issues } = context
    if (value !== null) {
      issues.push({
        path,
        code: 'null.expected',
        message: 'expected null',
        expected: 'null',
        received: value,
      })
    }
    return value
  },
  literal: (
    node: Extract<StandardSchemaNode, { kind: 'literal' }>,
    value: unknown,
    context: ValidationContext,
  ): unknown => {
    const { path, issues } = context
    if (value !== node.value) {
      issues.push({
        path,
        code: 'literal.not-equal',
        message: `expected literal ${JSON.stringify(node.value)}`,
        received: value,
      })
    }
    return value
  },
  enum: (
    node: Extract<StandardSchemaNode, { kind: 'enum' }>,
    value: unknown,
    context: ValidationContext,
  ): unknown => {
    const { path, issues } = context
    if (!(node.values as readonly unknown[]).includes(value)) {
      issues.push({
        path,
        code: 'enum.not-member',
        message: `not in enum [${node.values.join(', ')}]`,
        received: value,
      })
    }
    return value
  },
  array: (
    node: Extract<StandardSchemaNode, { kind: 'array' }>,
    value: unknown,
    context: ValidationContext,
  ): unknown => {
    const { path, issues, root, parent, check } = context
    if (!Array.isArray(value)) {
      issues.push({
        path,
        code: 'array.expected',
        message: 'expected array',
        expected: 'array',
        received: value,
      })
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
      issues.push({
        path,
        code: 'array.too-short',
        message: `length < minLength ${node.minLength}`,
      })
    }
    if (node.maxLength !== undefined && value.length > node.maxLength) {
      issues.push({
        path,
        code: 'array.too-long',
        message: `length > maxLength ${node.maxLength}`,
      })
    }
    return value.map((item, i) => check(node.item, item, [...path, i], issues, root, parent))
  },
  object: (
    node: Extract<StandardSchemaNode, { kind: 'object' }>,
    value: unknown,
    context: ValidationContext,
  ): unknown => {
    const { path, issues, root, check } = context
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      issues.push({
        path,
        code: 'object.expected',
        message: 'expected object',
        expected: 'object',
        received: value,
      })
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
      if (context.isDeferred(field)) {
        derivedKeys.push(key)
        continue
      }
      const raw = obj[key]
      const checked = check(field, raw, [...path, key], issues, nextRoot, out)
      if (checked !== undefined || field.mods?.optional !== true) out[key] = checked
    }
    for (const key of derivedKeys) {
      const field = node.fields[key]!
      const raw = obj[key]
      const checked = check(field, raw, [...path, key], issues, nextRoot, out)
      if (checked !== undefined || field.mods?.optional !== true) out[key] = checked
    }
    return out
  },
  tuple: (
    node: Extract<StandardSchemaNode, { kind: 'tuple' }>,
    value: unknown,
    context: ValidationContext,
  ): unknown => {
    const { path, issues, root, parent, check } = context
    if (!Array.isArray(value)) {
      issues.push({
        path,
        code: 'tuple.expected-array',
        message: 'expected tuple (array)',
        received: value,
      })
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
  },
  union: (
    node: Extract<StandardSchemaNode, { kind: 'union' }>,
    value: unknown,
    context: ValidationContext,
  ): unknown => {
    const { path, issues, root, parent, check } = context
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
  },
  discriminated: (
    node: Extract<StandardSchemaNode, { kind: 'discriminated' }>,
    value: unknown,
    context: ValidationContext,
  ): unknown => {
    const { path, issues, root, parent, check } = context
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
        expected: Object.keys(node.branches)
          .map((t) => JSON.stringify(t))
          .join(' | '),
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
        expected: Object.keys(node.branches)
          .map((t) => JSON.stringify(t))
          .join(' | '),
        received: tagVal,
      })
      return value
    }
    return check(branch, value, path, issues, root, parent)
  },
}
