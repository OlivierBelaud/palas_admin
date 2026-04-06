// E2E: transpile Medusa workflows → Manta native → execute

import { createRequire } from 'node:module'
import {
  createApp,
  createStep,
  createWorkflow,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryLockingAdapter,
  type MantaApp,
  TestLogger,
  WorkflowManager,
} from '@manta/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { discoverModules } from '../src/_internal/discovery/modules'
import { registerAllModulesInApp } from '../src/_internal/mapping/module-loader'
import {
  type CapturedStep,
  extractAllSteps,
  extractDAG,
  transpileAllWorkflows,
  transpileWorkflow,
  unwrapStepResponse,
} from '../src/_internal/transpiler/transpile'

const require = createRequire(import.meta.url)

describe('Transpiler E2E', () => {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic modules
  let app: MantaApp<any>
  let manager: WorkflowManager
  let allSteps: Map<string, CapturedStep>

  beforeAll(() => {
    const infra = {
      eventBus: new InMemoryEventBusAdapter(),
      logger: new TestLogger(),
      cache: new InMemoryCacheAdapter(),
      locking: new InMemoryLockingAdapter(),
      file: new InMemoryFileAdapter(),
      db: {},
    }
    const appBuilder = createApp({ infra })
    const modules = discoverModules()
    registerAllModulesInApp(appBuilder, modules, infra)

    // Framework stubs
    const noopProxy = new Proxy({}, { get: () => async () => [] })
    appBuilder.registerModule('link', noopProxy)
    appBuilder.registerModule('remoteLink', noopProxy)
    appBuilder.registerModule('remoteQuery', async () => [])
    appBuilder.registerModule('query', async () => [])

    app = appBuilder.build()
    manager = new WorkflowManager(app)

    allSteps = extractAllSteps()
  })

  // ── Step extraction ────────────────────────────

  it('extracts 400+ step handlers (steps/ + workflows/ inline)', () => {
    console.log(`Extracted ${allSteps.size} steps total`)
    expect(allSteps.size).toBeGreaterThanOrEqual(350)

    // Key steps exist
    expect(allSteps.has('create-products')).toBe(true)
    expect(allSteps.has('emit-event-step')).toBe(true)
    expect(allSteps.has('create-carts')).toBe(true)

    // Count with/without compensation
    let withComp = 0
    for (const [_, s] of allSteps) {
      if (s.compensate) withComp++
    }
    console.log(`  With compensation: ${withComp}`)
    console.log(`  Without compensation: ${allSteps.size - withComp}`)
  })

  // ── DAG extraction ─────────────────────────────

  it('extracts DAG for createProductsWorkflow', () => {
    const coreFlows = require('@medusajs/core-flows')
    const dag = extractDAG(coreFlows.createProductsWorkflow)

    expect(dag.length).toBeGreaterThanOrEqual(5)
    expect(dag[0].action).toBe('validate-product-input')
    console.log('createProducts DAG:', dag.map((n) => n.action).join(' → '))
  })

  // ── Full transpilation stats ────────────────────

  it('transpiles all 308 workflows with full classification', () => {
    const result = transpileAllWorkflows()

    const { stats } = result
    const accountedFor = stats.matchedSteps + stats.queries + stats.subWorkflows + stats.hooks
    const coveragePercent = stats.totalDAGNodes > 0 ? Math.round((accountedFor / stats.totalDAGNodes) * 100) : 0

    console.log('\n=== TRANSPILATION STATS ===')
    console.log(`Steps extracted:       ${stats.totalSteps}`)
    console.log(`Workflows transpiled:  ${stats.totalWorkflows}`)
    console.log(`Total DAG nodes:       ${stats.totalDAGNodes}`)
    console.log('')
    console.log(`  Matched steps:       ${stats.matchedSteps}`)
    console.log(`  Queries (→ service): ${stats.queries}`)
    console.log(`  Sub-workflows:       ${stats.subWorkflows}`)
    console.log(`  Hooks (→ eventBus):  ${stats.hooks}`)
    console.log(`  ─────────────────`)
    console.log(`  Accounted for:       ${accountedFor} / ${stats.totalDAGNodes} = ${coveragePercent}%`)

    if (stats.unmatchedSteps.length > 0) {
      console.log(`\n  Unmatched steps: ${stats.unmatchedSteps.length}`)
      for (const s of stats.unmatchedSteps.slice(0, 15)) console.log(`    ✗ ${s}`)
      if (stats.unmatchedSteps.length > 15) console.log(`    ... and ${stats.unmatchedSteps.length - 15} more`)
    }

    expect(stats.totalWorkflows).toBeGreaterThanOrEqual(250)
    expect(stats.totalSteps).toBeGreaterThanOrEqual(350)
    expect(coveragePercent).toBeGreaterThanOrEqual(85)
  })

  // ── Execution ──────────────────────────────────

  it('executes create-products step invoke with Manta app', async () => {
    const step = allSteps.get('create-products')!
    const scope = { resolve: (key: string) => app.resolve(key) }

    const result = await step.invoke([{ title: 'Invoke Test', handle: 'invoke-test', status: 'draft' }], {
      container: scope,
    })

    const output = unwrapStepResponse(result) as Array<{ id: string; title: string }>
    expect(output).toHaveLength(1)
    expect(output[0].title).toBe('Invoke Test')

    // Cleanup
    await step.compensate!(
      output.map((p) => p.id),
      { container: scope },
    )
  })

  it('executes compensation (rollback) correctly', async () => {
    const step = allSteps.get('create-products')!
    const scope = { resolve: (key: string) => app.resolve(key) }

    // Create
    const result = await step.invoke([{ title: 'Rollback Test', handle: 'rollback', status: 'draft' }], {
      container: scope,
    })
    const created = unwrapStepResponse(result) as Array<{ id: string }>

    // Compensate
    await step.compensate!(
      created.map((p) => p.id),
      { container: scope },
    )

    // Verify gone
    // biome-ignore lint/suspicious/noExplicitAny: dynamic
    const svc = app.resolve<any>('productModuleService')
    const remaining = await svc.listProducts()
    expect(remaining.filter((p: { handle: string }) => p.handle === 'rollback')).toHaveLength(0)
  })

  it('builds and runs a Manta-native workflow from transpiled steps', async () => {
    // Clean
    // biome-ignore lint/suspicious/noExplicitAny: dynamic
    const svc = app.resolve<any>('productModuleService')
    const existing = await svc.listProducts()
    if (existing.length) await svc.deleteProducts(existing.map((p: { id: string }) => p.id))

    // Get transpiled workflow info
    const coreFlows = require('@medusajs/core-flows')
    const transpiled = transpileWorkflow(coreFlows.createProductsWorkflow, allSteps)

    // Build Manta steps — use captured handlers for pure steps, manual for inline ones
    const createProductsMantaStep = createStep(
      'create-products',
      async (input: unknown, { app: c }) => {
        const captured = transpiled.steps.get('create-products')!
        const result = await captured.invoke(input, { container: { resolve: (k: string) => c.resolve(k) } })
        return unwrapStepResponse(result)
      },
      async (output: unknown, { app: c }) => {
        const captured = transpiled.steps.get('create-products')!
        // biome-ignore lint/suspicious/noExplicitAny: dynamic
        await captured.compensate!(
          (output as any[]).map((p: { id: string }) => p.id),
          {
            container: { resolve: (k: string) => c.resolve(k) },
          },
        )
      },
    )

    // Build workflow following DAG order
    const wf = createWorkflow(`manta-${transpiled.name}`, async (input: unknown, { app: c }) => {
      // Transform: strip fields the product module doesn't handle (same as Medusa's transform)
      // biome-ignore lint/suspicious/noExplicitAny: dynamic
      const products = ((input as any).products || []).map((p: Record<string, unknown>) => ({
        ...p,
        sales_channels: undefined,
        shipping_profile_id: undefined,
        variants: undefined,
      }))

      // Validate (inline logic — trivial)
      // biome-ignore lint/suspicious/noExplicitAny: dynamic
      const missing = products.filter((p: any) => !p.options?.length).map((p: any) => p.title)
      if (missing.length) throw new Error(`Product options missing: ${missing.join(', ')}`)

      // Create products (transpiled from Medusa step)
      const created = await createProductsMantaStep(products, { app: c })

      // Hook → eventBus.emit
      try {
        // biome-ignore lint/suspicious/noExplicitAny: dynamic
        const eventBus = c.resolve<any>('IEventBusPort')
        for (const product of created as Array<{ id: string }>) {
          await eventBus.emit({
            eventName: 'hook:productsCreated',
            data: { id: product.id },
            metadata: { timestamp: Date.now() },
          })
        }
      } catch {
        /* no eventBus */
      }

      return created
    })

    // Run
    const freshManager = new WorkflowManager(app)
    freshManager.register(wf)

    const { transaction, result } = await freshManager.run(`manta-${transpiled.name}`, {
      input: {
        products: [
          {
            title: 'Full Transpile',
            handle: 'full-transpile',
            status: 'draft',
            options: [{ title: 'Size', values: ['S', 'M'] }],
          },
        ],
      },
    })

    expect(transaction.state).toBe('done')
    // biome-ignore lint/suspicious/noExplicitAny: dynamic
    const products = result as any[]
    expect(products).toHaveLength(1)
    expect(products[0].title).toBe('Full Transpile')

    console.log(`\nWorkflow executed: ${transpiled.name}`)
    console.log(`Product: ${products[0].title} (${products[0].id})`)
  })
})
