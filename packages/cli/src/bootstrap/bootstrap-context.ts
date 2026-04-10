// bootstrap-context.ts — Shared context object threaded through all bootstrap phases.
// Uses `any` liberally — structural split first, precise typing later.

import type { MantaApp } from '@manta/core'

export type AppRef = { current: MantaApp | null }

// biome-ignore lint/suspicious/noExplicitAny: structural split — precise typing deferred
export interface BootstrapContext {
  // Inputs
  readonly cwd: string
  readonly mode: 'dev' | 'prod'
  readonly verbose: boolean
  readonly doImport: (path: string) => Promise<Record<string, unknown>>
  readonly config: any
  readonly options: any

  // Phase 1: Infra
  logger: any
  db: any
  infraMap: Map<string, unknown>
  repoFactory: any
  builder: any
  generatePgTableFromDml: any
  generateLinkPgTable: any

  // Phase 2: Discovery
  resources: any
  resolvedPlugins: any[]

  // Phase 3: Assembly (all the registries)
  generatedTables: Map<string, unknown>
  entityRegistry: Map<string, unknown>
  loadedLinks: any[]
  entityCommandRegistry: Map<string, unknown>
  explicitCommandNames: Set<string>
  commandGraphDefs: Map<string, unknown>
  queryRegistry: any
  queryExtensions: any[]
  userDefinitions: any[]
  moduleScopedCommandNames: string[]
  cmdRegistry: any
  agentRegistry: Map<string, any>

  // Phase 5: Wiring
  adapter: any
  authService: any
  jwtSecret: string
  contextRegistry: any
}
