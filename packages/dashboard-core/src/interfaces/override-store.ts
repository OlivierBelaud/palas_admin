/**
 * OverrideStore — how AI customizations are persisted.
 * - Medusa: localStorage (LocalStorageOverrideStore)
 * - Manta: API-backed with local cache (ApiOverrideStore)
 */
import type { DataComponent, PageSpec } from '../pages/types'

export interface CustomNavItem {
  key: string
  label: string
  path: string
  icon?: string
}

export interface NavigationItem {
  key: string
  label: string
  icon: string
  path: string
  children?: Array<{
    key: string
    label: string
    path: string
    icon?: string
  }>
}

export interface Overrides {
  components: Record<string, DataComponent>
  pages: Record<string, Partial<PageSpec>>
  customPages: Record<string, PageSpec>
  customComponents: Record<string, DataComponent>
  customNavItems: CustomNavItem[]
  navigation: NavigationItem[] | null
}

export interface OverrideStore {
  getOverrides(): Overrides
  getVersion(): number
  subscribe(listener: () => void): () => void
  setComponentOverride(id: string, component: DataComponent): void
  setPageOverride(id: string, page: Partial<PageSpec>): void
  clearOverrides(): void
  removeComponentOverride(id: string): void
  removePageOverride(id: string): void
  getCustomPages(): Record<string, PageSpec>
  getCustomComponents(): Record<string, DataComponent>
  getCustomNavItems(): CustomNavItem[]
  addCustomPage(page: PageSpec, components: DataComponent[], navItem: CustomNavItem): void
  removeCustomPage(pageId: string): void
  updateCustomPage(pageId: string, updates: { route?: string; label?: string }): void
  getNavigationOverride(): NavigationItem[] | null
  setNavigationOverride(navigation: NavigationItem[]): void
  resetNavigationOverride(): void
  initialize?(): Promise<void>
  flush?(): Promise<void>
}
