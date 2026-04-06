import type { DataComponent, INavItem, PageSpec } from '@manta/dashboard-core'

/**
 * Registry response from GET /api/admin/registry
 * Plugins declare their admin UI through this endpoint.
 */
export interface RegistryResponse {
  pages: Record<string, PageSpec>
  components: Record<string, DataComponent>
  navigation: Omit<INavItem, 'pathname'>[]
  endpoints?: Record<string, string>
  queryKeys?: Record<string, string>
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
    headers['Authorization'] = `Bearer ${token}`
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
