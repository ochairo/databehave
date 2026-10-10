import type { Scenario, ScenarioSummary, StickyOverride } from './admin-types.js'

/** Storage-neutral persistence supplied explicitly to admin. Implementations own I/O and atomic saves. */
export interface ScenariosStore {
  list(): Promise<ScenarioSummary[]>
  get(name: string): Promise<Scenario | null>
  save(name: string, overrides: readonly StickyOverride[]): Promise<Scenario>
  remove(name: string): Promise<boolean>
}
