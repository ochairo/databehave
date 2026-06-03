import type { ErrorMode, Matcher, ModeKind, Operation, ScopeKind, StickyOverride } from '../types'
import { utf8ToBase64, isAscii } from '../utils/base64'
import { applyOverride, removeOverride, openGlobalOverride, appStore, toast } from '../app-store'
import { esc } from '../html'

const MODE_OPTIONS: ModeKind[] = ['http-status', 'business-failure', 'custom-body', 'empty-body', 'malformed-json', 'delay', 'hang', 'destroy']

/**
 * Per-endpoint "inject error" form. Scopes are limited to `exact` and
 * `path` — the `global` scope was moved out to the dedicated top-bar
 * modal (`<dbh-global-override-panel>`). When a global override is
 * active a small hint surfaces with a "manage from top bar" button.
 *
 * Use `setOp({ op, existing, globalActive })` to (re)render. The card
 * keeps form state in instance fields so partial typing survives
 * external re-renders.
 */
export class DbhInjectErrorPanel extends HTMLElement {
  private _op: Operation | null = null
  private _existing: StickyOverride | undefined
  private _globalActive = false
  /** Last header override emitted to TryItOut (sibling). */
  headerOverride: { name: string; value: string } | null = null
  // Form state.
  private _scope: Exclude<ScopeKind, 'global'> = 'exact'
  private _kind: ModeKind = 'http-status'
  private _status = 500
  private _message = ''
  private _body = '{}'
  private _contentType = 'application/json'
  private _ms = 1000
  private _description = ''

  setOp(input: { op: Operation; existing: StickyOverride | undefined; globalActive: boolean }): void {
    const sameExisting = this._existing?.id === input.existing?.id && this._op?.path === input.op.path && this._op?.method === input.op.method
    this._op = input.op
    this._existing = input.existing
    this._globalActive = input.globalActive
    if (!sameExisting) this._syncFromExisting()
    this._render()
  }
  private _syncFromExisting(): void {
    const e = this._existing
    if (!e) {
      this._scope = 'exact'; this._kind = 'http-status'; this._status = 500
      this._message = ''; this._body = '{}'; this._contentType = 'application/json'
      this._ms = 1000; this._description = ''
      return
    }
    if (e.matcher.kind === 'exact' || e.matcher.kind === 'path') this._scope = e.matcher.kind
    this._kind = e.mode.kind
    this._description = e.description ?? ''
    const m = e.mode
    if (m.kind === 'http-status') this._status = m.status
    else if (m.kind === 'business-failure') this._message = m.message
    else if (m.kind === 'custom-body') { this._status = m.status ?? 200; this._body = JSON.stringify(m.body, null, 2); this._contentType = m.contentType ?? 'application/json' }
    else if (m.kind === 'empty-body') this._status = m.status ?? 204
    else if (m.kind === 'delay') this._ms = m.ms
  }
  private _renderFieldsHtml(): string {
    const k = this._kind
    if (k === 'http-status' || k === 'empty-body' || k === 'malformed-json') {
      return `<div class="row"><label>Status</label><input type="number" data-field="status" value="${this._status}" /></div>`
    }
    if (k === 'business-failure') {
      return `<div class="row"><label>Message</label><input type="text" data-field="message" value="${esc(this._message)}" placeholder="Optional message returned with the failure" /></div>`
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
    if (!this._op) { this.innerHTML = ''; return }
    const e = this._existing
    this.innerHTML = `
      <div class="mock-zone">
        <h4>Inject error</h4>
        ${this._globalActive ? `
          <div class="global-active-hint" role="note">
            <span>A global override is active. Manage it from the top bar.</span>
            <button type="button" class="btn ghost" data-open-global>Open</button>
          </div>` : ''}
        <div class="row">
          <label>Scope</label>
          <div class="radio-group">
            <label><input type="radio" name="scope" data-scope="exact"${this._scope === 'exact' ? ' checked' : ''}/> Exact (METHOD + this path)</label>
            <label><input type="radio" name="scope" data-scope="path"${this._scope === 'path' ? ' checked' : ''}/> Path (any method on this path)</label>
          </div>
        </div>
        <div class="row">
          <label>Mode</label>
          <select data-mode>${MODE_OPTIONS.map((m) => `<option value="${m}"${m === this._kind ? ' selected' : ''}>${m}</option>`).join('')}</select>
        </div>
        <div data-fields>${this._renderFieldsHtml()}</div>
        <div class="row">
          <label>Description</label>
          <input type="text" data-field="description" value="${esc(this._description)}" />
        </div>
        <div class="actions">
          <button class="btn primary" type="button" data-submit>${e ? 'Update' : 'Apply'}</button>
          ${e ? `<button class="btn danger" type="button" data-remove="${esc(e.id)}">Remove</button>` : ''}
        </div>
      </div>`
    this._wire()
  }
  private _wire(): void {
    this.querySelector('[data-open-global]')?.addEventListener('click', () => openGlobalOverride())
    for (const r of this.querySelectorAll<HTMLInputElement>('[data-scope]')) {
      r.addEventListener('change', () => { if (r.checked) this._scope = (r.dataset.scope as 'exact' | 'path') })
    }
    const sel = this.querySelector<HTMLSelectElement>('[data-mode]')
    sel?.addEventListener('change', () => {
      this._kind = sel.value as ModeKind
      // Re-render only the dynamic fields slot so the rest of the form keeps state/focus.
      const slot = this.querySelector('[data-fields]')
      if (slot) { slot.innerHTML = this._renderFieldsHtml(); this._wireFields() }
    })
    this._wireFields()
    this.querySelector('[data-submit]')?.addEventListener('click', () => this._submit())
    const rm = this.querySelector<HTMLElement>('[data-remove]')
    rm?.addEventListener('click', () => { void removeOverride(rm.dataset.remove ?? '') })
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
    const op = this._op
    if (!op) return
    const matcher: Matcher =
      this._scope === 'exact'
        ? { kind: 'exact', method: op.method, path: op.path }
        : { kind: 'path', path: op.path }
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
    this.headerOverride = headerOverride
    this.dispatchEvent(new CustomEvent('dbh-header-override', { detail: headerOverride, bubbles: true }))
    void (async () => {
      const existing = this._existing
      if (existing && matcher.kind === existing.matcher.kind) {
        try { await removeOverride(existing.id) } catch { /* still proceed */ }
      }
      try { await applyOverride(matcher, mode, this._description || undefined) }
      catch (err) { toast('error', err instanceof Error ? err.message : String(err)) }
    })()
  }
}
customElements.define('dbh-inject-error-panel', DbhInjectErrorPanel)
// avoid `appStore` unused-import warnings when reused elsewhere
void appStore
