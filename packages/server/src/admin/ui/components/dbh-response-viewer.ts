import { esc } from '../html'

export interface ResponseState {
  status: number
  headers: Record<string, string>
  body: string
  elapsedMs: number
}

/** Inline `<details>` row that renders an HTTP response (or an error). */
export class DbhResponseViewer extends HTMLElement {
  setResult(r: ResponseState | { error: string } | null): void {
    if (r == null) { this.innerHTML = ''; return }
    if ('error' in r) {
      this.innerHTML = `<div class="response" style="color:#cf222e">Error: ${esc(r.error)}</div>`
      return
    }
    const ct = r.headers['content-type'] ?? ''
    let body = r.body
    if (ct.includes('json')) {
      try { body = JSON.stringify(JSON.parse(r.body), null, 2) } catch { /* keep raw */ }
    }
    if (!body) body = '(empty body)'
    this.innerHTML = `
      <div class="response">
        <div><strong>HTTP ${r.status}</strong> — ${r.elapsedMs}ms</div>
        <pre style="margin:6px 0;white-space:pre-wrap">${esc(body)}</pre>
      </div>`
  }
}
customElements.define('dbh-response-viewer', DbhResponseViewer)
