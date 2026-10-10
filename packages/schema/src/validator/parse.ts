import type { ConformError } from '../foundation/errors.js'
import type { Infer, Schema } from '../foundation/types.js'
import { standardRuntime } from '../standard/runtime.js'
/** Result of validating through the selected runtime. */
export type SafeParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ConformError }
export const parse = <S extends Schema>(schema: S, value: unknown): Infer<S> => standardRuntime.parse(schema, value)
export const safeParse = <S extends Schema>(schema: S, value: unknown): SafeParseResult<Infer<S>> => standardRuntime.safeParse(schema, value)
