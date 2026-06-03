import { appStore } from '../app-store'

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']

/**
 * Sticky filter bar: search input + per-method toggles + "active only".
 * We render once and update DOM imperatively on store changes so the
 * focused input keeps focus across re-renders.
 */
export class DbhFilterBar extends HTMLElement {
  private _unsub?: () => void
  private _rendered = false
  /** Public ref so `<dbh-app>` can focus the search via keyboard shortcuts. */
  searchInput?: HTMLInputElement
  connectedCallback(): void {
    this._render()
    this._unsub = appStore.subscribe(() => this._sync())
  }
  disconnectedCallback(): void { this._unsub?.() }
  private _render(): void {
    const s = appStore.get()
    this.innerHTML =
      `<div class="filter-bar">` +
      `<input type="text" placeholder="Search path or summary…" value="${escAttr(s.search)}" data-search />` +
      METHODS.map((m) =>
        `<label><input type="checkbox" data-method="${m}"${s.methods.has(m) ? ' checked' : ''}/> ${m}</label>`,
      ).join('') +
      `<label><input type="checkbox" data-active${s.activeOnly ? ' checked' : ''}/> Active overrides only</label>` +
      `</div>`
    this.searchInput = this.querySelector<HTMLInputElement>('[data-search]') ?? undefined
    this.searchInput?.addEventListener('input', (e) => {
      const v = (e.target as HTMLInputElement).value
      appStore.set({ search: v })
    })
    for (const cb of this.querySelectorAll<HTMLInputElement>('[data-method]')) {
      cb.addEventListener('change', () => {
        const next = new Set(appStore.get().methods)
        const m = cb.dataset.method ?? ''
        if (cb.checked) next.add(m); else next.delete(m)
        appStore.set({ methods: next })
      })
    }
    this.querySelector<HTMLInputElement>('[data-active]')?.addEventListener('change', (e) => {
      appStore.set({ activeOnly: (e.target as HTMLInputElement).checked })
    })
    this._rendered = true
  }
  /** Update without blowing away DOM (so focus survives). */
  private _sync(): void {
    if (!this._rendered) return
    const s = appStore.get()
    if (this.searchInput && this.searchInput.value !== s.search) this.searchInput.value = s.search
    for (const cb of this.querySelectorAll<HTMLInputElement>('[data-method]')) {
      cb.checked = s.methods.has(cb.dataset.method ?? '')
    }
    const active = this.querySelector<HTMLInputElement>('[data-active]')
    if (active) active.checked = s.activeOnly
  }
}
const escAttr = (v: string): string => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
customElements.define('dbh-filter-bar', DbhFilterBar)
