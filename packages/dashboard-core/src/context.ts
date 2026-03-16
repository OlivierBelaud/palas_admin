/**
 * DashboardContext — React context providing the 3 abstractions.
 * Each distribution creates its own implementations and wraps DashboardApp with this context.
 */
import { createContext, useContext } from "react"
import type { DataSource } from "./interfaces/data-source"
import type { AuthAdapter } from "./interfaces/auth-adapter"
import type { OverrideStore } from "./interfaces/override-store"

export interface DashboardContextValue {
  dataSource: DataSource
  authAdapter: AuthAdapter
  overrideStore: OverrideStore
}

export const DashboardContext = createContext<DashboardContextValue | null>(null)

export function useDashboardContext(): DashboardContextValue {
  const ctx = useContext(DashboardContext)
  if (!ctx) {
    throw new Error("useDashboardContext must be used within a DashboardContext.Provider")
  }
  return ctx
}
