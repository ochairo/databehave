import { createStore, type Store } from './store'
import type { ErrorMode, Matcher, StickyOverride, Toast } from './types'
import { api } from './api'

/**
 * Single module-scoped store + command surface shared by every
 * `<dbh-*>` custom element. Components import `appStore` directly,
 * subscribe in `connectedCallback`, and call the action helpers
 * (`applyOverride`, `removeOverride`, etc.) instead of fetching the
 * API directly. The `<dbh-app>` root element owns the lifecycle
 * (initial fetch, keyboard shortcuts, etc.).
 */
export const appStore: Store = createStore()

let toastId = 0
const toastListeners = new Set<(toasts: Toast[]) => void>()
let toasts: Toast[] = []

export const subscribeToasts = (fn: (toasts: Toast[]) => void): (() => void) => {
  toastListeners.add(fn)
  return () => { toastListeners.delete(fn) }
}
const emit = () => { for (const fn of toastListeners) fn(toasts) }

export const toast = (kind: Toast['kind'], message: string): void => {
  const id = ++toastId
  toasts = [...toasts, { id, kind, message }]
  emit()
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id)
    emit()
  }, 3000)
}
export const dismissToast = (id: number): void => {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}
export const getToasts = (): Toast[] => toasts

export const refreshOverrides = async (): Promise<void> => {
  try { appStore.set({ overrides: await api.listOverrides() }) } catch { /* ignore */ }
}
export const refreshScenarios = async (): Promise<void> => {
  try { appStore.set({ scenarios: await api.listScenarios() }) } catch { /* ignore */ }
}

export const applyOverride = async (
  matcher: Matcher,
  mode: ErrorMode,
  description: string | undefined,
): Promise<StickyOverride> => {
  const out = await api.addOverride({ matcher, mode, description })
  toast('success', 'Override applied')
  await refreshOverrides()
  return out
}
export const removeOverride = async (id: string): Promise<void> => {
  await api.removeOverride(id)
  toast('success', 'Override removed')
  await refreshOverrides()
}
export const clearOverrides = async (): Promise<void> => {
  if (!window.confirm('Clear ALL sticky overrides?')) return
  try { await api.clearOverrides(); toast('success', 'Cleared'); await refreshOverrides() }
  catch (err) { toast('error', err instanceof Error ? err.message : String(err)) }
}
export const saveScenario = async (name: string): Promise<void> => {
  try { await api.saveScenario(name); toast('success', 'Saved: ' + name); await refreshScenarios() }
  catch (err) { toast('error', err instanceof Error ? err.message : String(err)) }
}
export const loadScenario = async (name: string): Promise<void> => {
  try { await api.loadScenario(name); toast('success', 'Loaded: ' + name); await refreshOverrides() }
  catch (err) { toast('error', err instanceof Error ? err.message : String(err)) }
}
export const deleteScenario = async (name: string): Promise<void> => {
  try { await api.deleteScenario(name); toast('success', 'Deleted: ' + name); await refreshScenarios() }
  catch (err) { toast('error', err instanceof Error ? err.message : String(err)) }
}

/** A few cross-component focus helpers. */
export const openGlobalOverride = (): void => appStore.set({ globalOpen: true, rightPanelOpen: false })
