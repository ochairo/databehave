import { capabilityId } from './capability.js'
import type { Capability, CapabilityKey, Plugin } from './contracts.js'

/** Validated snapshot of one plugin and its declared capability identities. */
export interface RegisteredPlugin {
  readonly order: number
  readonly plugin: Plugin
  readonly provides: ReadonlySet<string>
  readonly requires: ReadonlySet<string>
}

/** The sealed, instance-local service registry and deterministic dependency order. */
export interface Registration {
  readonly ordered: readonly RegisteredPlugin[]
  get<T>(token: Capability<T>): T
  use<T>(owner: RegisteredPlugin, token: Capability<T>): T
}

function keys(tokens: readonly CapabilityKey[] | undefined, owner: string): Set<string> {
  if (tokens !== undefined && !Array.isArray(tokens)) throw new Error(`Invalid capabilities in ${owner}`)
  const result = new Set<string>()
  for (const token of tokens ?? []) {
    const key = capabilityId(token)
    if (result.has(key)) throw new Error(`Duplicate capability declaration ${key} in ${owner}`)
    result.add(key)
  }
  return result
}

export function assertSynchronous(result: unknown, label: string): void {
  if (result !== null && (typeof result === 'object' || typeof result === 'function') &&
      'then' in result && typeof result.then === 'function') {
    // A rejected async hook must not become an unhandled rejection after construction fails.
    void Promise.resolve(result).catch(() => {})
    throw new Error(`${label} must be synchronous`)
  }
}

export function register(plugins: readonly Plugin[]): Registration {
  if (!Array.isArray(plugins)) throw new Error('plugins must be an array')
  const ids = new Set<string>()
  const providers = new Map<string, RegisteredPlugin>()
  const entries = plugins.map((input, order): RegisteredPlugin => {
    if (!input || typeof input.id !== 'string' || !input.id || input.id.trim() !== input.id) {
      throw new Error('Plugin id must be a nonempty trimmed string')
    }
    if (ids.has(input.id)) throw new Error(`Duplicate plugin id ${input.id}`)
    ids.add(input.id)
    if (input.apiVersion !== 1) throw new Error(`Unsupported host API version in ${input.id}`)
    if (typeof input.setup !== 'function') throw new Error(`Missing setup in ${input.id}`)
    for (const phase of ['prepare', 'activate', 'open'] as const) {
      if (input[phase] !== undefined && typeof input[phase] !== 'function') {
        throw new Error(`Invalid ${phase} hook in ${input.id}`)
      }
    }
    const entry = {
      order,
      // Capture public callbacks while retaining the extension's receiver (including private fields).
      plugin: {
        id: input.id,
        apiVersion: input.apiVersion,
        setup: input.setup.bind(input),
        ...(input.prepare === undefined ? {} : { prepare: input.prepare.bind(input) }),
        ...(input.activate === undefined ? {} : { activate: input.activate.bind(input) }),
        ...(input.open === undefined ? {} : { open: input.open.bind(input) }),
      },
      provides: keys(input.provides, input.id),
      requires: keys(input.requires, input.id),
    }
    for (const key of entry.provides) {
      const previous = providers.get(key)
      if (previous) throw new Error(`Duplicate provider for ${key}: ${previous.plugin.id}, ${input.id}`)
      providers.set(key, entry)
    }
    return entry
  })
  for (const entry of entries) {
    for (const key of entry.requires) {
      if (!providers.has(key)) throw new Error(`Missing capability ${key} required by ${entry.plugin.id}`)
    }
  }
  const ordered: RegisteredPlugin[] = []
  const remaining = new Set(entries)
  const resolved = new Set<string>()
  while (remaining.size) {
    const next = entries.find(entry => remaining.has(entry) && [...entry.requires].every(key => resolved.has(key)))
    if (!next) throw new Error(`Capability dependency cycle: ${[...remaining].map(e => e.plugin.id).join(', ')}`)
    remaining.delete(next)
    ordered.push(next)
    for (const key of next.provides) resolved.add(key)
  }

  const services = new Map<string, unknown>()
  const seals: (() => void)[] = []
  function get<T>(token: Capability<T>): T {
    const key = capabilityId(token)
    if (!services.has(key)) throw new Error(`Capability unavailable: ${key}`)
    // provide() pairs each typed token with its value; name/version is the public identity boundary.
    return services.get(key) as T
  }
  function use<T>(owner: RegisteredPlugin, token: Capability<T>): T {
    const key = capabilityId(token)
    if (!owner.requires.has(key)) throw new Error(`Undeclared requirement ${key} in ${owner.plugin.id}`)
    return get(token)
  }
  for (const owner of ordered) {
    let registering = true
    function assertRegistering(): void {
      if (!registering) throw new Error(`Registration sealed for ${owner.plugin.id}`)
    }
    try {
      const result: unknown = owner.plugin.setup({
        order: owner.order,
        use<T>(token: Capability<T>): T {
          assertRegistering()
          return use(owner, token)
        },
        provide<T>(token: Capability<T>, value: T): void {
          assertRegistering()
          const key = capabilityId(token)
          if (!owner.provides.has(key)) throw new Error(`Undeclared provider ${key} in ${owner.plugin.id}`)
          if (services.has(key)) throw new Error(`Capability already provided: ${key}`)
          services.set(key, value)
        },
        onSeal(fn): void {
          assertRegistering()
          if (typeof fn !== 'function') throw new Error('Seal callback must be a function')
          seals.push(fn)
        },
      })
      assertSynchronous(result, `Setup for ${owner.plugin.id}`)
      for (const key of owner.provides) {
        if (!services.has(key)) throw new Error(`Declared capability ${key} not provided by ${owner.plugin.id}`)
      }
    } finally {
      registering = false
    }
  }
  for (const seal of seals) assertSynchronous(seal(), 'Seal callback')
  return { ordered, get, use }
}
