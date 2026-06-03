import { appStore } from '../app-store'

/** Keyboard-shortcuts cheat sheet modal. Visible while `helpOpen` is true. */
export class DbhHelpModal extends HTMLElement {
  private _unsub?: () => void
  connectedCallback(): void {
    this._render()
    this._unsub = appStore.subscribe(() => this._render())
  }
  disconnectedCallback(): void { this._unsub?.() }
  private _render(): void {
    const open = appStore.get().helpOpen
    if (!open) { this.innerHTML = ''; return }
    this.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal">
          <h2>Keyboard shortcuts</h2>
          <table>
            <tbody>
              <tr><td><kbd>/</kbd> or <kbd>Ctrl/⌘ + K</kbd></td><td>Focus search</td></tr>
              <tr><td><kbd>Esc</kbd></td><td>Close panel / blur search</td></tr>
              <tr><td><kbd>?</kbd></td><td>Open this help</td></tr>
              <tr><td><kbd>↑</kbd> / <kbd>↓</kbd></td><td>Navigate operation list</td></tr>
              <tr><td><kbd>Enter</kbd></td><td>Expand / collapse selected</td></tr>
            </tbody>
          </table>
          <div style="margin-top:12px;text-align:right">
            <button class="btn" type="button" data-ok>OK</button>
          </div>
        </div>
      </div>`
    const close = () => appStore.set({ helpOpen: false })
    this.querySelector('.modal-backdrop')?.addEventListener('click', close)
    this.querySelector('.modal')?.addEventListener('click', (e) => e.stopPropagation())
    this.querySelector('[data-ok]')?.addEventListener('click', close)
  }
}
customElements.define('dbh-help-modal', DbhHelpModal)
