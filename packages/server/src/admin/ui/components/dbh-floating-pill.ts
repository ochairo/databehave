import { appStore } from '../app-store'

/** Fixed bottom-right "N active overrides" pill. Hidden when count is 0. */
export class DbhFloatingPill extends HTMLElement {
  private _unsub?: () => void
  connectedCallback(): void {
    this._render()
    this._unsub = appStore.subscribe(() => this._render())
  }
  disconnectedCallback(): void { this._unsub?.() }
  private _render(): void {
    const s = appStore.get()
    const count = s.overrides.length
    if (count === 0) { this.innerHTML = ''; return }
    this.innerHTML = `<button class="pill-float" type="button">${count} Active overrides</button>`
    const btn = this.querySelector('button')
    btn?.addEventListener('click', () => appStore.set({ rightPanelOpen: true }))
  }
}
customElements.define('dbh-floating-pill', DbhFloatingPill)
