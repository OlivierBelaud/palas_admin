import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DrizzleRepositoryFactory, generatePgTableFromDml } from '@mantajs/adapter-database-pg'
// biome-ignore lint/style/noRestrictedImports: exercise the installed bootstrap and real application models
import { createApp, defineModel, defineService, field } from '@mantajs/core'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { createJiti } from 'jiti'
import { afterEach, describe, expect, it, vi } from 'vitest'

const cliRoot = dirname(createRequire(import.meta.url).resolve('@mantajs/cli/package.json'))
const { discoverResources } = await import(pathToFileURL(join(cliRoot, 'dist/resource-loader.js')).href)
const { loadModules } = await import(
  pathToFileURL(join(cliRoot, 'dist/bootstrap/phases/assemble/load-modules.js')).href
)

afterEach(() => vi.unstubAllGlobals())

describe('visitor session service registration', () => {
  it('keeps event session lookups on visitor_sessions with both identity filters', async () => {
    vi.stubGlobal('defineModel', defineModel)
    vi.stubGlobal('defineService', defineService)
    vi.stubGlobal('field', field)
    const cwd = resolve(import.meta.dirname, '..')
    const jiti = createJiti(join(cwd, 'package.json'))
    const discovered = await discoverResources(cwd)
    const modules = discovered.modules.filter((module: { dirName: string }) =>
      ['visitor-session', 'visitor-lifecycle-cache'].includes(module.dirName),
    )
    const queries: Array<{ sql: string; params: unknown[] }> = []
    const client = drizzle(async (sql, params) => {
      queries.push({ sql, params })
      return { rows: [] }
    })
    const db = { getClient: () => client }
    const builder = createApp({ infra: {} as never })
    await loadModules(
      {
        logger: { info() {}, warn() {}, error() {} },
        db,
        infraMap: new Map(),
        repoFactory: new DrizzleRepositoryFactory({ db: db as never }),
        builder,
        resources: { modules },
        doImport: (path: string) => jiti.import(path),
        generatePgTableFromDml,
        drizzleSchema: {},
      },
      {},
    )
    const services = builder.build().modules as unknown as Record<
      string,
      { __entity: { name: string }; list: (filters: Record<string, unknown>) => Promise<unknown[]> }
    >
    await services.visitorSession.list({ distinct_id: 'visitor-probe', session_id: 'session-probe' })
    expect(queries).toHaveLength(1)
    expect(queries[0].sql).toContain('from "visitor_sessions"')
    expect(queries[0].sql).toContain('"visitor_sessions"."distinct_id" = $1')
    expect(queries[0].sql).toContain('"visitor_sessions"."session_id" = $2')
    expect(queries[0].params).toEqual(['visitor-probe', 'session-probe'])
    expect(services.visitorSession.__entity.name).toBe('VisitorSession')
    expect(services.visitorLifecycleActorDailyFact.__entity.name).toBe('VisitorLifecycleActorDailyFact')
    expect(services.visitorLifecycleDaySnapshot.__entity.name).toBe('VisitorLifecycleDaySnapshot')
  })
})
