/**
 * Module-level singletons for the 3 adapters.
 * Set once at boot by DashboardApp, then accessed directly by SpecRenderer
 * and other components — no React context overhead, stable references.
 */
import type { DataSource } from "./interfaces/data-source"
import type { AuthAdapter } from "./interfaces/auth-adapter"
import type { OverrideStore } from "./interfaces/override-store"

let _dataSource: DataSource | null = null
let _authAdapter: AuthAdapter | null = null
let _overrideStore: OverrideStore | null = null

export function setDashboardAdapters(
  dataSource: DataSource,
  authAdapter: AuthAdapter,
  overrideStore: OverrideStore
) {
  _dataSource = dataSource
  _authAdapter = authAdapter
  _overrideStore = overrideStore
}

export function getDataSource(): DataSource {
  if (!_dataSource) throw new Error("Dashboard not initialized — call setDashboardAdapters first")
  return _dataSource
}

export function getAuthAdapter(): AuthAdapter {
  if (!_authAdapter) throw new Error("Dashboard not initialized — call setDashboardAdapters first")
  return _authAdapter
}

export function getOverrideStore(): OverrideStore {
  if (!_overrideStore) throw new Error("Dashboard not initialized — call setDashboardAdapters first")
  return _overrideStore
}

// Stable function references for useSyncExternalStore — never change
export function subscribe(cb: () => void): () => void {
  return getOverrideStore().subscribe(cb)
}

export function getOverridesVersion(): number {
  return getOverrideStore().getVersion()
}
