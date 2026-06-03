import type { OpenApiDoc, OpenApiParam, Operation } from '../types'
import { exampleFromSchema } from '../utils/example-from-schema'
import { esc } from '../html'
import { DbhResponseViewer, type ResponseState } from './dbh-response-viewer'

const initialBody = (op: Operation, doc: OpenApiDoc | null): string => {
  const schema = op.op.requestBody?.content?.['application/json']?.schema
  if (!schema) return ''
  return JSON.stringify(exampleFromSchema(schema, doc), null, 2)
}

/**
 * Collapsible "try it out" form. Builds parameter inputs from the
 * OpenAPI op, optionally a body textarea for non-GET/HEAD, and
 * dispatches the live request. Carries an optional `extraHeader`
 * (set by `<dbh-inject-error-panel>` for unicode business-failure
 * payloads).
 */
export class DbhTryItOut extends HTMLElement {
  private _op: Operation | null = null
  private _doc: OpenApiDoc | null = null
  /** Optional header forwarded with the request (e.g. x-mock-business-failure-b64). */
  extraHeader: { name: string; value: string } | null = null
  private _pvals: Record<string, string> = {}
  /** Free-form query KV pairs for handler-only routes (no OAS schema). */
  private _freeQuery: Array<{ key: string; value: string }> = []
  private _body = ''
  private _busy = false

  setOp(op: Operation, doc: OpenApiDoc | null): void {
    this._op = op
    this._doc = doc
    this._pvals = {}
    for (const p of op.op.parameters ?? []) this._pvals[p.name] = String(p.schema?.default ?? '')
    this._body = initialBody(op, doc)
    this._freeQuery = op.source === 'handler' ? [{ key: '', value: '' }] : []
    this._render()
  }
  private _render(): void {
    const op = this._op
    if (!op) { this.innerHTML = ''; return }
    const params = op.op.parameters ?? []
    const hasBody = op.method !== 'GET' && op.method !== 'HEAD'
    const handlerOnly = op.source === 'handler'
    this.innerHTML = `
      <details class="try-it">
        <summary>Try it out</summary>
        ${params.map((p: OpenApiParam) => `
          <div class="field">
            <label>${esc(p.name)} <small>(${esc(p.in)}${p.required ? ', required' : ''})</small></label>
            <input type="text" data-pname="${esc(p.name)}" value="${esc(this._pvals[p.name] ?? '')}" />
          </div>`).join('')}
        ${handlerOnly ? `
          <div class="field">
            <label>query params <small>(free-form)</small></label>
            <div data-free-query>
              ${this._freeQuery.map((kv, i) => `
                <div class="free-q-row" style="display:flex;gap:6px;margin-bottom:4px">
                  <input type="text" data-fq-key="${i}" placeholder="name" value="${esc(kv.key)}" style="flex:1" />
                  <input type="text" data-fq-val="${i}" placeholder="value" value="${esc(kv.value)}" style="flex:2" />
                  <button class="btn ghost" type="button" data-fq-rm="${i}" title="Remove">\u2212</button>
                </div>`).join('')}
              <button class="btn ghost" type="button" data-fq-add>+ Add query param</button>
            </div>
          </div>` : ''}
        ${hasBody ? `
          <div class="field">
            <label>body${handlerOnly ? ' <small>(free-form)</small>' : ''}</label>
            <textarea data-body style="width:100%;min-height:100px;font-family:ui-monospace,Menlo,monospace">${esc(this._body)}</textarea>
          </div>` : ''}
        <button class="btn primary" type="button" data-send${this._busy ? ' disabled' : ''}>${this._busy ? '\u2026' : 'Send'}</button>
        <dbh-response-viewer></dbh-response-viewer>
      </details>`
    for (const el of this.querySelectorAll<HTMLInputElement>('[data-pname]')) {
      el.addEventListener('input', () => { this._pvals[el.dataset.pname ?? ''] = el.value })
    }
    for (const el of this.querySelectorAll<HTMLInputElement>('[data-fq-key]')) {
      el.addEventListener('input', () => {
        const i = Number(el.dataset.fqKey)
        if (this._freeQuery[i]) this._freeQuery[i].key = el.value
      })
    }
    for (const el of this.querySelectorAll<HTMLInputElement>('[data-fq-val]')) {
      el.addEventListener('input', () => {
        const i = Number(el.dataset.fqVal)
        if (this._freeQuery[i]) this._freeQuery[i].value = el.value
      })
    }
    for (const el of this.querySelectorAll<HTMLButtonElement>('[data-fq-rm]')) {
      el.addEventListener('click', () => {
        const i = Number(el.dataset.fqRm)
        this._freeQuery.splice(i, 1)
        if (this._freeQuery.length === 0) this._freeQuery.push({ key: '', value: '' })
        this._render()
      })
    }
    this.querySelector('[data-fq-add]')?.addEventListener('click', () => {
      this._freeQuery.push({ key: '', value: '' })
      this._render()
    })
    const bodyEl = this.querySelector<HTMLTextAreaElement>('[data-body]')
    bodyEl?.addEventListener('input', () => { this._body = bodyEl.value })
    this.querySelector('[data-send]')?.addEventListener('click', () => { void this._send() })
  }
  private _buildUrl(): string {
    const op = this._op
    if (!op) return ''
    const params = op.op.parameters ?? []
    let path = op.path
    const query = new URLSearchParams()
    for (const p of params) {
      const v = this._pvals[p.name]
      if (!v) continue
      if (p.in === 'path') path = path.replace(`{${p.name}}`, encodeURIComponent(v))
      else if (p.in === 'query') query.set(p.name, v)
    }
    for (const kv of this._freeQuery) {
      if (kv.key) query.append(kv.key, kv.value)
    }
    const qs = query.toString()
    return qs ? `${path}?${qs}` : path
  }
  private async _send(): Promise<void> {
    const op = this._op
    if (!op) return
    this._busy = true
    const viewer = this.querySelector('dbh-response-viewer') as DbhResponseViewer | null
    viewer?.setResult(null)
    const btn = this.querySelector<HTMLButtonElement>('[data-send]')
    if (btn) { btn.disabled = true; btn.textContent = '…' }
    const started = performance.now()
    try {
      const headers: Record<string, string> = {}
      for (const p of op.op.parameters ?? []) {
        if (p.in === 'header' && this._pvals[p.name]) headers[p.name] = this._pvals[p.name]!
      }
      if (this.extraHeader) headers[this.extraHeader.name] = this.extraHeader.value
      const init: RequestInit = { method: op.method, headers }
      if (op.method !== 'GET' && op.method !== 'HEAD' && this._body) {
        headers['content-type'] = headers['content-type'] ?? 'application/json'
        init.body = this._body
      }
      const res = await fetch(this._buildUrl(), init)
      const text = await res.text()
      const out: ResponseState = { status: res.status, headers: {}, body: text, elapsedMs: Math.round(performance.now() - started) }
      res.headers.forEach((v, k) => { out.headers[k] = v })
      viewer?.setResult(out)
    } catch (err) {
      viewer?.setResult({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      this._busy = false
      if (btn) { btn.disabled = false; btn.textContent = 'Send' }
    }
  }
}
customElements.define('dbh-try-it-out', DbhTryItOut)
