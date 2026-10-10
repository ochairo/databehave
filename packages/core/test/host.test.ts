import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { capability, createHost } from '../src/index.js'
import type { IngressHandle, LifecycleContext, Plugin, SetupContext } from '../src/index.js'

function gate(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => { throw new Error('Uninitialized gate') }
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

const service = capability<{ value: number }>('test/service')
function provider(id = 'provider', value = 1): Plugin {
  return { id, apiVersion: 1, provides: [service], setup(ctx) { ctx.provide(service, { value }) } }
}

test('empty host shares start/close promises and is terminal', async () => {
  const host = createHost({ plugins: [] })
  assert.equal(host.state, 'ready')
  const start = host.start()
  assert.equal(start, host.start())
  await start
  assert.equal(host.state, 'running')
  const close = host.close()
  assert.equal(close, host.close())
  await close
  assert.equal(host.state, 'closed')
  assert.equal(host.start(), start)
  const unopened = createHost({ plugins: [] })
  await unopened.close()
  await assert.rejects(unopened.start(), /closed host/)
})

test('dependency order and phase barriers preserve original composition index', async () => {
  const events: string[] = []
  const make = (id: string, requiresService: boolean): Plugin => ({
    id, apiVersion: 1, requires: requiresService ? [service] : [],
    setup(ctx) {
      if (requiresService) assert.equal(ctx.use(service).value, 1)
      events.push(`setup:${id}:${ctx.order}`)
      ctx.onSeal(() => { events.push(`seal:${id}`) })
    },
    prepare(ctx) { events.push(`prepare:${id}:${ctx.order}`) },
    activate(ctx) { events.push(`activate:${id}:${ctx.order}`) },
    open(ctx) { events.push(`open:${id}:${ctx.order}`) },
  })
  const p = provider()
  const host = createHost({ plugins: [make('consumer', true), make('independent', false), {
    ...p,
    setup(ctx) { p.setup(ctx); events.push(`setup:provider:${ctx.order}`) },
    prepare(ctx) { events.push(`prepare:provider:${ctx.order}`) },
    activate(ctx) { events.push(`activate:provider:${ctx.order}`) },
    open(ctx) { events.push(`open:provider:${ctx.order}`) },
  }] })
  assert.deepEqual(events, ['setup:independent:1', 'setup:provider:2', 'setup:consumer:0',
    'seal:independent', 'seal:consumer'])
  await host.start()
  assert.deepEqual(events.slice(5), ['prepare:independent:1', 'prepare:provider:2', 'prepare:consumer:0',
    'activate:independent:1', 'activate:provider:2', 'activate:consumer:0',
    'open:independent:1', 'open:provider:2', 'open:consumer:0'])
  await host.close()
})

test('stable token identity, independent hosts and absent optional services', async () => {
  const first = createHost({ plugins: [provider('one', 1)] })
  const second = createHost({ plugins: [provider('two', 2)] })
  assert.equal(first.get(capability<{ value: number }>('test/service')).value, 1)
  assert.equal(second.get(service).value, 2)
  assert.throws(() => createHost({ plugins: [] }).get(service), /unavailable/)
  assert.throws(() => first.get(capability('test/service', 2)), /unavailable/)
  await Promise.all([first.start(), second.start()])
  await first.close()
  assert.equal(second.state, 'running')
  await second.close()
})

test('invalid graphs fail before any setup runs', () => {
  let setups = 0
  const observe: Plugin = { id: 'observe', apiVersion: 1, setup() { setups++ } }
  const consumer: Plugin = { id: 'consumer', apiVersion: 1, requires: [service], setup() {} }
  const other = capability('other')
  const invalid: readonly Plugin[][] = [
    [provider(), provider()],
    [provider('one'), provider('two')],
    [consumer],
    [{ ...consumer, requires: [capability('test/service', 2)] }, provider()],
    [{ ...consumer, provides: [other] }, { ...provider(), requires: [other] }],
    [{ ...provider(), requires: [service] }],
    [{ ...provider(), id: ' ' }],
    // @ts-expect-error Runtime JavaScript callers can supply an unsupported API version.
    [{ ...provider(), apiVersion: 2 }],
    [{ ...provider(), provides: [service, service] }],
    [{ ...provider(), provides: [{ name: 'invalid', version: 0 }] }],
  ]
  for (const plugins of invalid) assert.throws(() => createHost({ plugins: [observe, ...plugins] }))
  assert.equal(setups, 0)
  assert.throws(() => capability(''), /name/)
  assert.throws(() => capability('invalid', 1.5), /version/)
})

test('declared requirements/providers are enforced and all declared services must be supplied', () => {
  assert.throws(() => createHost({ plugins: [{ id: 'p', apiVersion: 1,
    setup(ctx) { ctx.provide(service, { value: 0 }) } }] }), /Undeclared provider/)
  assert.throws(() => createHost({ plugins: [provider(), { id: 'c', apiVersion: 1,
    setup(ctx) { ctx.use(service) } }] }), /Undeclared requirement/)
  assert.throws(() => createHost({ plugins: [{ ...provider(), setup() {} }] }), /not provided/)
  assert.throws(() => createHost({ plugins: [{ ...provider(), setup(ctx) {
    ctx.provide(service, { value: 1 }); ctx.provide(service, { value: 2 })
  } }] }), /already provided/)
})

test('registration closes after setup, seal callbacks run after contributions, async setup is rejected', async () => {
  const saved: SetupContext[] = []
  let contributions = 0
  createHost({ plugins: [{ id: 'one', apiVersion: 1, setup(ctx) {
    saved.push(ctx)
    ctx.onSeal(() => { assert.equal(contributions, 1) })
  } }, { id: 'two', apiVersion: 1, setup() { contributions++ } }] })
  const ctx = saved[0]
  assert.ok(ctx)
  assert.throws(() => ctx.onSeal(() => {}), /sealed/)
  assert.throws(() => ctx.provide(service, { value: 3 }), /sealed/)
  assert.throws(() => ctx.use(service), /sealed/)
  assert.throws(() => createHost({ plugins: [{ id: 'async', apiVersion: 1,
    async setup() { throw new Error('Rejected async setup') } }] }), /must be synchronous/)
  assert.throws(() => createHost({ plugins: [{ id: 'async-seal', apiVersion: 1,
    setup(c) { c.onSeal(async () => { throw new Error('Rejected seal') }) } }] }), /must be synchronous/)
  await Promise.resolve()
})

test('ingress stops before abort, drains before reverse resource cleanup, and cleanup continues on errors', async () => {
  const events: string[] = []
  const stopError = new Error('stop')
  const drainError = new Error('drain')
  const disposeError = new Error('dispose')
  const host = createHost({ plugins: [{ id: 'resource', apiVersion: 1, setup() {},
    prepare(ctx) {
      ctx.signal.addEventListener('abort', () => { events.push('abort') })
      ctx.defer(() => { events.push('first') })
      ctx.defer(() => { events.push('second'); throw disposeError })
    },
    open(ctx) {
      ctx.ownIngress({ stopAccepting() { events.push('stop'); throw stopError },
        async drainAndClose() { events.push('drain'); throw drainError } })
    },
  }] })
  await host.start()
  const close = host.close()
  assert.deepEqual(events, ['stop', 'abort'])
  await assert.rejects(close, (error: unknown) => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors, [stopError, drainError, disposeError])
    return true
  })
  assert.deepEqual(events, ['stop', 'abort', 'drain', 'second', 'first'])
  assert.equal(host.state, 'failed')
  assert.equal(host.close(), close)
})

