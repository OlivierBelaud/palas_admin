// Manta SDK — HTTP client for CQRS endpoints
// Handles context resolution, JWT injection, and response parsing.

export interface MantaClientOptions {
  /** Context name (e.g. 'admin', 'store'). Determines the API base path. */
  context: string
  /** Base URL of the Manta backend. Default: '' (same origin). */
  baseUrl?: string
  /** Custom function to get the auth token. Default: reads from localStorage. */
  getToken?: () => string | null
  /** Called on 401 — should refresh the token and return true if successful. */
  onUnauthorized?: () => Promise<boolean>
}

export class MantaClient {
  private _context: string
  private _baseUrl: string
  private _getToken: () => string | null
  private _onUnauthorized: (() => Promise<boolean>) | null

  constructor(options: MantaClientOptions) {
    this._context = options.context
    this._baseUrl = options.baseUrl ?? ''
    this._onUnauthorized = options.onUnauthorized ?? null
    this._getToken =
      options.getToken ??
      (() => {
        if (typeof localStorage !== 'undefined') {
          return localStorage.getItem(`manta:token:${this._context}`)
        }
        return null
      })
  }

  get basePath(): string {
    return `${this._baseUrl}/api/${this._context}`
  }

  private _headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = this._getToken()
    if (token) headers.Authorization = `Bearer ${token}`
    return headers
  }

  /** Fetch with automatic 401 retry after token refresh. */
  private async _fetch(url: string, init: RequestInit): Promise<Response> {
    let res = await fetch(url, { ...init, headers: this._headers() })
    if (res.status === 401 && this._onUnauthorized) {
      const refreshed = await this._onUnauthorized()
      if (refreshed) {
        res = await fetch(url, { ...init, headers: this._headers() })
      }
    }
    return res
  }

  /** Execute a command (POST /api/{ctx}/command/{name}). */
  async command<TInput = unknown, TOutput = unknown>(name: string, input: TInput): Promise<TOutput> {
    const res = await this._fetch(`${this.basePath}/command/${name}`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
    const data = await res.json()
    if (!res.ok) throw new MantaSDKError(data.type ?? 'ERROR', data.message ?? res.statusText, res.status)
    return data.result ?? data.data ?? data
  }

  /** Execute a named query (GET /api/{ctx}/{queryName}?params). */
  async query<TOutput = unknown>(name: string, params?: Record<string, unknown>): Promise<TOutput> {
    const url = new URL(`${this.basePath}/${name}`, window.location.origin)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value))
        }
      }
    }
    const res = await this._fetch(url.toString(), {})
    const data = await res.json()
    if (!res.ok) throw new MantaSDKError(data.type ?? 'ERROR', data.message ?? res.statusText, res.status)
    return data.data ?? data
  }

  /** Execute a graph query (POST /api/{ctx}/graph). */
  async graphQuery<TOutput = unknown>(config: GraphQueryInput): Promise<TOutput> {
    const res = await this._fetch(`${this.basePath}/graph`, {
      method: 'POST',
      body: JSON.stringify(config),
    })
    const data = await res.json()
    if (!res.ok) throw new MantaSDKError(data.type ?? 'ERROR', data.message ?? res.statusText, res.status)
    return data.data ?? data
  }

  /** Login and store token. */
  async login(email: string, password: string): Promise<{ token: string; refreshToken: string }> {
    const res = await fetch(`${this.basePath}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await res.json()
    if (!res.ok) throw new MantaSDKError(data.type ?? 'ERROR', data.message ?? res.statusText, res.status)

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`manta:token:${this._context}`, data.token)
      if (data.refreshToken) localStorage.setItem(`manta:refresh:${this._context}`, data.refreshToken)
    }
    return data
  }

  /** Logout and clear token. */
  async logout(): Promise<void> {
    try {
      await fetch(`${this.basePath}/logout`, { method: 'DELETE', headers: this._headers() })
    } finally {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(`manta:token:${this._context}`)
        localStorage.removeItem(`manta:refresh:${this._context}`)
      }
    }
  }

  /** Get current user. */
  async me<T = unknown>(): Promise<T> {
    return this.query<T>('me')
  }
}

/** Entity name — autocompletes from codegen when @manta/core types are loaded. */
declare global {
  interface MantaGeneratedEntities {}
}
type EntityNameArg = keyof MantaGeneratedEntities extends never ? string : keyof MantaGeneratedEntities | (string & {})

/** Graph query input shape. */
export interface GraphQueryInput {
  entity: EntityNameArg
  filters?: Record<string, unknown>
  pagination?: { limit?: number; offset?: number }
  sort?: { field?: string; order?: 'asc' | 'desc' }
  relations?: string[]
  fields?: string[]
  /** Full-text search query — searches across all searchable fields of the entity. */
  q?: string
}

/** SDK error with type and status. */
export class MantaSDKError extends Error {
  type: string
  status: number
  constructor(type: string, message: string, status: number) {
    super(message)
    this.name = 'MantaSDKError'
    this.type = type
    this.status = status
  }
}
