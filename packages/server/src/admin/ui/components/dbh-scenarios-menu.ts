import { appStore } from '../app-store'
import { saveScenario, loadScenario, deleteScenario } from '../app-store'
import { esc } from '../html'

/** Top-bar pop-over for scenario save/load/delete. */
export class DbhScenariosMenu extends HTMLElement {
  private _unsub?: () => void
  private _open = false
  connectedCallback(): void {
    this._render()
    this._unsub = appStore.subscribe(() => this._render())
  }
  disconnectedCallback(): void { this._unsub?.() }
  private _render(): void {
    const scenarios = appStore.get().scenarios
    this.innerHTML = `
      <div style="position:relative">
        <button class="ghost" type="button" data-toggle>Scenarios (${scenarios.length})</button>
        ${this._open ? `
          <div style="position:absolute;top:110%;right:0;background:#fff;color:#1f2328;border:1px solid #d0d7de;border-radius:6px;padding:8px;min-width:240px;z-index:50;box-shadow:0 2px 8px rgba(0,0,0,0.1)">
            <button class="btn" style="width:100%;margin-bottom:8px" type="button" data-save>Save current as…</button>
            ${scenarios.map((s) => `
              <div style="display:flex;gap:4px;align-items:center;padding:4px 0;border-top:1px solid #eaeef2">
                <span style="flex:1;font-size:12px">${esc(s.name)} <small>(${s.count})</small></span>
                <button class="btn" type="button" data-load="${esc(s.name)}">Load</button>
                <button class="btn danger" type="button" data-delete="${esc(s.name)}">Delete</button>
              </div>`).join('')}
          </div>` : ''}
      </div>`
    this.querySelector('[data-toggle]')?.addEventListener('click', () => { this._open = !this._open; this._render() })
    this.querySelector('[data-save]')?.addEventListener('click', () => {
      const name = window.prompt('Scenario name (a-z, 0-9, _ -):')
      if (name) void saveScenario(name)
      this._open = false; this._render()
    })
    for (const el of this.querySelectorAll<HTMLElement>('[data-load]')) {
      el.addEventListener('click', () => { void loadScenario(el.dataset.load ?? ''); this._open = false; this._render() })
    }
    for (const el of this.querySelectorAll<HTMLElement>('[data-delete]')) {
      el.addEventListener('click', () => { void deleteScenario(el.dataset.delete ?? '') })
    }
  }
}
customElements.define('dbh-scenarios-menu', DbhScenariosMenu)
