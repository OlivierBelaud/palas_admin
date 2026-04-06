import type { AdminUser, AuthAdapter } from '@manta/dashboard-core'

const TOKEN_KEY = 'manta-auth-token'
const REFRESH_KEY = 'manta-refresh-token'

/**
 * MantaAuthAdapter — JWT-based authentication with automatic token refresh.
 *
 * - Access token (1h) stored in localStorage
 * - Refresh token (30d) stored in localStorage
 * - On 401, calls POST /api/{ctx}/refresh to get a new access token
 * - Thread-safe: concurrent 401s share a single refresh call
 */
export class MantaAuthAdapter implements AuthAdapter {
  private baseUrl: string
  private authPrefix: string
  /** In-flight refresh promise — prevents concurrent refresh calls */
  private _refreshPromise: Promise<boolean> | null = null

  constructor({ baseUrl, authPrefix = '/api/admin' }: { baseUrl: string; authPrefix?: string }) {
    this.baseUrl = baseUrl
    this.authPrefix = authPrefix
  }

  async login(credentials: { email: string; password: string }): Promise<void> {
    const res = await fetch(`${this.baseUrl}${this.authPrefix}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      const err = new Error(data.message || 'Login failed') as Error & { status: number }
      err.status = res.status
      throw err
    }
    const data = await res.json()
    localStorage.setItem(TOKEN_KEY, data.token)
    if (data.refreshToken) {
      localStorage.setItem(REFRESH_KEY, data.refreshToken)
    }
  }

  async logout(): Promise<void> {
    const token = localStorage.getItem(TOKEN_KEY)
    if (token) {
      await fetch(`${this.baseUrl}${this.authPrefix}/logout`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }).catch(() => {})
    }
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
  }

  async getCurrentUser(): Promise<AdminUser> {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) throw new Error('Not authenticated')

    let res = await fetch(`${this.baseUrl}${this.authPrefix}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    // Token expired — try refresh
    if (res.status === 401) {
      const refreshed = await this.refreshAccessToken()
      if (refreshed) {
        const newToken = localStorage.getItem(TOKEN_KEY)!
        res = await fetch(`${this.baseUrl}${this.authPrefix}/me`, {
          headers: { Authorization: `Bearer ${newToken}` },
        })
      }
    }

    if (!res.ok) {
      this._clearTokens()
      throw new Error('Not authenticated')
    }
    const { data } = await res.json()
    return {
      id: data.id,
      email: data.email ?? '',
      first_name: data.first_name ?? null,
      last_name: data.last_name ?? null,
    }
  }

  isAuthenticated(): boolean {
    return !!localStorage.getItem(TOKEN_KEY)
  }

  getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) return {}
    return { Authorization: `Bearer ${token}` }
  }

  /**
   * Refresh the access token using the stored refresh token.
   * Thread-safe: concurrent calls share a single in-flight request.
   * @returns true if refresh succeeded, false otherwise
   */
  async refreshAccessToken(): Promise<boolean> {
    // Deduplicate concurrent refresh calls
    if (this._refreshPromise) return this._refreshPromise

    this._refreshPromise = this._doRefresh()
    try {
      return await this._refreshPromise
    } finally {
      this._refreshPromise = null
    }
  }

  private async _doRefresh(): Promise<boolean> {
    const refreshToken = localStorage.getItem(REFRESH_KEY)
    if (!refreshToken) return false

    try {
      const res = await fetch(`${this.baseUrl}${this.authPrefix}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      if (!res.ok) {
        this._clearTokens()
        return false
      }
      const data = await res.json()
      if (data.token) {
        localStorage.setItem(TOKEN_KEY, data.token)
        return true
      }
      return false
    } catch {
      return false
    }
  }

  private _clearTokens(): void {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
  }

  async resetPassword(email: string): Promise<void> {
    await fetch(`${this.baseUrl}${this.authPrefix}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
  }
}
