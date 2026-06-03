import type { ErrorMode, Matcher, ModeKind, StickyOverride } from '../types'
import { utf8ToBase64, isAscii } from '../utils/base64'
import { applyOverride, removeOverride, appStore, toast } from '../app-store'
import { modeDotColor } from '../utils/colors'
import { esc } from '../html'

const MODE_OPTIONS: ModeKind[] = ['http-status', 'business-failure', 'custom-body', 'empty-body', 'malformed-json', 'delay', 'hang', 'destroy']
const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

/**
 * Top-bar-owned modal for the `matcher.kind === 'global'` scope.
 * Pre-fills from the first active global if any; otherwise defaults
 * to `http-status 503`. Submitting an update first removes the
 * existing global so the server holds a single canonical row.
 */
export class DbhGlobalOverridePanel extends HTMLElement {
  private _unsub?: () => void
  private _kind: ModeKind = 'http-status'
  private _status = 503
  private _message = ''
  private _body = '{}'
  private _contentType = 'application/json'
  private _ms = 1000
  private _description = ''
  private _methods: Set<string> = new Set(METHOD_OPTIONS)
  private _lastExistingId?: string
  connectedCallback(): void {
    this._render()
    this._unsub = appStore.subscribe(() => this._render())
  }
  disconnectedCallback(): void { this._unsub?.() }
  private _globals(): StickyOverride[] {
    return appStore.get().overrides.filter((o) => o.matcher.kind === 'global')
  }
  private _syncFromExisting(existing: StickyOverride | undefined, open: boolean): void {
    if (!open) return
    if (existing && existing.id === this._lastExistingId) return
    this._lastExistingId = existing?.id
    if (existing) {
      this._kind = existing.mode.kind
      this._description = existing.description ?? ''
      const existingMethods = existing.matcher.kind === 'global' ? existing.matcher.methods : undefined
      this._methods = new Set(
        existingMethods && existingMethods.length > 0
          ? existingMethods.map((m) => m.toUpperCase())
          : METHOD_OPTIONS,
      )
      const m = existing.mode
      if (m.kind === 'http-status') this._status = m.status
      else if (m.kind === 'business-failure') this._message = m.message
      else if (m.kind === 'custom-body') { this._status = m.status ?? 200; this._body = JSON.stringify(m.body, null, 2); this._contentType = m.contentType ?? 'application/json' }
      else if (m.kind === 'empty-body') this._status = m.status ?? 204
      else if (m.kind === 'delay') this._ms = m.ms
    } else {
      this._kind = 'http-status'; this._status = 503; this._message = ''
      this._body = '{}'; this._contentType = 'application/json'; this._ms = 1000; this._description = ''
      this._methods = new Set(METHOD_OPTIONS)
    }
  }
  private _renderFieldsHtml(): string {
    const k = this._kind
    if (k === 'http-status' || k === 'empty-body' || k === 'malformed-json') {
      return `<div class="row"><label>Status</label><input type="number" data-field="status" value="${this._status}" /></div>`
    }
    if (k === 'business-failure') {
      return `<div class="row"><label>Message</label><input type="text" data-field="message" value="${esc(this._message)}" /></div>`
    }
    if (k === 'custom-body') {
      return `
        <div class="row"><label>Status</label><input type="number" data-field="status" value="${this._status}" /></div>
        <div class="row"><label>Content-Type</label><input type="text" data-field="contentType" value="${esc(this._contentType)}" /></div>
        <div class="row"><label>Body</label><textarea data-field="body">${esc(this._body)}</textarea></div>`
    }
    if (k === 'delay') {
      return `<div class="row"><label>Delay (ms)</label><input type="number" data-field="ms" value="${this._ms}" /></div>`
    }
    return ''
  }
  private _render(): void {
    const open = appStore.get().globalOpen
    if (!open) { this.innerHTML = ''; this._lastExistingId = undefined; return }
    const globals = this._globals()
    const existing = globals[0]
    this._syncFromExisting(existing, open)
    this.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal global-override-modal">
          <header class="global-override-header">
            <h2>Global override</h2>
            <button type="button" class="btn ghost close-x" data-close aria-label="Close">×</button>
          </header>
          <p class="global-override-desc">Applies to every route on this server. Use to simulate the backend being down, slow, etc.</p>
          <div class="row">
            <label>Mode</label>
            <select data-mode>${MODE_OPTIONS.map((m) => `<option value="${m}"${m === this._kind ? ' selected' : ''}>${m}</option>`).join('')}</select>
          </div>
          <div class="row global-override-methods">
            <label>Methods</label>
            <div class="method-checkboxes">
              ${METHOD_OPTIONS.map((m) => `
                <label class="method-checkbox">
                  <input type="checkbox" data-method="${m}"${this._methods.has(m) ? ' checked' : ''} />
                  <span>${m}</span>
                </label>`).join('')}
            </div>
          </div>
          <div data-fields>${this._renderFieldsHtml()}</div>
          <div class="row">
            <label>Description</label>
            <input type="text" data-field="description" value="${esc(this._description)}" />
          </div>
          <div class="actions">
            <button type="button" class="btn primary" data-submit>${existing ? 'Update' : 'Apply'}</button>
            ${existing ? `<button type="button" class="btn danger" data-remove="${esc(existing.id)}">Remove</button>` : ''}
          </div>
          ${globals.length > 0 ? `
            <div class="global-override-list">
              <h3>Active global overrides (${globals.length})</h3>
              ${globals.map((o) => {
                const ms = o.matcher.kind === 'global' ? o.matcher.methods : undefined
                const route = ms && ms.length > 0 ? `${ms.join('|')} (global)` : '* (global)'
                return `
                <div class="override-item">
                  <span class="dot" style="background:${modeDotColor(o.mode.kind)}"></span>
                  <div class="info">
                    <div class="route">${esc(route)}</div>
                    <small>${esc(o.mode.kind)}${o.description ? ` — ${esc(o.description)}` : ''}</small>
                  </div>
                  <button type="button" class="btn danger" data-remove="${esc(o.id)}">Remove</button>
                </div>`
              }).join('')}
            </div>` : ''}
        </div>
      </div>`
    this._wire()
  }
  private _wire(): void {
    const close = () => appStore.set({ globalOpen: false })
    this.querySelector('.modal-backdrop')?.addEventListener('click', close)
    this.querySelector('.modal')?.addEventListener('click', (e) => e.stopPropagation())
    this.querySelector('[data-close]')?.addEventListener('click', close)
    const sel = this.querySelector<HTMLSelectElement>('[data-mode]')
    sel?.addEventListener('change', () => {
      this._kind = sel.value as ModeKind
      const slot = this.querySelector('[data-fields]')
      if (slot) { slot.innerHTML = this._renderFieldsHtml(); this._wireFields() }
    })
    this._wireFields()
    for (const cb of this.querySelectorAll<HTMLInputElement>('[data-method]')) {
      cb.addEventListener('change', () => {
        const m = cb.dataset.method ?? ''
        if (cb.checked) this._methods.add(m)
        else this._methods.delete(m)
      })
    }
    this.querySelector('[data-submit]')?.addEventListener('click', () => this._submit())
    for (const el of this.querySelectorAll<HTMLElement>('[data-remove]')) {
      el.addEventListener('click', () => { void removeOverride(el.dataset.remove ?? '') })
    }
  }
  private _wireFields(): void {
    const desc = this.querySelector<HTMLInputElement>('[data-field="description"]')
    desc?.addEventListener('input', () => { this._description = desc.value })
    for (const el of this.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-fields] [data-field]')) {
      el.addEventListener('input', () => {
        const f = el.dataset.field as 'status' | 'message' | 'body' | 'contentType' | 'ms'
        if (f === 'status') this._status = Number(el.value)
        else if (f === 'ms') this._ms = Number(el.value)
        else if (f === 'message') this._message = el.value
        else if (f === 'body') this._body = el.value
        else if (f === 'contentType') this._contentType = el.value
      })
    }
  }
  private _submit(): void {
    let mode: ErrorMode
    let headerOverride: { name: string; value: string } | null = null
    const k = this._kind
    switch (k) {
      case 'http-status': mode = { kind: k, status: this._status }; break
      case 'business-failure':
        mode = { kind: k, message: this._message }
        if (!isAscii(this._message)) headerOverride = { name: 'x-mock-business-failure-b64', value: utf8ToBase64(this._message) }
        break
      case 'custom-body': {
        let parsed: unknown
        try { parsed = JSON.parse(this._body) } catch { parsed = this._body }
        mode = { kind: k, status: this._status, body: parsed, contentType: this._contentType }
        break
      }
      case 'empty-body': mode = { kind: k, status: this._status }; break
      case 'malformed-json': mode = { kind: k, status: this._status }; break
      case 'delay': mode = { kind: k, ms: this._ms }; break
      case 'hang': mode = { kind: k }; break
      case 'destroy': mode = { kind: k }; break
    }
    void headerOverride // global scope doesn't thread a per-request header
    const allMethods = METHOD_OPTIONS.length
    const selected = METHOD_OPTIONS.filter((m) => this._methods.has(m))
    if (selected.length === 0) {
      toast('error', 'Select at least one HTTP method.')
      return
    }
    const matcher: Matcher =
      selected.length === allMethods
        ? { kind: 'global' }
        : { kind: 'global', methods: selected }
    void (async () => {
      const existing = this._globals()[0]
      if (existing) { try { await removeOverride(existing.id) } catch { /* keep going */ } }
      try { await applyOverride(matcher, mode, this._description || undefined) }
      catch (err) { toast('error', err instanceof Error ? err.message : String(err)) }
    })()
  }
}
customElements.define('dbh-global-override-panel', DbhGlobalOverridePanel)