for (const phase of ['prepare', 'activate', 'open'] as const) {
  test(`startup failure in ${phase} cleans acquired resources and retains original failure`, async () => {
    const startupError = new Error('startup')
    const disposeError = new Error('dispose')
    const events: string[] = []
    const host = createHost({ plugins: [{ id: 'fails', apiVersion: 1, setup() {},
      [phase](ctx: LifecycleContext) {
        ctx.defer(() => { events.push('disposed'); throw disposeError })
        throw startupError
      },
    }, { id: 'later', apiVersion: 1, setup() {}, [phase]() { events.push('later') } }] })
    const start = host.start()
    await assert.rejects(start, (error: unknown) => {
      assert.ok(error instanceof AggregateError)
      assert.equal(error.cause, startupError)
      assert.deepEqual(error.errors, [startupError, disposeError])
      return true
    })
    assert.equal(host.state, 'failed')
    assert.equal(host.start(), start)
    assert.deepEqual(events, ['disposed'])
    await assert.rejects(host.close(), AggregateError)
  })
}

test('startup failure without cleanup errors preserves the thrown value', async () => {
  const failure = new Error('exact failure')
  const host = createHost({ plugins: [{ id: 'fails', apiVersion: 1, setup() {}, prepare() { throw failure } }] })
  await assert.rejects(host.start(), error => error === failure)
  await host.close()
  assert.equal(host.state, 'failed')
})

