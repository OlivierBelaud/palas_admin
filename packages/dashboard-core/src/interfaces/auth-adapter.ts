/**
 * AuthAdapter — how the dashboard authenticates users.
 * Each distribution implements this differently:
 * - Medusa: session cookies via @medusajs/js-sdk
 * - Manta: JWT Bearer tokens in localStorage
 */

export interface AdminUser {
  id: string
  email: string
  first_name?: string
  last_name?: string
  avatar_url?: string
  role?: string
  metadata?: Record<string, unknown>
}

export interface AuthAdapter {
  /** Sign in with email/password */
  login(credentials: { email: string; password: string }): Promise<void>
  /** Sign out */
  logout(): Promise<void>
  /** Get current authenticated user */
  getCurrentUser(): Promise<AdminUser>
  /** Check if the user is authenticated */
  isAuthenticated(): boolean
  /** Get auth headers (for fetch calls) */
  getAuthHeaders(): Record<string, string>
  /** Optional: reset password */
  resetPassword?(email: string): Promise<void>
}
