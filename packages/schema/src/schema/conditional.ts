/**
 * Discriminated union.
 *
 * `discriminated(key, map)` builds a schema whose branches are selected by
 * the value of the named discriminator field, both during generation and
 * during validation.
 *
 * Each entry in `map` must be an object-kind schema whose `key` field is a
 * `literal(...)` matching the map key. This is enforced at build time so
 * the discriminator is genuinely useful: generation picks one branch and
 * sets the key; validation reads the key and dispatches to the matching
 * branch (O(1), with errors keyed on the discriminator).
 *
 * ```ts
 * const Variant = discriminated('kind', {
 *   alpha: obj({ kind: literal('alpha'), score:  decimal(10, 4) }),
 *   beta:  obj({ kind: literal('beta'),  weight: decimal(10, 4) }),
 * })
 * ```
 */

import type { DiscriminatedKind, ObjectKind, SchemaNode } from '../foundation/ir.js'
import { Schema, type Infer } from '../foundation/types.js'

const isObjectNode = (n: SchemaNode): n is SchemaNode & ObjectKind =>
  n.kind === 'object'

/**
 * Build a discriminated union keyed on `key`. Each value in `map` must be a
 * schema (typically `obj({...})`) whose `key` field is a `literal(...)`
 * matching the map key.
 */
export const discriminated = <
  K extends string,
  // Use Schema<any> to keep map values bivariant — strict ObjectSchema<...>
  // would break variance once `weighted()` etc. are involved.
  M extends Readonly<Record<string, Schema<unknown>>>,
>(
  key: K,
  map: M,
): Schema<{ [P in keyof M]: Infer<M[P]> }[keyof M]> => {
  const tags = Object.keys(map)
  if (tags.length === 0) {
    throw new RangeError(`discriminated("${key}"): map must contain at least one branch`)
  }

  const branches: Record<string, SchemaNode> = {}
  for (const tag of tags) {
    const branch = (map[tag] as Schema)._node
    if (!isObjectNode(branch)) {
      throw new RangeError(
        `discriminated("${key}"): branch ${JSON.stringify(tag)} must be an obj({...}) schema`,
      )
    }
    const keyField = branch.fields[key]
    if (keyField === undefined) {
      throw new RangeError(
        `discriminated("${key}"): branch ${JSON.stringify(tag)} is missing the discriminator field "${key}"`,
      )
    }
    if (keyField.kind !== 'literal' || keyField.value !== tag) {
      throw new RangeError(
        `discriminated("${key}"): branch ${JSON.stringify(tag)} must declare ` +
          `${key}: literal(${JSON.stringify(tag)})`,
      )
    }
    branches[tag] = branch
  }

  const node: DiscriminatedKind = { kind: 'discriminated', key, branches }
  return new Schema(node) as unknown as Schema<{ [P in keyof M]: Infer<M[P]> }[keyof M]>
}