for (const phase of ['prepare', 'activate', 'open'] as const) {
  test(`close during ${phase} cancels, waits for late acquisition, and prevents later hooks`, async () => {
    const entered = gate()
    const finish = gate()
    const events: string[] = []
    const host = createHost({ plugins: [{ id: 'pending', apiVersion: 1, setup() {},
      async [phase](ctx: LifecycleContext) {
        entered.resolve()
        await finish.promise
        assert.equal(ctx.signal.aborted, true)
        ctx.defer(() => { events.push('late cleanup') })
        if (phase === 'open') ctx.ownIngress({
          stopAccepting() { events.push('late stop') },
          async drainAndClose() { events.push('late drain') },
        })
      },
    }, { id: 'later', apiVersion: 1, setup() {},
      [phase]() { events.push('later hook') },
    }] })
    const start = host.start()
    const rejection = assert.rejects(start, /closed during startup/)
    await entered.promise
    const close = host.close()
    assert.equal(close, host.close())
    assert.equal(start, host.start())
    assert.equal(host.state, 'closing')
    finish.resolve()
    await Promise.all([close, rejection])
    assert.deepEqual(events, phase === 'open' ? ['late stop', 'late drain', 'late cleanup'] : ['late cleanup'])
    assert.equal(host.state, 'closed')
  })
}

test('close immediately after start prevents all hooks', async () => {
  const host = createHost({ plugins: [{ id: 'never', apiVersion: 1, setup() {},
    prepare() { assert.fail('closed host must not prepare') } }] })
  const start = host.start()
  const rejected = assert.rejects(start, /closed during startup/)
  await host.close()
  await rejected
})

test('lifecycle contexts expire, enforce requirements and restrict ingress to open', async () => {
  const saved: LifecycleContext[] = []
  const handle: IngressHandle = { stopAccepting() {}, async drainAndClose() {} }
  const host = createHost({ plugins: [{ id: 'p', apiVersion: 1, setup() {}, prepare(ctx) {
    saved.push(ctx)
    assert.throws(() => ctx.use(service), /Undeclared requirement/)
    assert.throws(() => ctx.ownIngress(handle), /only.*open/)
  } }] })
  await host.start()
  const ctx = saved[0]
  assert.ok(ctx)
  assert.throws(() => ctx.defer(() => {}), /expired/)
  assert.throws(() => ctx.ownIngress(handle), /expired/)
  await host.close()
})

test('shutdown retains failure from a pending hook and still cleans its late resource', async () => {
  const entered = gate()
  const finish = gate()
  const failure = new Error('pending failure')
  const cleanupFailure = new Error('late cleanup failure')
  const host = createHost({ plugins: [{ id: 'pending', apiVersion: 1, setup() {}, async prepare(ctx) {
    entered.resolve()
    await finish.promise
    ctx.defer(() => { throw cleanupFailure })
    throw failure
  } }] })
  const start = host.start()
  const startRejected = assert.rejects(start, (error: unknown) => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors, [failure, cleanupFailure])
    return true
  })
  await entered.promise
  const closeRejected = assert.rejects(host.close(), AggregateError)
  finish.resolve()
  await Promise.all([startRejected, closeRejected])
  assert.equal(host.state, 'failed')
})

test('versioned services can coexist and a provided undefined value remains present', async () => {
  const first = capability<undefined>('versioned', 1)
  const second = capability<string>('versioned', 2)
  const host = createHost({ plugins: [{ id: 'versions', apiVersion: 1, provides: [first, second], setup(ctx) {
    ctx.provide(first, undefined)
    ctx.provide(second, 'v2')
  } }] })
  assert.equal(host.get(first), undefined)
  assert.equal(host.get(second), 'v2')
  await host.close()
})

test('prototype methods retain private receivers and captured lifecycle handlers', async () => {
  const calls: string[] = []
  class ClassPlugin implements Plugin {
    readonly id = 'class-provider'
    readonly apiVersion = 1
    readonly provides = [service]
    #value = 7
    setup(ctx: SetupContext): void { ctx.provide(service, { value: this.#value }) }
    prepare(): void { calls.push(`prepare:${this.#value}`) }
    activate(ctx: LifecycleContext): void {
      calls.push(`activate:${this.#value}`)
      ctx.defer(() => { calls.push(`dispose:${this.#value}`) })
    }
    open(): void { calls.push(`open:${this.#value}`) }
  }
  const plugin = new ClassPlugin()
  const host = createHost({ plugins: [plugin] })
  plugin.prepare = () => { throw new Error('mutated handler must not replace the snapshot') }
  plugin.activate = () => { throw new Error('mutated handler must not replace the snapshot') }
  plugin.open = () => { throw new Error('mutated handler must not replace the snapshot') }
  await host.start()
  assert.equal(host.get(service).value, 7)
  await host.close()
  assert.deepEqual(calls, ['prepare:7', 'activate:7', 'open:7', 'dispose:7'])
})
