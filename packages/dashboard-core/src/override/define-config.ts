import type { DataComponent, PageSpec } from '../pages/types'

// Navigation types

export interface NavItem {
  key: string
  label: string
  path: string
  position: number
}

export interface NavigationConfig {
  hide?: string[]
  order?: string[]
  add?: NavItem[]
  modify?: Record<string, Partial<Pick<NavItem, 'label' | 'path' | 'position'>>>
}

// DashboardConfig

export interface DashboardConfig {
  components?: Record<string, DataComponent>
  pages?: Record<string, PageSpec>
  customComponents?: Record<string, DataComponent>
  customPages?: Record<string, PageSpec>
  navigation?: NavigationConfig
  theme?: { primaryColor?: string; logo?: string; title?: string }
  ai?: { enabled?: boolean; provider?: 'openai' | 'anthropic'; proxyUrl?: string }
  schema?: Record<string, unknown>
}

// defineConfig

export function defineConfig(input: Partial<DashboardConfig>): DashboardConfig {
  return {
    components: input.components ?? {},
    pages: input.pages ?? {},
    customComponents: input.customComponents,
    customPages: input.customPages,
    navigation: input.navigation,
    theme: input.theme,
    ai: input.ai,
    schema: input.schema,
  }
}
