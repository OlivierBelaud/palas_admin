// SPEC-010, SPEC-053, SPEC-055 — Config types

/**
 * Environment profile: dev (development/test) or prod (production/staging).
 */
export type EnvProfile = 'dev' | 'prod'

/**
 * Project-level configuration (database URLs, secrets, etc.).
 */
export interface ProjectConfig {
  databaseUrl?: string
  redisUrl?: string
  jwtSecret?: string
  cookieSecret?: string
  [key: string]: unknown
}

/**
 * Rate limit configuration for HTTP layer.
 */
export interface RateLimitConfig {
  enabled: boolean
  windowMs?: number
  maxRequests?: number
  keyFn?: (req: unknown) => string
}

/**
 * Session cookie configuration.
 */
export interface SessionCookieConfig {
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'lax' | 'strict' | 'none'
  domain?: string
  path?: string
}

/**
 * Auth session configuration.
 */
export interface AuthSessionConfig {
  cookieName?: string
  cookie?: SessionCookieConfig
}

/**
 * Auth configuration.
 */
export interface AuthConfig {
  session?: AuthSessionConfig
}

/**
 * HTTP configuration.
 */
export interface HttpConfig {
  rateLimit?: RateLimitConfig
}

/**
 * Query configuration.
 */
export interface QueryConfig {
  maxTotalEntities?: number
}

/**
 * Boot configuration.
 */
export interface BootConfig {
  lazyBootRetryCooldownMs?: number
  lazyBootTimeoutMs?: number
}

/**
 * Module configuration entry.
 */
export interface ModuleConfigEntry {
  resolve?: string
  options?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Top-level Manta application configuration.
 */
export interface MantaConfig {
  projectConfig: ProjectConfig
  admin: Record<string, unknown>
  modules: Record<string, ModuleConfigEntry | boolean | string>
  plugins: Array<string | { resolve: string; options?: Record<string, unknown> }>
  featureFlags: Record<string, boolean>
  strict: boolean
  query?: QueryConfig
  http?: HttpConfig
  auth?: AuthConfig
  boot?: BootConfig
}
