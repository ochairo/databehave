import type { ErrorMode, OverrideMatcher, StickyOverride, Scenario } from './admin-types.js'

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

export const validateMode = (raw: unknown): [ErrorMode | null, string | null] => {
  if (!isPlainObject(raw) || typeof raw.kind !== 'string') {
    return [null, 'mode.kind must be a string']
  }
  switch (raw.kind) {
    case 'http-status':
      if (typeof raw.status !== 'number' || !Number.isInteger(raw.status) || raw.status < 200 || raw.status > 599)
        return [null, 'http-status.status must be number']
      return [{ kind: 'http-status', status: raw.status }, null]
    case 'business-failure': {
      if (typeof raw.message !== 'string')
        return [null, 'business-failure.message must be string']
      const mode: ErrorMode = { kind: 'business-failure', message: raw.message }
      if (raw.extra !== undefined) {
        if (!isPlainObject(raw.extra))
          return [null, 'business-failure.extra must be a plain object']
        ;(mode as { extra?: Record<string, unknown> }).extra = raw.extra
      }
      return [mode, null]
    }
    case 'custom-body': {
      if (!('body' in raw)) return [null, 'custom-body.body is required']
      const mode: ErrorMode = { kind: 'custom-body', body: raw.body }
      if (raw.status !== undefined) {
        if (typeof raw.status !== 'number' || !Number.isInteger(raw.status) || raw.status < 200 || raw.status > 599)
          return [null, 'custom-body.status must be number']
        ;(mode as { status?: number }).status = raw.status
      }
      if (raw.contentType !== undefined) {
        if (typeof raw.contentType !== 'string')
          return [null, 'custom-body.contentType must be string']
        ;(mode as { contentType?: string }).contentType = raw.contentType
      }
      return [mode, null]
    }
    case 'empty-body': {
      const mode: ErrorMode = { kind: 'empty-body' }
      if (raw.status !== undefined) {
        if (typeof raw.status !== 'number' || !Number.isInteger(raw.status) || raw.status < 200 || raw.status > 599)
          return [null, 'empty-body.status must be number']
        ;(mode as { status?: number }).status = raw.status
      }
      return [mode, null]
    }
    case 'malformed-json': {
      const mode: ErrorMode = { kind: 'malformed-json' }
      if (raw.status !== undefined) {
        if (typeof raw.status !== 'number' || !Number.isInteger(raw.status) || raw.status < 200 || raw.status > 599)
          return [null, 'malformed-json.status must be number']
        ;(mode as { status?: number }).status = raw.status
      }
      return [mode, null]
    }
    case 'delay': {
      if (typeof raw.ms !== 'number' || !Number.isFinite(raw.ms) || raw.ms < 0 || raw.ms > 2_147_483_647)
        return [null, 'delay.ms must be a non-negative number']
      if (raw.then === undefined) return [{ kind: 'delay', ms: raw.ms }, null]
      const [inner, err] = validateMode(raw.then)
      if (!inner) return [null, `delay.then: ${err}`]
      if (
        inner.kind === 'delay' ||
        inner.kind === 'hang' ||
        inner.kind === 'destroy'
      ) {
        return [null, `delay.then cannot be ${inner.kind}`]
      }
      return [
        {
          kind: 'delay',
          ms: raw.ms,
          then: inner as Exclude<
            ErrorMode,
            { kind: 'delay' } | { kind: 'hang' } | { kind: 'destroy' }
          >,
        },
        null,
      ]
    }
    case 'hang':
      return [{ kind: 'hang' }, null]
    case 'destroy':
      return [{ kind: 'destroy' }, null]
    default:
      return [null, `unknown mode.kind: ${String(raw.kind)}`]
  }
}

