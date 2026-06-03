import './dbh-top-bar'
import './dbh-filter-bar'
import './dbh-tag-group'
import './dbh-active-overrides-panel'
import './dbh-floating-pill'
import './dbh-toasts'
import './dbh-help-modal'
import './dbh-global-override-panel'

import { appStore, refreshOverrides, refreshScenarios } from '../app-store'
import { api } from '../api'
import type { OpenApiDoc, Operation, RouteSummary } from '../types'
import { globalAppliesTo } from '../types'
import { buildOperations, groupOperations, opKey, overrideCountsByOp, type OperationGroup } from '../store'
import type { DbhFilterBar } from './dbh-filter-bar'
import type { DbhTagGroup } from './dbh-tag-group'

const METHODS_DEFAULT = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']

/**
 * App shell: wires the persistent layout once, then re-renders only
 * the operation list (and toggles slide-in panels' classes) on store
 * change. Also owns initial data load, keyboard shortcuts, and the
 * debounced search.
 */
export class DbhApp extends HTMLElement {
  private _filter!: DbhFilterBar
  private _main!: HTMLElement
  private _unsub?: () => void
  private _debounce?: ReturnType<typeof setTimeout>
  private _debouncedSearch = ''
  private _onKeyDown = (e: KeyboardEvent) => this._handleKey(e)

  connectedCallback(): void {
    this.innerHTML = `
      <div class="app">
        <dbh-top-bar></dbh-top-bar>
        <dbh-filter-bar></dbh-filter-bar>
        <main class="main" data-main></main>
        <dbh-active-overrides-panel></dbh-active-overrides-panel>
        <dbh-floating-pill></dbh-floating-pill>
        <dbh-toasts></dbh-toasts>
        <dbh-help-modal></dbh-help-modal>
        <dbh-global-override-panel></dbh-global-override-panel>
      </div>`
    this._filter = this.querySelector('dbh-filter-bar') as DbhFilterBar
    this._main = this.querySelector('[data-main]') as HTMLElement

    this._unsub = appStore.subscribe(() => this._onStateChange())
    window.addEventListener('keydown', this._onKeyDown)

    void (async () => {
      const [r, d] = await Promise.all([api.listRoutes(), api.fetchOpenApi()])
      appStore.set({
        routes: r as RouteSummary[],
        doc: (d as OpenApiDoc) ?? null,
        loading: false,
      })
      await refreshOverrides()
      await refreshScenarios()
      this._renderList()
    })()
  }
  disconnectedCallback(): void {
    this._unsub?.()
    window.removeEventListener('keydown', this._onKeyDown)
    if (this._debounce) clearTimeout(this._debounce)
  }
  private _onStateChange(): void {
    const s = appStore.get()
    if (s.search !== this._debouncedSearch) {
      if (this._debounce) clearTimeout(this._debounce)
      this._debounce = setTimeout(() => {
        this._debouncedSearch = appStore.get().search
        this._renderList()
      }, 150)
    } else {
      this._renderList()
    }
  }
  private _filtered(): Operation[] {
    const s = appStore.get()
    const operations = buildOperations(s.routes, s.doc)
    const q = this._debouncedSearch.trim().toLowerCase()
    const methods = s.methods.size > 0 ? s.methods : new Set(METHODS_DEFAULT)
    return operations.filter((op) => {
      if (!methods.has(op.method)) return false
      if (q && !op.path.toLowerCase().includes(q) && !(op.op.summary?.toLowerCase().includes(q))) return false
      if (s.activeOnly) {
        const has = s.overrides.some((o) =>
          (o.matcher.kind === 'exact' && o.matcher.method === op.method && o.matcher.path === op.path)
          || (o.matcher.kind === 'path' && o.matcher.path === op.path)
          || (o.matcher.kind === 'global' && globalAppliesTo(o.matcher, op.method)))
        if (!has) return false
      }
      return true
    })
  }
  private _renderList(): void {
    const s = appStore.get()
    const filtered = this._filtered()
    const groups: OperationGroup[] = groupOperations(filtered, overrideCountsByOp(s.overrides))
    this._main.innerHTML = ''
    if (groups.length === 0) {
      const p = document.createElement('p')
      p.style.color = '#57606a'
      p.textContent = 'No operations match these filters.'
      this._main.appendChild(p)
      return
    }
    for (const g of groups) {
      const node = document.createElement('dbh-tag-group') as DbhTagGroup
      this._main.appendChild(node)
      node.setData({
        label: g.label, ops: g.ops, doc: s.doc, overrides: s.overrides,
        expandedKey: s.expandedKey, focusedKey: s.focusedKey,
      })
    }
  }
  private _handleKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null
    const inField = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
    const searchInput = this._filter?.searchInput
    const s = appStore.get()
    if (e.key === '/' && !inField) { e.preventDefault(); searchInput?.focus() }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchInput?.focus() }
    else if (e.key === '?' && !inField) { e.preventDefault(); appStore.set({ helpOpen: true }) }
    else if (e.key === 'Escape') {
      if (s.helpOpen) appStore.set({ helpOpen: false })
      else if (s.globalOpen) appStore.set({ globalOpen: false })
      else if (s.rightPanelOpen) appStore.set({ rightPanelOpen: false })
      else if (s.expandedKey) appStore.set({ expandedKey: null })
      else searchInput?.blur()
    }
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && document.activeElement === searchInput) {
      e.preventDefault()
      const list = this._filtered().map((op) => opKey(op.method, op.path))
      if (list.length === 0) return
      const idx = s.focusedKey ? list.indexOf(s.focusedKey) : -1
      const next = e.key === 'ArrowDown' ? Math.min(list.length - 1, idx + 1) : Math.max(0, idx - 1)
      appStore.set({ focusedKey: list[next] ?? null })
    }
    else if (e.key === 'Enter' && document.activeElement === searchInput && s.focusedKey) {
      e.preventDefault()
      appStore.set({ expandedKey: s.expandedKey === s.focusedKey ? null : s.focusedKey })
    }
  }
}
customElements.define('dbh-app', DbhApp)
