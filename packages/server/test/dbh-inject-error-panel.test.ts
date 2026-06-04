import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Operation, StickyOverride } from '../src/admin/ui/types.js'

const here = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(here, '../src/admin/ui/components/dbh-inject-error-panel.ts')
const distPath = resolve(here, '../dist/admin/ui.js')

const applyOverrideMock = vi.fn(async () => ({ id: 'new', matcher: { kind: 'exact', method: 'GET', path: '/x' }, mode: { kind: 'http-status', status: 500 }, createdAt: 'now' }))
const removeOverrideMock = vi.fn(async () => {})

vi.mock('../src/admin/ui/app-store.ts', () => ({
  appStore: {},
  applyOverride: applyOverrideMock,
  removeOverride: removeOverrideMock,
  openGlobalOverride: vi.fn(),
  toast: vi.fn(),
}))

beforeAll(() => {
  const g = globalThis as Record<string, unknown>
  if (!g.HTMLElement) {
    class FakeHTMLElement extends EventTarget {
      innerHTML = ''
      querySelector<T extends Element>(): T | null { return null }
      querySelectorAll<T extends Element>(): NodeListOf<T> {
        return [] as unknown as NodeListOf<T>
      }
    }
    g.HTMLElement = FakeHTMLElement
  }
  if (!g.customElements) {
    g.customElements = { define: () => undefined }
  }
})

describe('admin inject panel copy and scope contract', () => {
  it('uses generic response wording and removes scope controls in source', () => {
    const source = readFileSync(sourcePath, 'utf8')

    expect(source).toContain('<h4>Inject response</h4>')
    expect(source).not.toContain('<h4>Inject error</h4>')
    expect(source).not.toContain('data-scope=')
    expect(source).not.toContain('name="scope"')
  })

  it('keeps deterministic exact scope default for submitted matcher in source', () => {
    const source = readFileSync(sourcePath, 'utf8')

    expect(source).toContain("private _scope: Exclude<ScopeKind, 'global'> = 'exact'")
    expect(source).toContain("this._scope === 'exact'")
    expect(source).toContain("? { kind: 'exact', method: op.method, path: op.path }")
  })

  it('keeps dist admin bundle aligned with source copy and removed scope controls', () => {
    const dist = readFileSync(distPath, 'utf8')

    expect(dist).toContain('<h4>Inject response</h4>')
    expect(dist).not.toContain('<h4>Inject error</h4>')
    expect(dist).not.toContain('data-scope=')
    expect(dist).not.toContain('name="scope"')
  })
})

describe('admin inject panel submit payload behavior', () => {
  const op: Operation = {
    method: 'POST',
    path: '/api/v1/widgets',
    op: {},
    groupKey: 'widgets',
    groupLabel: 'widgets',
  }

  it('submits deterministic exact matcher for new override by default', async () => {
    const { DbhInjectErrorPanel } = await import('../src/admin/ui/components/dbh-inject-error-panel.ts')
    const panel = new DbhInjectErrorPanel() as unknown as {
      _op: Operation
      _submit: () => void
    }

    applyOverrideMock.mockClear()
    removeOverrideMock.mockClear()

    panel._op = op
    panel._submit()

    await vi.waitFor(() => expect(applyOverrideMock).toHaveBeenCalledTimes(1))
    expect(removeOverrideMock).not.toHaveBeenCalled()
    expect(applyOverrideMock).toHaveBeenCalledWith(
      { kind: 'exact', method: 'POST', path: '/api/v1/widgets' },
      { kind: 'http-status', status: 500 },
      undefined,
    )
  })

  it('preserves existing path-scoped edit submission and replaces prior path override', async () => {
    const { DbhInjectErrorPanel } = await import('../src/admin/ui/components/dbh-inject-error-panel.ts')
    const panel = new DbhInjectErrorPanel() as unknown as {
      _op: Operation
      _existing?: StickyOverride
      _syncFromExisting: () => void
      _submit: () => void
    }
    const existing: StickyOverride = {
      id: 'ovr-1',
      matcher: { kind: 'path', path: '/api/v1/widgets' },
      mode: { kind: 'business-failure', message: 'existing' },
      createdAt: '2026-06-04T00:00:00.000Z',
      description: 'old',
    }

    applyOverrideMock.mockClear()
    removeOverrideMock.mockClear()

    panel._op = op
    panel._existing = existing
    panel._syncFromExisting()
    panel._submit()

    await vi.waitFor(() => expect(applyOverrideMock).toHaveBeenCalledTimes(1))
    expect(removeOverrideMock).toHaveBeenCalledWith('ovr-1')
    expect(applyOverrideMock).toHaveBeenCalledWith(
      { kind: 'path', path: '/api/v1/widgets' },
      { kind: 'business-failure', message: 'existing' },
      'old',
    )
  })
})
