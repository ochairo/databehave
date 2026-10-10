import { strict as assert } from 'node:assert'
import { it } from 'node:test'
import { createHost } from '@databehave/core'
import { schemaCapability, schemaPlugin } from '../../src/plugin.js'
import { int, standardKinds, standardBehaviors } from '../../src/index.js'

it('the optional host adapter creates independent schema runtimes from one plugin definition', async () => {
  const plugin = schemaPlugin({ kinds: standardKinds, behaviors: standardBehaviors })
  const first = createHost({ plugins: [plugin] })
  const second = createHost({ plugins: [plugin] })
  await Promise.all([first.start(), second.start()])
  try {
    assert.notEqual(first.get(schemaCapability), second.get(schemaCapability))
    assert.equal(
      first.get(schemaCapability).mock(int(), { seed: 'host' }),
      second.get(schemaCapability).mock(int(), { seed: 'host' }),
    )
  } finally {
    await Promise.all([first.close(), second.close()])
  }
})
