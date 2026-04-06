import type { Overrides } from '@manta/dashboard-core'
import { LocalStorageOverrideStore } from '@manta/dashboard-core'

/**
 * ApiOverrideStore — extends LocalStorageOverrideStore with API persistence.
 * Overrides are cached locally and synced to the backend with debounced PUT.
 * Falls back gracefully if the API is unavailable.
 */
export class ApiOverrideStore extends LocalStorageOverrideStore {
  private apiUrl: string
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private pendingFlush = false

  constructor({ apiUrl }: { apiUrl: string }) {
    super()
    this.apiUrl = apiUrl
  }

  async initialize(): Promise<void> {
    // Try to load overrides from API
    try {
      const token = localStorage.getItem('manta-auth-token')
      if (!token) return

      const res = await fetch(`${this.apiUrl}/api/admin/overrides`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })
      if (res.ok) {
        const data = (await res.json()) as { overrides?: Overrides }
        if (data.overrides) {
          // Merge API overrides into local state
          const current = this.getOverrides()
          // API takes precedence for components/pages, local for custom pages
          // (custom pages may have been created offline)
          // For simplicity, just use API state if it has content
          if (Object.keys(data.overrides.components).length > 0 || Object.keys(data.overrides.pages).length > 0) {
            // Apply each override through the parent methods
            for (const [id, comp] of Object.entries(data.overrides.components)) {
              super.setComponentOverride(id, comp)
            }
            for (const [id, page] of Object.entries(data.overrides.pages)) {
              super.setPageOverride(id, page)
            }
          }
        }
      }
    } catch {
      // API unavailable — use local state
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    await this.syncToApi()
  }

  private scheduleSync() {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => {
      this.syncToApi()
    }, 2000) // 2s debounce
  }

  private async syncToApi() {
    try {
      const token = localStorage.getItem('manta-auth-token')
      if (!token) return

      const overrides = this.getOverrides()
      await fetch(`${this.apiUrl}/api/admin/overrides`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ overrides }),
      })
    } catch {
      // Sync failed — will retry on next change
    }
  }

  // Override mutation methods to schedule API sync
  setComponentOverride(id: string, component: any) {
    super.setComponentOverride(id, component)
    this.scheduleSync()
  }

  setPageOverride(id: string, page: any) {
    super.setPageOverride(id, page)
    this.scheduleSync()
  }

  clearOverrides() {
    super.clearOverrides()
    this.scheduleSync()
  }

  removeComponentOverride(id: string) {
    super.removeComponentOverride(id)
    this.scheduleSync()
  }

  removePageOverride(id: string) {
    super.removePageOverride(id)
    this.scheduleSync()
  }

  addCustomPage(page: any, components: any[], navItem: any) {
    super.addCustomPage(page, components, navItem)
    this.scheduleSync()
  }

  removeCustomPage(pageId: string) {
    super.removeCustomPage(pageId)
    this.scheduleSync()
  }

  updateCustomPage(pageId: string, updates: any) {
    super.updateCustomPage(pageId, updates)
    this.scheduleSync()
  }

  setNavigationOverride(navigation: any[]) {
    super.setNavigationOverride(navigation)
    this.scheduleSync()
  }

  resetNavigationOverride() {
    super.resetNavigationOverride()
    this.scheduleSync()
  }
}
