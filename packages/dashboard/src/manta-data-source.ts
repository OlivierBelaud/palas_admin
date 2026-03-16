import type { DataSource } from "@manta/dashboard-core"

/**
 * MantaDataSource — JWT Bearer auth, dynamic endpoint map from registry.
 * Zero knowledge of Medusa entities.
 */
export class MantaDataSource implements DataSource {
  baseUrl: string
  private endpointMap: Record<string, string> = {}
  private queryKeyMap: Record<string, string> = {}

  constructor({ baseUrl }: { baseUrl: string }) {
    this.baseUrl = baseUrl
  }

  /** Called after registry discovery to populate entity maps */
  setEntityMaps(
    endpoints: Record<string, string>,
    queryKeys: Record<string, string>
  ) {
    this.endpointMap = endpoints
    this.queryKeyMap = queryKeys
  }

  private getToken(): string | null {
    try {
      return localStorage.getItem("manta-auth-token")
    } catch {
      return null
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    const token = this.getToken()
    if (token) {
      headers["Authorization"] = `Bearer ${token}`
    }
    return headers
  }

  async fetch(endpoint: string, params?: Record<string, unknown>): Promise<unknown> {
    const url = endpoint.startsWith("http")
      ? endpoint
      : `${this.baseUrl}${endpoint}`
    const res = await fetch(url, {
      headers: this.buildHeaders(),
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json()
  }

  async mutate(endpoint: string, method: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${endpoint}`
    const res = await fetch(url, {
      method,
      headers: this.buildHeaders(),
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json()
  }

  entityToEndpoint(entity: string): string {
    if (this.endpointMap[entity]) return this.endpointMap[entity]
    // Fallback: snake_case → kebab-case, pluralize
    const kebab = entity.replace(/_/g, "-")
    return `/api/admin/${kebab}s`
  }

  getQueryKey(entity: string): string {
    return this.queryKeyMap[entity] || entity
  }
}
