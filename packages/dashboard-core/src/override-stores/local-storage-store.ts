import type { CustomNavItem, NavigationItem, OverrideStore, Overrides } from '../interfaces/override-store'
import type { DataComponent, PageSpec } from '../pages/types'

const STORAGE_KEY = 'manta-ai-overrides'

function emptyOverrides(): Overrides {
  return { components: {}, pages: {}, customPages: {}, customComponents: {}, customNavItems: [], navigation: null }
}

function loadFromStorage(): Overrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyOverrides()
    const parsed = JSON.parse(raw)
    return {
      components: parsed.components || {},
      pages: parsed.pages || {},
      customPages: parsed.customPages || {},
      customComponents: parsed.customComponents || {},
      customNavItems: parsed.customNavItems || [],
      navigation: parsed.navigation || null,
    }
  } catch {
    return emptyOverrides()
  }
}

function saveToStorage(overrides: Overrides) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // quota exceeded — ignore
  }
}

export class LocalStorageOverrideStore implements OverrideStore {
  private _overrides: Overrides
  private _version = 0
  private _listeners = new Set<() => void>()

  constructor() {
    this._overrides = loadFromStorage()
  }

  private notify() {
    this._version++
    for (const listener of this._listeners) {
      listener()
    }
  }

  getOverrides(): Overrides {
    return this._overrides
  }

  getVersion(): number {
    return this._version
  }

  subscribe(listener: () => void): () => void {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  setComponentOverride(id: string, component: DataComponent) {
    this._overrides = {
      ...this._overrides,
      components: { ...this._overrides.components, [id]: component },
    }
    saveToStorage(this._overrides)
    this.notify()
  }

  setPageOverride(id: string, page: Partial<PageSpec>) {
    this._overrides = {
      ...this._overrides,
      pages: { ...this._overrides.pages, [id]: page },
    }
    saveToStorage(this._overrides)
    this.notify()
  }

  clearOverrides() {
    this._overrides = emptyOverrides()
    saveToStorage(this._overrides)
    this.notify()
  }

  removeComponentOverride(id: string) {
    const { [id]: _, ...rest } = this._overrides.components
    this._overrides = { ...this._overrides, components: rest }
    saveToStorage(this._overrides)
    this.notify()
  }

  removePageOverride(id: string) {
    const { [id]: _, ...rest } = this._overrides.pages
    this._overrides = { ...this._overrides, pages: rest }
    saveToStorage(this._overrides)
    this.notify()
  }

  getCustomPages(): Record<string, PageSpec> {
    return this._overrides.customPages
  }

  getCustomComponents(): Record<string, DataComponent> {
    return this._overrides.customComponents
  }

  getCustomNavItems(): CustomNavItem[] {
    return this._overrides.customNavItems
  }

  addCustomPage(page: PageSpec, components: DataComponent[], navItem: CustomNavItem) {
    const newComponents = { ...this._overrides.customComponents }
    for (const comp of components) {
      newComponents[comp.id] = comp
    }

    this._overrides = {
      ...this._overrides,
      customPages: { ...this._overrides.customPages, [page.id]: page },
      customComponents: newComponents,
      customNavItems: [...this._overrides.customNavItems.filter((n) => n.key !== navItem.key), navItem],
    }
    saveToStorage(this._overrides)
    this.notify()
  }

  removeCustomPage(pageId: string) {
    const page = this._overrides.customPages[pageId]
    if (!page) return

    const newComponents = { ...this._overrides.customComponents }
    for (const ref of page.main) {
      const compId = typeof ref === 'string' ? ref : (ref as { ref: string }).ref
      delete newComponents[compId]
    }
    if (page.sidebar) {
      for (const ref of page.sidebar) {
        const compId = typeof ref === 'string' ? ref : (ref as { ref: string }).ref
        delete newComponents[compId]
      }
    }

    const { [pageId]: _, ...restPages } = this._overrides.customPages

    let newNavigation = this._overrides.navigation
    if (newNavigation) {
      newNavigation = newNavigation.filter((item) => item.key !== pageId)
      newNavigation = newNavigation.map((item) => {
        if (!item.children) return item
        return {
          ...item,
          children: item.children.filter((child) => child.key !== pageId),
        }
      })
    }

    this._overrides = {
      ...this._overrides,
      customPages: restPages,
      customComponents: newComponents,
      customNavItems: this._overrides.customNavItems.filter((n) => n.key !== pageId),
      navigation: newNavigation,
    }
    saveToStorage(this._overrides)
    this.notify()
  }

  updateCustomPage(pageId: string, updates: { route?: string; label?: string }) {
    const page = this._overrides.customPages[pageId]
    if (!page) return

    if (updates.route) {
      this._overrides = {
        ...this._overrides,
        customPages: {
          ...this._overrides.customPages,
          [pageId]: { ...page, route: updates.route },
        },
      }
    }

    if (updates.route || updates.label) {
      this._overrides = {
        ...this._overrides,
        customNavItems: this._overrides.customNavItems.map((item) => {
          if (item.key !== pageId) return item
          return {
            ...item,
            ...(updates.label ? { label: updates.label } : {}),
            ...(updates.route ? { path: updates.route } : {}),
          }
        }),
      }
    }

    if (this._overrides.navigation && (updates.route || updates.label)) {
      this._overrides = {
        ...this._overrides,
        navigation: this._overrides.navigation.map((item) => {
          if (item.key === pageId) {
            return {
              ...item,
              ...(updates.label ? { label: updates.label } : {}),
              ...(updates.route ? { path: updates.route } : {}),
            }
          }
          if (item.children) {
            return {
              ...item,
              children: item.children.map((child) => {
                if (child.key !== pageId) return child
                return {
                  ...child,
                  ...(updates.label ? { label: updates.label } : {}),
                  ...(updates.route ? { path: updates.route } : {}),
                }
              }),
            }
          }
          return item
        }),
      }
    }

    saveToStorage(this._overrides)
    this.notify()
  }

  getNavigationOverride(): NavigationItem[] | null {
    return this._overrides.navigation
  }

  setNavigationOverride(navigation: NavigationItem[]) {
    this._overrides = { ...this._overrides, navigation }
    saveToStorage(this._overrides)
    this.notify()
  }

  resetNavigationOverride() {
    this._overrides = { ...this._overrides, navigation: null }
    saveToStorage(this._overrides)
    this.notify()
  }
}
