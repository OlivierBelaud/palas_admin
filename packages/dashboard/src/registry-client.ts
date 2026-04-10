import type { DataComponent, PageSpec } from '@manta/dashboard-core'

/** JSON-serializable navigation item (icon as string, resolved client-side via resolveIcon). */
export interface RegistryNavItem {
  icon?: string
  label: string
  to: string
  items?: Array<{ label: string; to: string }>
}

/**
 * Registry response from GET /api/admin/registry
 * Plugins declare their admin UI through this endpoint.
 */
export interface RegistryResponse {
  pages: Record<string, PageSpec>
  components: Record<string, DataComponent>
  navigation: RegistryNavItem[]
  endpoints?: Record<string, string>
  queryKeys?: Record<string, string>
  ai?: { enabled?: boolean }
}

/**
 * Fetch the admin registry from the backend.
 * Returns pages, components, and navigation declared by plugins.
 */
export async function fetchRegistry(baseUrl: string): Promise<RegistryResponse> {
  const token = localStorage.getItem('manta-auth-token')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(`${baseUrl}/api/admin/registry`, { headers })
  if (!res.ok) {
    // Return empty registry if endpoint not available
    return {
      pages: {},
      components: {},
      navigation: [],
    }
  }
  return res.json()
}
