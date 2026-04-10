// Phase 2 — Lazy boot steps 9-18 unit tests
// Tests that each step calls the right methods and handles fatal/warning correctly

import { ContainerRegistrationKeys, type InMemoryEventBusAdapter, type TestMantaApp } from '@manta/core'
import { describe, expect, it, vi } from 'vitest'
import { boot, lazyBoot } from '../../../src/bootstrap/boot'
import type { DiscoveredResources } from '../../../src/resource-loader'
import type { BootContext } from '../../../src/types'

function makeContext(overrides: Partial<BootContext> = {}): BootContext {
  return {
    config: {
      database: { url: 'postgresql://localhost:5432/test' },
      featureFlags: {},
    },
    profile: 'dev',
    cwd: '/tmp/fake-project',
    ...overrides,
  }
}

function emptyResources(): DiscoveredResources {
  return {
    modules: [],
    subscribers: [],
    workflows: [],
    jobs: [],
    links: [],
    commands: [],
    queries: [],
    users: [],
    contexts: [],
    agents: [],
    middlewares: null,
    contextMiddlewares: [],
    spas: [],
  }
}

async function bootWithContainer(overrides: Partial<BootContext> = {}): Promise<BootContext> {
  const ctx = makeContext(overrides)
  await boot(ctx)
  return ctx
}

