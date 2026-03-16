import type { DataComponent, PageSpec } from "../pages/types"
import type { OverrideStore } from "../interfaces/override-store"
import type { DashboardConfig, NavItem } from "./define-config"

export interface Resolver {
  resolveComponent(id: string): DataComponent | undefined
  resolvePageSpec(id: string): PageSpec | undefined
  getAllPageSpecs(): Record<string, PageSpec>
  resolveNavigation(defaultNav: NavItem[]): NavItem[]
}

export function createResolver(
  config: DashboardConfig,
  defaults: { pages: Record<string, PageSpec>; components: Record<string, DataComponent> },
  overrideStore: OverrideStore
): Resolver {
  return {
    resolveComponent(id: string): DataComponent | undefined {
      const runtime = overrideStore.getOverrides()
      if (runtime.components[id]) return runtime.components[id]
      const runtimeCustom = overrideStore.getCustomComponents()
      if (runtimeCustom[id]) return runtimeCustom[id]
      if (config.components?.[id]) return config.components[id]
      if (config.customComponents?.[id]) return config.customComponents[id]
      if (defaults.components[id]) return defaults.components[id]
      return undefined
    },

    resolvePageSpec(id: string): PageSpec | undefined {
      const runtime = overrideStore.getOverrides()
      if (runtime.pages[id]) {
        const base = config.customPages?.[id] || config.pages?.[id] || defaults.pages[id]
        if (base) return { ...base, ...runtime.pages[id] } as PageSpec
      }
      const runtimeCustomPages = overrideStore.getCustomPages()
      if (runtimeCustomPages[id]) return runtimeCustomPages[id]
      if (config.customPages?.[id]) return config.customPages[id]
      if (config.pages?.[id]) return config.pages[id]
      if (defaults.pages[id]) return defaults.pages[id]
      return undefined
    },

    getAllPageSpecs(): Record<string, PageSpec> {
      const runtimeCustomPages = overrideStore.getCustomPages()
      return {
        ...defaults.pages,
        ...config.pages,
        ...config.customPages,
        ...runtimeCustomPages,
      }
    },

    resolveNavigation(defaultNav: NavItem[]): NavItem[] {
      if (!config.navigation) return defaultNav

      const { hide, order, add, modify } = config.navigation
      let items = [...defaultNav]

      if (hide?.length) {
        items = items.filter((item) => !hide.includes(item.key))
      }

      if (modify) {
        items = items.map((item) => {
          const mod = modify[item.key]
          if (!mod) return item
          return { ...item, ...mod }
        })
      }

      if (add?.length) {
        items.push(...add)
      }

      if (order?.length) {
        const ordered: NavItem[] = []
        for (const key of order) {
          const found = items.find((item) => item.key === key)
          if (found) ordered.push(found)
        }
        for (const item of items) {
          if (!order.includes(item.key)) ordered.push(item)
        }
        items = ordered
      }

      return items
    },
  }
}
