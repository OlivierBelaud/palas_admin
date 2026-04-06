/**
 * DashboardContext — React context providing adapters + shared state.
 * Replaces module-level singletons (globals.ts) with proper React Context.
 */
import { createContext, useContext } from 'react'
import type { AuthAdapter } from './interfaces/auth-adapter'
import type { DataSource } from './interfaces/data-source'
import type { OverrideStore } from './interfaces/override-store'

export interface DashboardContextValue {
  dataSource: DataSource
  authAdapter: AuthAdapter
  overrideStore: OverrideStore
  /** Current version of the override store (reactive via useSyncExternalStore) */
  overridesVersion: number
  /** Whether AI features are enabled */
  aiEnabled: boolean
  /** Toggle AI feature flag */
  setAiEnabled: (enabled: boolean) => void
  /** Default navigation items (set by MainLayout, read by AI chat) */
  // biome-ignore lint/suspicious/noExplicitAny: navigation items are dynamic
  defaultNavigation: any[]
  /** Update default navigation items */
  // biome-ignore lint/suspicious/noExplicitAny: navigation items are dynamic
  setDefaultNavigation: (nav: any[]) => void
}

export const DashboardContext = createContext<DashboardContextValue | null>(null)

export function useDashboardContext(): DashboardContextValue {
  const ctx = useContext(DashboardContext)
  if (!ctx) {
    throw new Error('useDashboardContext must be used within a DashboardContext.Provider')
  }
  return ctx
}