describe('Lazy boot steps 9-18', () => {
  // -------------------------------------------------------------------
  // LB-01 — Step 9: loads modules from discovered resources
  // -------------------------------------------------------------------
  it('LB-01 — step 9 registers discovered modules in app', async () => {
    const ctx = await bootWithContainer()
    ctx.discoveredResources = emptyResources()
    ctx.discoveredResources.modules = [
      {
        name: 'product',
        dirName: 'product',
        moduleDir: '/fake/src/modules/product',
        path: '/fake/src/modules/product/entities/product/model.ts',
        entities: [
          { name: 'product', modelPath: '/fake/src/modules/product/entities/product/model.ts', servicePath: undefined },
        ],
        commands: [],
        queries: [],
        apiRoutes: [],
        intraLinks: [],
        models: ['product'],
        service: 'ProductService',
      },
    ]
    // Mock the module loading by providing a loadedModules map
    ctx.loadedModules = new Map()
    ctx.loadedModules.set('product', {
      name: 'product',
      service: class MockProductService {},
    })

    const result = await lazyBoot(ctx)
    expect(result.success).toBe(true)
    expect(result.stepsCompleted).toBe(18)
  })

  // -------------------------------------------------------------------
  // LB-02 — Step 9 FATAL: if module loading fails (bad import), rejects
  // -------------------------------------------------------------------
  it('LB-02 — step 9 is fatal when module import fails', async () => {
    const ctx = await bootWithContainer()
    ctx.discoveredResources = emptyResources()
    ctx.discoveredResources.modules = [
      {
        name: 'broken-module',
        dirName: 'broken-module',
        moduleDir: '/nonexistent/path',
        path: '/nonexistent/path/that/does/not/exist.ts',
        entities: [{ name: 'broken', modelPath: '/nonexistent/path/that/does/not/exist.ts', servicePath: undefined }],
        commands: [],
        queries: [],
        apiRoutes: [],
        intraLinks: [],
        models: [],
        service: 'BrokenService',
      },
    ]
    // No loadedModules = dynamic import will be attempted and fail

    const result = await lazyBoot(ctx)
    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]!.step).toBe(9)
    expect(result.errors[0]!.fatal).toBe(true)
  })

  // -------------------------------------------------------------------
  // LB-03 — Step 10: QUERY/LINK registration (no-op when empty)
  // -------------------------------------------------------------------
  it('LB-03 — step 10 succeeds with empty modules', async () => {
    const ctx = await bootWithContainer()
    ctx.discoveredResources = emptyResources()
    ctx.loadedModules = new Map()

    const result = await lazyBoot(ctx)
    expect(result.success).toBe(true)
  })

  // -------------------------------------------------------------------
  // LB-04 — Step 11: links are best-effort (warning on failure)
  // -------------------------------------------------------------------
  it('LB-04 — step 11 failure is warning, not fatal', async () => {
    const ctx = await bootWithContainer()
    ctx.discoveredResources = emptyResources()
    ctx.discoveredResources.links = [{ id: 'bad-link', path: '/nonexistent/link.ts', modules: [] }]
    ctx.loadedModules = new Map()

    const result = await lazyBoot(ctx)
    expect(result.success).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.some((w) => w.includes('11'))).toBe(true)
  })

  // -------------------------------------------------------------------
  // LB-05 — Step 12: workflows are best-effort
  // -------------------------------------------------------------------
  it('LB-05 — step 12 failure is warning, not fatal', async () => {
    const ctx = await bootWithContainer()
    ctx.discoveredResources = emptyResources()
    ctx.discoveredResources.workflows = [{ id: 'bad-workflow', path: '/nonexistent/workflow.ts' }]
    ctx.loadedModules = new Map()

    const result = await lazyBoot(ctx)
    expect(result.success).toBe(true)
    expect(result.warnings.some((w) => w.includes('12'))).toBe(true)
  })

  // -------------------------------------------------------------------
  // LB-06 — Step 13: subscribers are best-effort
  // -------------------------------------------------------------------
  it('LB-06 — step 13 failure is warning, not fatal', async () => {
    const ctx = await bootWithContainer()
    ctx.discoveredResources = emptyResources()
    ctx.discoveredResources.subscribers = [{ id: 'bad-sub', path: '/nonexistent/sub.ts', events: [] }]
    ctx.loadedModules = new Map()

    const result = await lazyBoot(ctx)
    expect(result.success).toBe(true)
    expect(result.warnings.some((w) => w.includes('13'))).toBe(true)
  })

  // -------------------------------------------------------------------
  // LB-07 — Step 15: jobs are best-effort
  // -------------------------------------------------------------------
  it('LB-07 — step 15 failure is warning, not fatal', async () => {
    const ctx = await bootWithContainer()
    ctx.discoveredResources = emptyResources()
    ctx.discoveredResources.jobs = [{ id: 'bad-job', path: '/nonexistent/job.ts' }]
    ctx.loadedModules = new Map()

    const result = await lazyBoot(ctx)
    expect(result.success).toBe(true)
    expect(result.warnings.some((w) => w.includes('15'))).toBe(true)
  })

  // -------------------------------------------------------------------
  // LB-08 — Step 16: onApplicationStart is best-effort
  // -------------------------------------------------------------------
  it('LB-08 — step 16 calls onApplicationStart on loaded modules', async () => {
    const ctx = await bootWithContainer()
    ctx.discoveredResources = emptyResources()

    const startCalled = vi.fn()
    ctx.loadedModules = new Map()
    ctx.loadedModules.set('test', {
      name: 'test',
      service: class {},
      hooks: { onApplicationStart: startCalled },
    })

    const result = await lazyBoot(ctx)
    expect(result.success).toBe(true)
    expect(startCalled).toHaveBeenCalledOnce()
  })

  // -------------------------------------------------------------------
  // LB-09 — Step 16: onApplicationStart failure is warning
  // -------------------------------------------------------------------
  it('LB-09 — step 16 failure is warning, not fatal', async () => {
    const ctx = await bootWithContainer()
    ctx.discoveredResources = emptyResources()
    ctx.loadedModules = new Map()
    ctx.loadedModules.set('bad', {
      name: 'bad',
      service: class {},
      hooks: {
        onApplicationStart: () => {
          throw new Error('module startup failed')
        },
      },
    })

    const result = await lazyBoot(ctx)
    expect(result.success).toBe(true)
    expect(result.warnings.some((w) => w.includes('16'))).toBe(true)
  })

  // -------------------------------------------------------------------
  // LB-10 — Step 18: releases event buffer
  // -------------------------------------------------------------------
  it('LB-10 — step 18 releases the event buffer group', async () => {
    const ctx = await bootWithContainer()
    ctx.discoveredResources = emptyResources()
    ctx.loadedModules = new Map()

    // Emit an event during boot (simulating grouped events)
    const eventBus = ctx.app!.resolve<InMemoryEventBusAdapter>(ContainerRegistrationKeys.EVENT_BUS)
    const bootGroupId = `boot-${ctx.app!.id}`
    await eventBus.emit(
      { eventName: 'test.event', data: {}, metadata: { timestamp: Date.now() } },
      { groupId: bootGroupId },
    )

    // Set the boot group ID for step 18
    ctx.bootEventGroupId = bootGroupId

    const result = await lazyBoot(ctx)
    expect(result.success).toBe(true)
    // Group should be released (null status = no longer exists)
    expect(eventBus.getGroupStatus?.(bootGroupId)).toBeNull()
  })

  // -------------------------------------------------------------------
  // LB-11 — With no discovered resources, lazy boot completes cleanly
  // -------------------------------------------------------------------
  it('LB-11 — no discovered resources = lazy boot completes cleanly', async () => {
    const ctx = await bootWithContainer()
    ctx.discoveredResources = emptyResources()
    ctx.loadedModules = new Map()

    const result = await lazyBoot(ctx)
    expect(result.success).toBe(true)
    expect(result.stepsCompleted).toBe(18)
    expect(result.errors).toHaveLength(0)
  })

  // -------------------------------------------------------------------
  // LB-12 — Step 18 is fatal (if it fails, boot fails)
  // -------------------------------------------------------------------
  it('LB-12 — step 18 failure is fatal', async () => {
    const ctx = await bootWithContainer()
    ctx.discoveredResources = emptyResources()
    ctx.loadedModules = new Map()

    // Register a broken event bus that throws on releaseGroupedEvents
    const brokenEventBus = {
      emit: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      releaseGroupedEvents: vi.fn().mockRejectedValue(new Error('release failed')),
      clearGroupedEvents: vi.fn(),
      addInterceptor: vi.fn(),
      removeInterceptor: vi.fn(),
    }
    ;(ctx.app as TestMantaApp).register(ContainerRegistrationKeys.EVENT_BUS, brokenEventBus)
    ctx.bootEventGroupId = 'boot-broken'

    const result = await lazyBoot(ctx)
    expect(result.success).toBe(false)
    expect(result.errors.some((e) => e.step === 18 && e.fatal)).toBe(true)
  })
})