export const validateMatcher = (
  raw: unknown,
): [OverrideMatcher | null, string | null] => {
  if (!isPlainObject(raw) || typeof raw.kind !== 'string') {
    return [null, 'matcher.kind must be a string']
  }
  switch (raw.kind) {
    case 'exact':
      if (typeof raw.method !== 'string' || !/^[A-Za-z]+$/.test(raw.method))
        return [null, 'matcher.method must be string']
      if (typeof raw.path !== 'string' || !raw.path.startsWith('/'))
        return [null, 'matcher.path must start with "/"']
      return [{ kind: 'exact', method: raw.method, path: raw.path }, null]
    case 'path':
      if (typeof raw.path !== 'string' || !raw.path.startsWith('/'))
        return [null, 'matcher.path must start with "/"']
      return [{ kind: 'path', path: raw.path }, null]
    case 'global': {
      if (raw.methods === undefined) return [{ kind: 'global' }, null]
      if (!Array.isArray(raw.methods))
        return [null, 'matcher.methods must be an array of strings']
      const methods: string[] = []
      for (const m of raw.methods) {
        if (typeof m !== 'string')
          return [null, 'matcher.methods must be an array of strings']
        const trimmed = m.trim()
        if (trimmed.length === 0)
          return [null, 'matcher.methods entries must be non-empty']
        methods.push(trimmed.toUpperCase())
      }
      if (methods.length === 0) return [{ kind: 'global' }, null]
      return [{ kind: 'global', methods }, null]
    }
    default:
      return [null, `unknown matcher.kind: ${String(raw.kind)}`]
  }
}

/** Invalid external scenario or override data. No state or file has changed. */
export class ScenarioValidationError extends Error {
  override readonly name = 'ScenarioValidationError'
}

/** Complete validation shared by HTTP requests, disk reads and atomic replacement. */
export const validateOverrides = (raw: unknown): readonly StickyOverride[] => {
  if (!Array.isArray(raw)) throw new ScenarioValidationError('overrides must be an array')
  return raw.map((entry: unknown, index) => {
    if (!isPlainObject(entry)) throw new ScenarioValidationError(`overrides[${index}] must be an object`)
    const [matcher, matcherError] = validateMatcher(entry.matcher)
    const [mode, modeError] = validateMode(entry.mode)
    if (!matcher || !mode) throw new ScenarioValidationError(`overrides[${index}]: ${matcherError ?? modeError}`)
    if (typeof entry.id !== 'string' || typeof entry.createdAt !== 'string') {
      throw new ScenarioValidationError(`overrides[${index}] requires id and createdAt strings`)
    }
    if (entry.description !== undefined && typeof entry.description !== 'string') {
      throw new ScenarioValidationError(`overrides[${index}].description must be a string`)
    }
    return { id: entry.id, createdAt: entry.createdAt, matcher, mode,
      ...(entry.description !== undefined ? { description: entry.description } : {}) }
  })
}

/** Versionless legacy scenarios and version 1 share the validated override format. */
export const validateScenarioVersion = (version: unknown): void => {
  if (version !== undefined && version !== 1) {
    throw new ScenarioValidationError(`Unsupported scenario version: ${String(version)}`)
  }
}

/** Names accepted by all scenario endpoints and the file adapter. */
export const isValidScenarioName = (name: string): boolean => /^[A-Za-z0-9_-]{1,64}$/.test(name)

/** Validate a complete provider or legacy disk result before it can become live state. */
export const validateScenario = (raw: unknown, name: string): Scenario => {
  if (!isPlainObject(raw)) throw new ScenarioValidationError('Scenario must be an object')
  validateScenarioVersion(raw.version)
  if (raw.name !== undefined && typeof raw.name !== 'string') throw new ScenarioValidationError('Scenario name must be a string')
  if (raw.created !== undefined && typeof raw.created !== 'string') throw new ScenarioValidationError('Scenario created must be a string')
  return { name, overrides: validateOverrides(raw.overrides),
    ...(raw.created !== undefined ? { created: raw.created } : {}),
    ...(raw.version === 1 ? { version: 1 } : {}) }
}
