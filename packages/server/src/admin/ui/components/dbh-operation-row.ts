import './dbh-method-badge'
import type { Operation, StickyOverride } from '../types'
import { modeDotColor } from '../utils/colors'
import { esc } from '../html'
import { appStore } from '../app-store'

/** Single row in a group: method badge, path, summary, override dot. */
export class DbhOperationRow extends HTMLElement {
  setRow(input: { op: Operation; override: StickyOverride | undefined; expanded: boolean; focused: boolean }): void {
    const { op, override, expanded, focused } = input
    const color = override ? modeDotColor(override.mode.kind) : 'transparent'
    const noOas = op.source === 'handler'
    this.innerHTML = `
      <div class="op-row${focused ? ' focused' : ''}${expanded ? ' expanded' : ''}" data-key="${esc(op.method + ' ' + op.path)}">
        <dbh-method-badge method="${esc(op.method)}"></dbh-method-badge>
        <span class="path">${esc(op.path)}${noOas ? ' <span class="no-oas-pill" title="No OpenAPI spec for this route">(no OAS)</span>' : ''}</span>
        <span class="summary">${esc(op.op.summary ?? '')}</span>
        <span class="dot${override ? ' active' : ''}" style="${override ? `background:${color}` : ''}" title="${esc(override?.mode.kind ?? '')}"></span>
      </div>`
    const row = this.querySelector('.op-row')
    row?.addEventListener('click', () => {
      const key = op.method + ' ' + op.path
      const current = appStore.get().expandedKey
      appStore.set({ expandedKey: current === key ? null : key })
    })
  }
}
customElements.define('dbh-operation-row', DbhOperationRow)
