import type { DataSource } from '@manta/dashboard-core'

/**
 * MantaDataSource — CQRS data source with automatic token refresh.
 *
 * All reads go through POST /api/admin/query/:entity.
 * All mutations go through POST /api/admin/command/:name.
 *
 * On 401, calls the injected `onUnauthorized` callback (which triggers
 * token refresh via the auth adapter). If refresh succeeds, retries once.
 */
export class MantaDataSource implements DataSource {
  baseUrl: string
  private endpointMap: Record<string, string> = {}
  private queryKeyMap: Record<string, string> = {}
  /** Injected by MantaDashboard — refreshes the access token, returns true on success */
  private _onUnauthorized: (() => Promise<boolean>) | null = null

  constructor({ baseUrl }: { baseUrl: string }) {
    this.baseUrl = baseUrl
  }

  /** Set the 401 handler — called by MantaDashboard after construction */
  setOnUnauthorized(handler: () => Promise<boolean>): void {
    this._onUnauthorized = handler
  }

  /** Called after registry discovery to populate entity maps */
  setEntityMaps(endpoints: Record<string, string>, queryKeys: Record<string, string>) {
    this.endpointMap = endpoints
    this.queryKeyMap = queryKeys
  }

  private getToken(): string | null {
    try {
      return localStorage.getItem('manta-auth-token')
    } catch {
      return null
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    const token = this.getToken()
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
    return headers
  }

  /**
   * Authenticated fetch with automatic retry on 401.
   * If the first request returns 401, refreshes the token and retries once.
   */
  private async _authFetch(url: string, init: RequestInit): Promise<Response> {
    let res = await fetch(url, { ...init, headers: this.buildHeaders() })

    if (res.status === 401 && this._onUnauthorized) {
      const refreshed = await this._onUnauthorized()
      if (refreshed) {
        // Retry with the new token
        res = await fetch(url, { ...init, headers: this.buildHeaders() })
      }
    }

    return res
  }

  async fetch(endpoint: string, _params?: Record<string, unknown>): Promise<unknown> {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`
    const res = await this._authFetch(url, {})
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json()
  }

  async mutate(endpoint: string, method: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${endpoint}`
    const res = await this._authFetch(url, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json()
  }

  async query(body: {
    entity: string
    id?: string
    filters?: Record<string, unknown>
    fields?: string[]
    limit?: number
    offset?: number
    order?: string
    q?: string
  }): Promise<unknown> {
    const { entity, ...params } = body
    const url = `${this.baseUrl}/api/admin/query/${entity}`
    const res = await this._authFetch(url, {
      method: 'POST',
      body: JSON.stringify(params),
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json()
  }

  async command(name: string, body: Record<string, unknown> = {}): Promise<unknown> {
    const url = `${this.baseUrl}/api/admin/command/${name}`
    const res = await this._authFetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json()
  }

  entityToEndpoint(entity: string): string {
    return `/api/admin/query/${entity}`
  }

  getQueryKey(entity: string): string {
    return this.queryKeyMap[entity] || entity
  }
}
