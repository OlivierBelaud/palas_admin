import type { AuthAdapter, AdminUser } from "@manta/dashboard-core"

const TOKEN_KEY = "manta-auth-token"

/**
 * MantaAuthAdapter — JWT-based authentication.
 * Stores token in localStorage.
 */
export class MantaAuthAdapter implements AuthAdapter {
  private baseUrl: string

  constructor({ baseUrl }: { baseUrl: string }) {
    this.baseUrl = baseUrl
  }

  async login(credentials: { email: string; password: string }): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/auth/user/emailpass`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      const err = new Error(data.message || "Login failed") as Error & { status: number }
      err.status = res.status
      throw err
    }
    const data = await res.json()
    localStorage.setItem(TOKEN_KEY, data.token)
  }

  async logout(): Promise<void> {
    const token = localStorage.getItem(TOKEN_KEY)
    if (token) {
      await fetch(`${this.baseUrl}/api/auth/logout`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
      }).catch(() => {})
    }
    localStorage.removeItem(TOKEN_KEY)
  }

  async getCurrentUser(): Promise<AdminUser> {
    // TODO: Remove this bypass when auth endpoints are implemented
    // Temporarily return a fake user to skip login
    return {
      id: "usr_dev",
      email: "dev@manta.local",
      first_name: "Dev",
      last_name: "User",
    }
  }

  isAuthenticated(): boolean {
    return !!localStorage.getItem(TOKEN_KEY)
  }

  getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) return {}
    return { "Authorization": `Bearer ${token}` }
  }

  async resetPassword(email: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/auth/user/emailpass/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: email }),
    })
  }
}
