// SPEC-010, SPEC-053, SPEC-055 — Config types

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Zod schemas for runtime validation of LoadedConfig
// ---------------------------------------------------------------------------

export const DatabaseConfigSchema = z
  .object({
    url: z.string().optional(),
    pool: z
      .object({
        min: z.number().int().min(1).default(1),
        max: z.number().int().min(1).default(10),
      })
      .refine((d) => d.max >= d.min, { message: 'pool.max must be >= pool.min' })
      .optional(),
  })
  .optional()

export const RateLimitConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    windowMs: z.number().int().positive().optional(),
    maxRequests: z.number().int().positive().optional(),
  })
  .optional()

export const HttpConfigSchema = z
  .object({
    port: z.number().int().min(1).max(65535).optional(),
    cors: z.record(z.unknown()).optional(),
    rateLimit: RateLimitConfigSchema,
  })
  .optional()

export const SessionCookieConfigSchema = z
  .object({
    httpOnly: z.boolean().default(true),
    secure: z.boolean().default(true),
    sameSite: z.enum(['lax', 'strict', 'none']).default('lax'),
    domain: z.string().optional(),
    path: z.string().default('/'),
  })
  .optional()

export const AuthSessionConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    cookieName: z
      .string()
      .regex(/^[a-zA-Z0-9_.-]+$/, 'cookieName must only contain alphanumeric, underscore, dot, or dash')
      .default('manta.sid'),
    ttl: z.number().int().positive().optional(),
    cookie: SessionCookieConfigSchema,
  })
  .optional()

export const AuthConfigSchema = z
  .object({
    jwtSecret: z.string().min(16, 'jwtSecret must be at least 16 characters').optional(),
    session: AuthSessionConfigSchema,
  })
  .optional()

export const QueryConfigSchema = z
  .object({
    maxTotalEntities: z.number().int().min(10).max(100000).default(10000),
  })
  .optional()

export const BootConfigSchema = z
  .object({
    lazyBootTimeoutMs: z.number().int().min(1000).default(30000),
    autoMigrate: z.boolean().default(false),
  })
  .optional()

export const EventsConfigSchema = z
  .object({
    maxPayloadSize: z.number().int().positive().optional(),
  })
  .optional()

export const SpaConfigSchema = z.object({
  dashboard: z.string().optional(),
  preset: z.string().optional(),
})

export const LoadedConfigSchema = z.object({
  database: DatabaseConfigSchema,
  http: HttpConfigSchema,
  auth: AuthConfigSchema,
  query: QueryConfigSchema,
  boot: BootConfigSchema,
  events: EventsConfigSchema,
  strict: z.boolean().default(false),
  featureFlags: z.record(z.boolean()).optional(),
  appEnv: z.string().optional(),
  modules: z.array(z.unknown()).optional(),
  plugins: z
    .array(
      z.union([
        z.string(),
        z.object({
          resolve: z.string(),
          options: z.record(z.unknown()).optional(),
        }),
      ]),
    )
    .optional(),
  adapters: z
    .record(
      z.object({
        adapter: z.string(),
        options: z.record(z.unknown()).optional(),
      }),
    )
    .optional(),
  preset: z.union([z.string(), z.record(z.unknown())]).optional(),
  spa: z.record(SpaConfigSchema).optional(),
})

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
  port?: number
  cors?: Record<string, unknown>
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
/**
 * Top-level Manta application configuration.
 */
/**
 * SPA override config (optional — SPAs are auto-detected from src/spa/{name}/).
 *
 * Defaults when src/spa/{name}/ exists:
 * - dashboard: '@manta/dashboard'
 * - preset: '@manta/ui'
 *
 * Set to null to disable a default.
 */
export interface SpaConfig {
  /** Dashboard shell. Default: '@manta/dashboard'. Set null to disable. */
  dashboard?: string | null
  /** UI preset. Default: '@manta/ui'. Set null to disable. */
  preset?: string | null
}

/** Default SPA settings — applied when no override exists. */
export const SPA_DEFAULTS = {
  dashboard: '@manta/dashboard',
  preset: '@manta/ui',
} as const

export interface MantaConfig {
  projectConfig: ProjectConfig
  database?: { url?: string; pool?: { min?: number; max?: number } }
  admin: Record<string, unknown>
  modules: Record<string, ModuleConfigEntry | boolean | string>
  plugins: Array<string | { resolve: string; options?: Record<string, unknown> }>
  featureFlags: Record<string, boolean>
  strict: boolean
  /** Preset name ('dev', 'vercel') or inline PresetDefinition */
  preset?: string | import('./presets').PresetDefinition
  /** Per-port adapter overrides (merged on top of preset) */
  adapters?: Record<string, { adapter: string; options?: Record<string, unknown> }>
  query?: QueryConfig
  http?: HttpConfig
  auth?: AuthConfig
  boot?: BootConfig
  /** SPA declarations — each key is a context name, pages auto-discovered from src/spa/{key}/ */
  spa?: Record<string, SpaConfig>
}
