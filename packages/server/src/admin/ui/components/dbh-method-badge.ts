import { METHOD_COLORS } from '../utils/colors'

/**
 * Inline method label. Renders the markup the existing
 * `.method-badge` CSS targets. Method is read from the `method`
 * attribute on render.
 */
export class DbhMethodBadge extends HTMLElement {
  static get observedAttributes(): string[] { return ['method'] }
  connectedCallback(): void { this._render() }
  attributeChangedCallback(): void { if (this.isConnected) this._render() }
  private _render(): void {
    const m = (this.getAttribute('method') ?? '').toUpperCase()
    const bg = METHOD_COLORS[m] ?? '#57606a'
    this.innerHTML = `<span class="method-badge" style="background:${bg}">${m}</span>`
  }
}
customElements.define('dbh-method-badge', DbhMethodBadge)
