import './dbh-operation-row'
import './dbh-operation-card'
import type { OpenApiDoc, Operation, StickyOverride } from '../types'
import { esc } from '../html'
import type { DbhOperationRow } from './dbh-operation-row'
import type { DbhOperationCard } from './dbh-operation-card'

/**
 * Collapsible group of operations sharing an OpenAPI tag. Headline
 * shows op count and active-override count. Expanding a row reveals
 * the per-op `<dbh-operation-card>` inline.
 */
export class DbhTagGroup extends HTMLElement {
  private _label = ''
  private _ops: Operation[] = []
  private _doc: OpenApiDoc | null = null
  private _overrides: StickyOverride[] = []
  private _expandedKey: string | null = null
  private _focusedKey: string | null = null
  private _open = true
  setData(input: {
    label: string
    ops: Operation[]
    doc: OpenApiDoc | null
    overrides: StickyOverride[]
    expandedKey: string | null
    focusedKey: string | null
  }): void {
    this._label = input.label
    this._ops = input.ops
    this._doc = input.doc
    this._overrides = input.overrides
    this._expandedKey = input.expandedKey
    this._focusedKey = input.focusedKey
    this._render()
  }
  private _render(): void {
    const activeCount = this._ops.reduce((acc, op) =>
      acc + (this._overrides.some((o) => o.matcher.kind === 'exact' && o.matcher.method === op.method && o.matcher.path === op.path) ? 1 : 0), 0)
    this.innerHTML = `
      <div class="group${this._open ? ' open' : ''}">
        <div class="group-header" data-header>
          <h3>${esc(this._label)}</h3>
          <span class="count">${this._ops.length} ops${activeCount ? ` · ${activeCount} active` : ''}</span>
          <span>${this._open ? '−' : '+'}</span>
        </div>
        <div class="group-body" data-body></div>
      </div>`
    this.querySelector('[data-header]')?.addEventListener('click', () => { this._open = !this._open; this._render() })
    const body = this.querySelector('[data-body]')
    if (!body) return
    for (const op of this._ops) {
      const key = `${op.method} ${op.path}`
      const existing = this._overrides.find((o) => o.matcher.kind === 'exact' && o.matcher.method === op.method && o.matcher.path === op.path)
      const row = document.createElement('dbh-operation-row') as DbhOperationRow
      row.setRow({ op, override: existing, expanded: this._expandedKey === key, focused: this._focusedKey === key })
      body.appendChild(row)
      if (this._expandedKey === key) {
        const card = document.createElement('dbh-operation-card') as DbhOperationCard
        body.appendChild(card)
        card.setData({ op, doc: this._doc, overrides: this._overrides })
      }
    }
  }
}
customElements.define('dbh-tag-group', DbhTagGroup)
