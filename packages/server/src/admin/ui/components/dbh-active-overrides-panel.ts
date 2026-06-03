import { appStore, removeOverride, openGlobalOverride } from '../app-store'
import { modeDotColor } from '../utils/colors'
import { opKey } from '../store'
import type { StickyOverride } from '../types'
import { esc } from '../html'

const matcherLabel = (o: StickyOverride): string => {
  if (o.matcher.kind === 'exact') return `${o.matcher.method} ${o.matcher.path}`
  if (o.matcher.kind === 'path') return `* ${o.matcher.path}`
  const ms = o.matcher.methods
  if (ms && ms.length > 0) return `${ms.join('|')} (global)`
  return '* (global)'
}
const scopeOrder = (o: StickyOverride): number =>
  o.matcher.kind === 'global' ? 0 : o.matcher.kind === 'path' ? 1 : 2

/** Slide-in right side panel listing every active sticky override. */
export class DbhActiveOverridesPanel extends HTMLElement {
  private _unsub?: () => void
  connectedCallback(): void {
    this._render()
    this._unsub = appStore.subscribe(() => this._render())
  }
  disconnectedCallback(): void { this._unsub?.() }
  private _render(): void {
    const s = appStore.get()
    const sorted = [...s.overrides].sort((a, b) => scopeOrder(a) - scopeOrder(b))
    this.innerHTML = `
      <aside class="right-panel${s.rightPanelOpen ? ' open' : ''}">
        <header>
          <h2>Active overrides (${s.overrides.length})</h2>
          <button class="btn ghost" type="button" data-close>×</button>
        </header>
        <div class="list">
          ${s.overrides.length === 0
            ? `<p style="padding:12px;color:#57606a">No active overrides</p>`
            : sorted.map((o) => `
              <div class="override-item${o.matcher.kind === 'global' ? ' is-global' : ''}" data-jump="${esc(o.id)}">
                <span class="dot" style="background:${modeDotColor(o.mode.kind)}"></span>
                ${o.matcher.kind === 'global' ? `<span class="scope-badge scope-global">GLOBAL</span>` : ''}
                <div class="info">
                  <div class="route">${esc(matcherLabel(o))}</div>
                  <small>${esc(o.mode.kind)}${o.description ? ` — ${esc(o.description)}` : ''}</small>
                </div>
                <button class="btn danger" type="button" data-remove="${esc(o.id)}">Remove</button>
              </div>`).join('')}
        </div>
      </aside>`
    this.querySelector('[data-close]')?.addEventListener('click', () => appStore.set({ rightPanelOpen: false }))
    for (const el of this.querySelectorAll<HTMLElement>('[data-jump]')) {
      el.addEventListener('click', () => {
        const id = el.dataset.jump ?? ''
        const o = appStore.get().overrides.find((x) => x.id === id)
        if (!o) return
        if (o.matcher.kind === 'global') { openGlobalOverride(); return }
        if (o.matcher.kind !== 'exact') { appStore.set({ rightPanelOpen: false }); return }
        const key = opKey(o.matcher.method, o.matcher.path)
        appStore.set({ expandedKey: key, focusedKey: key, rightPanelOpen: false })
        setTimeout(() => {
          const target = document.querySelector(`[data-key="${key.replace(/"/g, '\\"')}"]`)
          if (target && 'scrollIntoView' in target) (target as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 50)
      })
    }
    for (const el of this.querySelectorAll<HTMLElement>('[data-remove]')) {
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        void removeOverride(el.dataset.remove ?? '')
      })
    }
  }
}
customElements.define('dbh-active-overrides-panel', DbhActiveOverridesPanel)
