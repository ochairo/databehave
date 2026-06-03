import { subscribeToasts, getToasts, dismissToast } from '../app-store'
import type { Toast } from '../types'
import { esc } from '../html'

/** Stack of transient toast notifications. */
export class DbhToasts extends HTMLElement {
  private _unsub?: () => void
  connectedCallback(): void {
    this._render(getToasts())
    this._unsub = subscribeToasts((t) => this._render(t))
  }
  disconnectedCallback(): void { this._unsub?.() }
  private _render(toasts: Toast[]): void {
    this.innerHTML =
      `<div class="toast-stack">` +
      toasts.map((t) =>
        `<div class="toast ${esc(t.kind)}" data-id="${t.id}">${esc(t.message)}</div>`,
      ).join('') +
      `</div>`
    for (const el of this.querySelectorAll<HTMLElement>('.toast')) {
      el.addEventListener('click', () => {
        const id = Number(el.dataset.id)
        if (Number.isFinite(id)) dismissToast(id)
      })
    }
  }
}
customElements.define('dbh-toasts', DbhToasts)
