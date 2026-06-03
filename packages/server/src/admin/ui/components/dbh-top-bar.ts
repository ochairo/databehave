import { appStore, clearOverrides, openGlobalOverride } from '../app-store'
import './dbh-scenarios-menu'

/** Sticky page header: title, URL, action buttons. No language toggle. */
export class DbhTopBar extends HTMLElement {
  private _unsub?: () => void
  connectedCallback(): void {
    this._render()
    this._unsub = appStore.subscribe(() => this._render())
  }
  disconnectedCallback(): void { this._unsub?.() }
  private _render(): void {
    const s = appStore.get()
    const count = s.overrides.length
    const globalCount = s.overrides.filter((o) => o.matcher.kind === 'global').length
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    this.innerHTML = `
      <div class="top-bar">
        <h1>Mock Injection</h1>
        <span class="url">${origin}</span>
        <span class="badge">${count}</span>
        <button class="ghost" type="button" data-clear>Clear all</button>
        <button class="ghost global-override-btn" type="button" data-global title="Global override">
          Global override${globalCount > 0 ? `<span class="badge global-badge">${globalCount}</span>` : ''}
        </button>
        <dbh-scenarios-menu></dbh-scenarios-menu>
        <button class="ghost" type="button" data-help title="?">?</button>
        <button class="ghost" type="button" data-panel>Active overrides</button>
      </div>`
    this.querySelector('[data-clear]')?.addEventListener('click', () => { void clearOverrides() })
    this.querySelector('[data-global]')?.addEventListener('click', () => openGlobalOverride())
    this.querySelector('[data-help]')?.addEventListener('click', () => appStore.set({ helpOpen: true }))
    this.querySelector('[data-panel]')?.addEventListener('click', () => appStore.set({ rightPanelOpen: !appStore.get().rightPanelOpen }))
  }
}
customElements.define('dbh-top-bar', DbhTopBar)
