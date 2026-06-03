import type { OpenApiDoc, Operation } from '../types'
import { sanitiseMarkdown } from '../utils/sanitise-markdown'
import { exampleFromSchema } from '../utils/example-from-schema'
import { renderSchemaTree } from './dbh-schema-tree'
import { toast } from '../app-store'
import { esc } from '../html'

/**
 * Read-only "spec" section of an expanded operation card — markdown
 * description, parameter table, request body schema tree + copy button,
 * response code list. Populated via `setOp(op, doc)`.
 */
export class DbhSpecZone extends HTMLElement {
  private _op: Operation | null = null
  private _doc: OpenApiDoc | null = null
  setOp(op: Operation, doc: OpenApiDoc | null): void {
    this._op = op
    this._doc = doc
    this._render()
  }
  private _render(): void {
    const op = this._op
    if (!op) { this.innerHTML = ''; return }
    if (op.source === 'handler') {
      this.innerHTML = `
        <div class="spec-zone">
          <h4>Spec</h4>
          <div class="desc" style="color:#57606a;font-style:italic">
            No OpenAPI spec for this route. Inject controls and Try-it-out still
            work; request/response schemas are unavailable.
          </div>
        </div>`
      return
    }
    const doc = this._doc
    const body = op.op.requestBody?.content?.['application/json']
    const bodySchema = body?.schema
    const example = body ? (body.example ?? exampleFromSchema(bodySchema, doc)) : null
    const exampleStr = example != null ? JSON.stringify(example, null, 2) : ''
    const params = op.op.parameters ?? []
    const responses = op.op.responses ?? {}
    this.innerHTML = `
      <div class="spec-zone">
        <h4>Spec</h4>
        ${op.op.description ? `<div class="desc">${sanitiseMarkdown(op.op.description)}</div>` : ''}
        ${params.length > 0 ? `
          <div style="margin-top:8px">
            <h4>Parameters</h4>
            <table>
              <thead><tr><th>name</th><th>in</th><th>type</th><th>required</th><th>description</th></tr></thead>
              <tbody>
                ${params.map((p) => `
                  <tr>
                    <td><code>${esc(p.name)}</code></td>
                    <td>${esc(p.in)}</td>
                    <td>${esc(p.schema?.type ?? 'any')}</td>
                    <td>${p.required ? 'yes' : ''}</td>
                    <td>${esc(p.description ?? '')}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : ''}
        ${bodySchema ? `
          <div style="margin-top:8px">
            <h4>Request body</h4>
            <div class="schema-tree">${renderSchemaTree(bodySchema, doc)}</div>
            ${exampleStr ? `<button class="btn ghost" style="margin-top:6px" type="button" data-copy>Copy as JSON example</button>` : ''}
          </div>` : ''}
        ${Object.keys(responses).length > 0 ? `
          <div style="margin-top:8px">
            <h4>Responses</h4>
            ${Object.entries(responses).map(([code, r]) => {
              const schema = r.content?.['application/json']?.schema
              return `
                <details style="margin-top:4px">
                  <summary><strong>${esc(code)}</strong> — ${esc(r.description ?? '')}</summary>
                  ${schema ? `<div class="schema-tree">${renderSchemaTree(schema, doc)}</div>` : ''}
                </details>`
            }).join('')}
          </div>` : ''}
      </div>`
    this.querySelector('[data-copy]')?.addEventListener('click', () => {
      void navigator.clipboard?.writeText(exampleStr)
      toast('info', 'Copied')
    })
  }
}
customElements.define('dbh-spec-zone', DbhSpecZone)
