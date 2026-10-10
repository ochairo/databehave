/** Stable identity shared by separately installed copies of a capability contract. */
export interface CapabilityKey {
  readonly name: string
  readonly version: number
}

/** Typed capability identity. The optional phantom member carries no runtime state. */
export interface Capability<T> extends CapabilityKey {
  readonly __valueType?: (value: T) => T
}

/** Synchronous, effect-free registration, available only during the plugin's setup. */
export interface SetupContext {
  /** Original configuration index, independent of dependency ordering. */
  readonly order: number
  use<T>(token: Capability<T>): T
  provide<T>(token: Capability<T>, value: T): void
  onSeal(fn: () => void): void
}

/** External ingress stops synchronously before lifetime cancellation and draining. */
export interface IngressHandle {
  stopAccepting(): void
  drainAndClose(): Promise<void>
}

/** Resource ownership for one running hook; register cleanup immediately on acquisition. */
export interface LifecycleContext {
  /** Original configuration index, independent of dependency ordering. */
  readonly order: number
  use<T>(token: Capability<T>): T
  readonly signal: AbortSignal
  defer(dispose: () => void | Promise<void>): void
  ownIngress(handle: IngressHandle): void
}

/** An explicit capability provider/consumer using host contract version 1. */
export interface Plugin {
  readonly id: string
  readonly apiVersion: 1
  readonly provides?: readonly CapabilityKey[]
  readonly requires?: readonly CapabilityKey[]
  setup(ctx: SetupContext): void
  prepare?(ctx: LifecycleContext): void | Promise<void>
  activate?(ctx: LifecycleContext): void | Promise<void>
  open?(ctx: LifecycleContext): void | Promise<void>
}

/** A host is terminal after close or failure; create another host to restart. */
export type HostState = 'ready' | 'starting' | 'running' | 'closing' | 'closed' | 'failed'

/** Independently owned application lifetime and its sealed capabilities. */
export interface Host {
  readonly state: HostState
  start(): Promise<void>
  close(): Promise<void>
  get<T>(token: Capability<T>): T
}
