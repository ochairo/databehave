import { capability } from '../src/index.js'
import type { Capability, SetupContext } from '../src/index.js'

const numberToken = capability<number>('number')
const stringToken = capability<string>('string')

/** Compile-time regression checks; never invoked at runtime. */
export function checkTypes(ctx: SetupContext): void {
  const value: number = ctx.use(numberToken)
  ctx.provide(numberToken, value)
  // @ts-expect-error Capability value must match its token.
  ctx.provide(numberToken, 'wrong')
  // @ts-expect-error Distinct value types cannot be substituted.
  const invalid: Capability<number> = stringToken
  void invalid
}
