// Phase 1 — ResourceLoader unit tests
// Verifies filesystem scanning to discover modules, subscribers, workflows, jobs, links, middlewares

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverResources } from '../../src/resource-loader'

let testDir: string

function createFile(relativePath: string, content: string): void {
  const fullPath = join(testDir, relativePath)
  const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(fullPath, content)
}

beforeEach(() => {
  testDir = join(tmpdir(), `manta-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('ResourceLoader — discoverResources()', () => {
  // RL-01 — Empty project returns empty arrays
  it('RL-01 — empty project returns empty DiscoveredResources', async () => {
    mkdirSync(join(testDir, 'src'), { recursive: true })
    const result = await discoverResources(testDir)

    expect(result.modules).toEqual([])
    expect(result.subscribers).toEqual([])
    expect(result.workflows).toEqual([])
    expect(result.jobs).toEqual([])
    expect(result.links).toEqual([])
    expect(result.middlewares).toBeNull()
  })

  // RL-02 — Discovers modules from src/modules/*/entities/*/model.ts
  it('RL-02 — discovers modules from src/modules/*/entities/*/model.ts', async () => {
    createFile(
      'src/modules/product/entities/product/model.ts',
      `
      export const Product = { name: 'Product' }
    `,
    )

    const result = await discoverResources(testDir)

    expect(result.modules).toHaveLength(1)
    expect(result.modules[0]!.name).toBe('product')
    expect(result.modules[0]!.path).toContain('modules/product/entities/product/model.ts')
    expect(result.modules[0]!.models).toContain('product')
  })

  // RL-03 — Discovers multiple modules
  it('RL-03 — discovers multiple modules', async () => {
    createFile('src/modules/product/entities/product/model.ts', `export const Product = {}`)
    createFile('src/modules/order/entities/order/model.ts', `export const Order = {}`)

    const result = await discoverResources(testDir)
    expect(result.modules).toHaveLength(2)
    const names = result.modules.map((m) => m.name).sort()
    expect(names).toEqual(['order', 'product'])
  })

  // RL-04 — Discovers subscribers from src/subscribers/*.ts
  it('RL-04 — discovers subscribers from src/subscribers/*.ts', async () => {
    createFile(
      'src/subscribers/on-product-created.ts',
      `
      export const event = 'product.created'
      export default async function handler() {}
    `,
    )

    const result = await discoverResources(testDir)
    expect(result.subscribers).toHaveLength(1)
    expect(result.subscribers[0]!.path).toContain('on-product-created.ts')
  })

  // RL-05 — Discovers workflows from src/workflows/*.ts
  it('RL-05 — discovers workflows from src/workflows/*.ts', async () => {
    createFile(
      'src/workflows/create-product.ts',
      `
      export const id = 'create-product-workflow'
    `,
    )

    const result = await discoverResources(testDir)
    expect(result.workflows).toHaveLength(1)
    expect(result.workflows[0]!.path).toContain('create-product.ts')
  })

  // RL-06 — Discovers jobs from src/jobs/*.ts
  it('RL-06 — discovers jobs from src/jobs/*.ts', async () => {
    createFile(
      'src/jobs/cleanup.ts',
      `
      export const id = 'cleanup-job'
      export const schedule = '0 * * * *'
    `,
    )

    const result = await discoverResources(testDir)
    expect(result.jobs).toHaveLength(1)
    expect(result.jobs[0]!.path).toContain('cleanup.ts')
  })

  // RL-07 — Discovers links from src/links/*.ts
  it('RL-07 — discovers links from src/links/*.ts', async () => {
    createFile(
      'src/links/product-order.ts',
      `
      export const id = 'product-order-link'
    `,
    )

    const result = await discoverResources(testDir)
    expect(result.links).toHaveLength(1)
    expect(result.links[0]!.path).toContain('product-order.ts')
  })

  // RL-08 — Discovers middlewares.ts if present
  it('RL-08 — discovers src/middlewares.ts if present', async () => {
    createFile(
      'src/middlewares.ts',
      `
      export function defineMiddlewares() { return [] }
    `,
    )

    const result = await discoverResources(testDir)
    expect(result.middlewares).not.toBeNull()
    expect(result.middlewares!.path).toContain('middlewares.ts')
  })

  // RL-09 — middlewares is null if file absent
  it('RL-09 — middlewares is null if file does not exist', async () => {
    mkdirSync(join(testDir, 'src'), { recursive: true })
    const result = await discoverResources(testDir)
    expect(result.middlewares).toBeNull()
  })

  // RL-10 — Missing src/ directory returns empty results without error
  it('RL-10 — missing src/ directory returns empty results', async () => {
    const result = await discoverResources(testDir)
    expect(result.modules).toEqual([])
    expect(result.subscribers).toEqual([])
  })

  // RL-11 — Discovers multiple entities within modules
  it('RL-11 — discovers multiple entities within module directories', async () => {
    createFile('src/modules/product/entities/product/model.ts', `export const Product = {}`)
    createFile('src/modules/product/entities/variant/model.ts', `export const Variant = {}`)

    const result = await discoverResources(testDir)
    expect(result.modules).toHaveLength(1)
    expect(result.modules[0]!.models.sort()).toEqual(['product', 'variant'])
  })

  // RL-12 — Module without entities/ dir is skipped (no entities = no module)
  it('RL-12 — module without entities/ dir is skipped', async () => {
    createFile('src/modules/simple/readme.txt', `no entities here`)

    const result = await discoverResources(testDir)
    expect(result.modules).toHaveLength(0)
  })

  // RL-13 — Kebab-case directory name canonicalizes to camelCase identifier,
  // and the raw on-disk name is preserved as `dirName`.
  it('RL-13 — kebab-case directory produces camelCase name + preserves dirName', async () => {
    createFile('src/modules/my-custom-module/entities/item/model.ts', `export const Item = {}`)

    const result = await discoverResources(testDir)
    expect(result.modules).toHaveLength(1)
    expect(result.modules[0]!.name).toBe('myCustomModule')
    expect(result.modules[0]!.dirName).toBe('my-custom-module')
  })

  // RL-14 — Collision detection: two dirs that canonicalize to the same JS identifier throw.
  it('RL-14 — two dirs canonicalizing to the same identifier throw a collision error', async () => {
    createFile('src/modules/my-mod/entities/item/model.ts', `export const Item = {}`)
    createFile('src/modules/myMod/entities/item/model.ts', `export const Item = {}`)

    await expect(discoverResources(testDir)).rejects.toThrow(/collision/i)
  })

  // RL-15 — Invalid identifier: directory name that cannot produce a valid JS identifier.
  it('RL-15 — directory name that is not a valid JS identifier throws', async () => {
    // Leading digit → canonicalized name still starts with a digit → invalid JS identifier.
    createFile('src/modules/1-bad/entities/item/model.ts', `export const Item = {}`)

    await expect(discoverResources(testDir)).rejects.toThrow(/valid JS identifier/)
  })
})
