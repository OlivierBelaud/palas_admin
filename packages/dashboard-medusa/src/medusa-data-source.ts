import type { DataSource } from '@manta/dashboard-core'
import { entityEndpointMap, entityQueryKeyMap } from './entity-maps'

export class MedusaDataSource implements DataSource {
  baseUrl: string

  constructor({ baseUrl }: { baseUrl?: string } = {}) {
    this.baseUrl = baseUrl || '/'
  }

  async fetch(endpoint: string, _params?: Record<string, unknown>): Promise<unknown> {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl === '/' ? '' : this.baseUrl}${endpoint}`
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json()
  }

  async mutate(endpoint: string, method: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl === '/' ? '' : this.baseUrl}${endpoint}`
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json()
  }

  entityToEndpoint(entity: string): string {
    if (entityEndpointMap[entity]) return entityEndpointMap[entity]
    const kebab = entity.replace(/_/g, '-')
    return `/admin/${kebab}s`
  }

  getQueryKey(entity: string): string {
    return entityQueryKeyMap[entity] || entity
  }
}
