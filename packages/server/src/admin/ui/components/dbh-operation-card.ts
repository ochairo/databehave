import './dbh-spec-zone'
import './dbh-inject-error-panel'
import './dbh-try-it-out'
import type { OpenApiDoc, Operation, StickyOverride } from '../types'
import { globalAppliesTo } from '../types'
import type { DbhSpecZone } from './dbh-spec-zone'
import type { DbhInjectErrorPanel } from './dbh-inject-error-panel'
import type { DbhTryItOut } from './dbh-try-it-out'

/**
 * Expanded body shown beneath an `<dbh-operation-row>` — spec +
 * inject-error form + try-it-out, in that order. Connected children
 * are reused across re-renders so form state survives partial updates.
 */
export class DbhOperationCard extends HTMLElement {
  private _spec!: DbhSpecZone
  private _inject!: DbhInjectErrorPanel
  private _try!: DbhTryItOut
  connectedCallback(): void {
    if (this.childElementCount === 0) {
      this.innerHTML = `
        <div class="op-card">
          <dbh-spec-zone></dbh-spec-zone>
          <dbh-inject-error-panel></dbh-inject-error-panel>
          <dbh-try-it-out></dbh-try-it-out>
        </div>`
      this._spec = this.querySelector('dbh-spec-zone') as DbhSpecZone
      this._inject = this.querySelector('dbh-inject-error-panel') as DbhInjectErrorPanel
      this._try = this.querySelector('dbh-try-it-out') as DbhTryItOut
      this._inject.addEventListener('dbh-header-override', (e) => {
        this._try.extraHeader = (e as CustomEvent).detail as { name: string; value: string } | null
      })
    }
  }
  setData(input: { op: Operation; doc: OpenApiDoc | null; overrides: StickyOverride[] }): void {
    if (!this._spec) this.connectedCallback()
    const { op, doc, overrides } = input
    const existing = overrides.find((o) => o.matcher.kind === 'exact' && o.matcher.method === op.method && o.matcher.path === op.path)
    const globalActive = overrides.some((o) => o.matcher.kind === 'global' && globalAppliesTo(o.matcher, op.method))
    this._spec.setOp(op, doc)
    this._inject.setOp({ op, existing, globalActive })
    this._try.setOp(op, doc)
  }
}
customElements.define('dbh-operation-card', DbhOperationCard)
