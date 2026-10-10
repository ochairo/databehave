import type { Capability, CapabilityKey } from './contracts.js'

/** Create a token; matching depends on name/version, never object or symbol identity. */
export function capability<T>(name: string, version = 1): Capability<T> {
  const token = { name, version }
  capabilityId(token)
  return Object.freeze(token)
}

export function capabilityId(token: CapabilityKey): string {
  if (!token || typeof token.name !== 'string' || token.name.trim() !== token.name || !token.name) {
    throw new Error('Capability name must be a nonempty trimmed string')
  }
  if (!Number.isSafeInteger(token.version) || token.version < 1) {
    throw new Error(`Invalid capability version for ${token.name}`)
  }
  return JSON.stringify([token.name, token.version])
}
