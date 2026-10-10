import type { SchemaNode, StandardSchemaNode } from '../foundation/ir.js'
import type { KindDescriptor, SchemaChild } from '../runtime/contracts.js'
import { kindGenerators } from './generation.js'
import { kindValidators, validateRequiredValue } from './validation.js'

/** Require a plain metadata record without invoking inherited properties. */
export const record = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('expected metadata object')
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError('expected plain metadata object')
  return value as Record<string, unknown>
}
const number = (value: unknown): void => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('expected finite number')
}
const text = (value: unknown): void => {
  if (typeof value !== 'string') throw new TypeError('expected string')
}
const flag = (value: unknown): void => {
  if (typeof value !== 'boolean') throw new TypeError('expected boolean')
}
const count = (value: unknown): void => {
  number(value)
  if (!Number.isInteger(value) || Number(value) < 0) throw new TypeError('expected nonnegative integer')
}
const optional = (
  node: Record<string, unknown>,
  keys: readonly string[],
  check: (value: unknown) => void,
): void => {
  for (const key of keys) if (node[key] !== undefined) check(node[key])
}
const nodeList = (value: unknown): void => {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('expected nonempty schema list')
  value.forEach(record)
}
const fields = (value: unknown): void => {
  const map = record(value)
  for (const [key, child] of Object.entries(map)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new TypeError(`unsafe field ${key}`)
    record(child)
  }
}
/** Metadata parsers belong to their standard kind, independently of runtime dispatch. */
const metadata = {
  string: (n: Record<string, unknown>): void => {
    if (
      !['plain', 'uuid', 'email', 'url', 'ipv4', 'ipv6', 'date', 'datetime', 'time'].includes(
        String(n.format),
      )
    )
      throw new TypeError('unknown string format')
    optional(n, ['min', 'max'], count)
    optional(n, ['pattern'], text)
    if (typeof n.pattern === 'string') new RegExp(n.pattern)
  },
  number: (n: Record<string, unknown>): void => {
    flag(n.int)
    optional(n, ['min', 'max'], number)
    optional(n, ['unsigned'], flag)
    if (n.bits !== undefined && ![8, 16, 32, 64].includes(Number(n.bits)))
      throw new TypeError('invalid number bits')
  },
  decimal: (n: Record<string, unknown>): void => {
    count(n.precision)
    count(n.scale)
    if (Number(n.precision) < 1 || Number(n.precision) > 38 || Number(n.scale) > Number(n.precision))
      throw new TypeError('invalid decimal precision/scale')
    optional(n, ['min', 'max'], text)
  },
  boolean: (_n: Record<string, unknown>): void => {},
  null: (_n: Record<string, unknown>): void => {},
  literal: (n: Record<string, unknown>): void => {
    if (n.value !== null && !['string', 'number', 'boolean'].includes(typeof n.value))
      throw new TypeError('invalid literal')
    if (typeof n.value === 'number') number(n.value)
  },
  enum: (n: Record<string, unknown>): void => {
    if (!Array.isArray(n.values) || n.values.length === 0) throw new TypeError('expected nonempty enum')
    for (const value of n.values) {
      if (typeof value !== 'string') number(value)
    }
  },
  object: (n: Record<string, unknown>): void => {
    fields(n.fields)
  },
  array: (n: Record<string, unknown>): void => {
    record(n.item)
    optional(n, ['length', 'minLength', 'maxLength'], count)
  },
  tuple: (n: Record<string, unknown>): void => {
    if (!Array.isArray(n.items)) throw new TypeError('expected tuple items')
    n.items.forEach(record)
  },
  union: (n: Record<string, unknown>): void => {
    nodeList(n.options)
  },
  discriminated: (n: Record<string, unknown>): void => {
    const key = n.key
    if (typeof key !== 'string') throw new TypeError('expected discriminator key string')
    fields(n.branches)
    const branches = record(n.branches)
    if (Object.keys(branches).length === 0) throw new TypeError('discriminated: empty branches map')
    for (const [tag, value] of Object.entries(branches)) {
      const branch = record(value)
      if (branch.kind !== 'object')
        throw new TypeError(`discriminated: branch ${JSON.stringify(tag)} must be an object schema`)
      const branchFields = record(branch.fields)
      if (!Object.hasOwn(branchFields, key))
        throw new TypeError(
          `discriminated: branch ${JSON.stringify(tag)} is missing discriminator ${JSON.stringify(key)}`,
        )
      const discriminator = record(branchFields[key])
      if (discriminator.kind !== 'literal' || discriminator.value !== tag)
        throw new TypeError(
          `discriminated: branch ${JSON.stringify(tag)} must declare ${key}: literal(${JSON.stringify(tag)})`,
        )
    }
  },
}
/** Narrowed standard kind after its owning parser succeeds. */
type Node<K extends StandardSchemaNode['kind']> = Extract<StandardSchemaNode, { kind: K }>
/** A kind owns its diagnostic description as well as generation and validation. */
const descriptions: {
  readonly [K in StandardSchemaNode['kind']]?: (node: Node<K>, child: (node: SchemaNode) => string) => string
} = {
  literal: (node) => `literal ${JSON.stringify(node.value)}`,
  enum: (node) => `enum [${node.values.join(', ')}]`,
  array: (node, child) => `array<${child(node.item)}>`,
  object: (node) => `object{${Object.keys(node.fields).join(', ')}}`,
  decimal: (node) => `decimal(${node.precision}, ${node.scale})`,
  union: (node, child) => `union(${node.options.map(child).join(' | ')})`,
  discriminated: (node) => `discriminated(${node.key}: ${Object.keys(node.branches).join(' | ')})`,
  tuple: (node) => `tuple[${node.items.length}]`,
}
const kind = <K extends StandardSchemaNode['kind']>(
  id: K,
  generate: (node: Node<K>, context: import('../runtime/contracts.js').GenerationContext) => unknown,
  validate: (
    node: Node<K>,
    value: unknown,
    context: import('../runtime/contracts.js').ValidationContext,
  ) => unknown,
  children: (node: Node<K>) => readonly SchemaChild[] = () => [],
  rebuild: (node: Node<K>, children: readonly SchemaChild[]) => SchemaNode = (node) => ({ ...node }),
): KindDescriptor => {
  const read = (value: unknown): Node<K> => {
    const node = record(value)
    if (node.kind !== id) throw new TypeError(`expected kind ${id}`)
    metadata[id](node)
    // The parser above checks the metadata owned by K; the runtime checks modifiers and recursive children.
    return node as Node<K>
  }
  return Object.freeze({
    id,
    version: 1,
    checkMetadata: read,
    describe: (node, child) => descriptions[id]?.(read(node), child) ?? id,
    generate: (node, context) => generate(read(node), context),
    validate: (node, value, context) => {
      const parsed = read(node)
      return validateRequiredValue(parsed, value, context, () => validate(parsed, value, context))
    },
    children: (node) => children(read(node)),
    rebuild: (node, entries) => rebuild(read(node), entries),
  } satisfies KindDescriptor)
}
/** Grouped official kinds. Omit or replace any descriptor when composing a runtime. */
export const standardKinds: readonly KindDescriptor[] = Object.freeze([
  kind('string', kindGenerators.string, kindValidators.string),
  kind('number', kindGenerators.number, kindValidators.number),
  kind('decimal', kindGenerators.decimal, kindValidators.decimal),
  kind('boolean', kindGenerators.boolean, kindValidators.boolean),
  kind('null', kindGenerators.null, kindValidators.null),
  kind('literal', kindGenerators.literal, kindValidators.literal),
  kind('enum', kindGenerators.enum, kindValidators.enum),
  kind(
    'object',
    kindGenerators.object,
    kindValidators.object,
    (n) => Object.entries(n.fields).map(([key, node]) => ({ key, node })),
    (n, entries) => ({
      ...n,
      fields: Object.fromEntries(entries.map(({ key, node }) => [key, node])),
    }),
  ),
  kind(
    'array',
    kindGenerators.array,
    kindValidators.array,
    (n) => [{ key: '[]', node: n.item }],
    (n, entries) => ({ ...n, item: entries[0]?.node ?? n.item }),
  ),
  kind(
    'tuple',
    kindGenerators.tuple,
    kindValidators.tuple,
    (n) => n.items.map((node, key) => ({ key, node })),
    (n, entries) => ({ ...n, items: entries.map((e) => e.node) }),
  ),
  kind(
    'union',
    kindGenerators.union,
    kindValidators.union,
    (n) => n.options.map((node, i) => ({ key: `|${i}`, node })),
    (n, entries) => ({ ...n, options: entries.map((e) => e.node) }),
  ),
  kind(
    'discriminated',
    kindGenerators.discriminated,
    kindValidators.discriminated,
    (n) => Object.values(n.branches).map((node, i) => ({ key: `|${i}`, node })),
    (n, entries) => ({
      ...n,
      branches: Object.fromEntries(
        Object.keys(n.branches).map((tag, i) => [tag, entries[i]?.node ?? n.branches[tag]]),
      ),
    }),
  ),
])
