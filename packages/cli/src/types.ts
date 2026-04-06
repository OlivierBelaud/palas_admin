// CLI types — options for each command

export interface DevOptions {
  port?: number
  noMigrate?: boolean
  verbose?: boolean
}

export interface StartOptions {
  port?: number
}

export interface BuildOptions {
  preset?: string
}

export type InitPreset = 'nitro' | 'next'

export interface InitOptions {
  dir?: string
  preset?: InitPreset
}

export interface ExecOptions {
  script: string
  dryRun?: boolean
  args?: string[]
}

export interface GenerateOptions {
  name?: string
}

export interface MigrateOptions {
  force?: boolean
  dryRun?: boolean
  json?: boolean
  allOrNothing?: boolean
  forceUnlock?: boolean
}

export interface RollbackOptions {
  steps?: number
}

export interface DiffOptions {
  json?: boolean
}

export interface LoadedConfig {
  database?: {
    url?: string
    pool?: { min?: number; max?: number }
  }
  http?: {
    port?: number
    cors?: Record<string, unknown>
    rateLimit?: {
      enabled?: boolean
      windowMs?: number
      maxRequests?: number
    }
  }
  auth?: {
    jwtSecret?: string
    session?: {
      enabled?: boolean
      cookieName?: string
      ttl?: number
      cookie?: Record<string, unknown>
    }
  }
  modules?: unknown[]
  plugins?: Array<string | { resolve: string; options?: Record<string, unknown> }>
  featureFlags?: Record<string, boolean>
  query?: { maxTotalEntities?: number }
  strict?: boolean
  boot?: {
    lazyBootTimeoutMs?: number
    autoMigrate?: boolean
  }
  events?: { maxPayloadSize?: number }
  appEnv?: string
  adapters?: Record<string, { adapter: string; options?: Record<string, unknown> }>
  /** Preset name ('dev', 'vercel') or inline PresetDefinition */
  preset?: string | import('@manta/core').PresetDefinition
  /** SPA declarations — each key is a context name (e.g. 'admin', 'vendor') */
  spa?: Record<string, { dashboard?: string; preset?: string }>
}

export interface BootContext {
  config: LoadedConfig
  profile: 'dev' | 'prod'
  verbose?: boolean
  /** App object — created at step 3, used by all subsequent steps */
  app?: import('@manta/core').MantaApp
  /** Resolved adapters to register — injected by the CLI before boot */
  adapters?: Record<string, unknown>
  /** Working directory (defaults to process.cwd()) */
  cwd?: string
  /** Discovered resources from ResourceLoader (populated before lazy boot) */
  discoveredResources?: import('./resource-loader').DiscoveredResources
  /** Loaded modules — maps module name to ModuleExports (populated at step 9) */
  loadedModules?: Map<string, import('@manta/core').ModuleExports>
  /** Event group ID for boot event buffer (set at step 7, released at step 18) */
  bootEventGroupId?: string
}

export interface ManifestRouteEntry {
  path: string
  methods: string[]
  file: string
  namespace: string
  middlewares: unknown[]
}

export interface ManifestSubscriberEntry {
  id: string
  file: string
  events: string[]
}

export interface ManifestWorkflowEntry {
  id: string
  file: string
  steps: string[]
}

export interface ManifestJobEntry {
  id: string
  file: string
  schedule: string
}

export interface ManifestLinkEntry {
  id: string
  file: string
  modules: string[]
  table: string
}

export interface ManifestModuleEntry {
  name: string
  file: string
  models: string[]
  service: string
}
