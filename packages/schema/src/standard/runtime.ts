import { createSchemaRuntime } from '../runtime/runtime.js'
import { standardKinds } from './kinds.js'
import { standardBehaviors } from './behaviors.js'
/** Immutable standard composition used by the convenience functions. */
export const standardRuntime = createSchemaRuntime({
  kinds: standardKinds,
  behaviors: standardBehaviors,
})
