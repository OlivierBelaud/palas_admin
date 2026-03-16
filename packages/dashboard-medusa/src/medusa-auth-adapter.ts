import type { AuthAdapter, AdminUser } from "@manta/dashboard-core"
import Medusa from "@medusajs/js-sdk"

export class MedusaAuthAdapter implements AuthAdapter {
  private sdk: InstanceType<typeof Medusa>

  constructor({ baseUrl }: { baseUrl?: string } = {}) {
    this.sdk = new (Medusa as any)({
      baseUrl: baseUrl || "/",
      auth: { type: "session" },
    }) as InstanceType<typeof Medusa>
  }

  async login(credentials: { email: string; password: string }): Promise<void> {
    await this.sdk.auth.login("user", "emailpass", credentials)
  }

  async logout(): Promise<void> {
    await this.sdk.auth.logout()
  }

  async getCurrentUser(): Promise<AdminUser> {
    const data = await this.sdk.admin.user.me() as any
    return data?.user || data
  }

  isAuthenticated(): boolean {
    // Session-based — check is done by getCurrentUser
    return true
  }

  getAuthHeaders(): Record<string, string> {
    // Session-based — cookies are sent automatically
    return {}
  }

  async resetPassword(email: string): Promise<void> {
    await this.sdk.auth.resetPassword("user", "emailpass", { identifier: email })
  }
}
