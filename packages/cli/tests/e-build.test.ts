// Section E — manta build command
// Tests: E-01 → E-10

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { buildCommand } from '../src/commands/build'

const TMP = resolve(__dirname, '__tmp_build_test__')

function setup() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true })
}

describe('E — manta build', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('E-01 — rejects unknown preset', async () => {
    const result = await buildCommand({ preset: 'xyz' }, TMP)
    expect(result.exitCode).toBe(1)
    expect(result.errors[0]).toContain("Unknown preset 'xyz'")
    expect(result.errors[0]).toContain('node')
    expect(result.errors[0]).toContain('vercel')
  })

  it('E-02 — accepts valid presets', async () => {
    for (const preset of ['node', 'vercel', 'aws-lambda', 'cloudflare', 'bun']) {
      const result = await buildCommand({ preset }, TMP)
      expect(result.exitCode).toBe(0)
    }
  })

  it('E-03 — generates manifest directory .manta/manifest/', async () => {
    await buildCommand({}, TMP)
    expect(existsSync(join(TMP, '.manta', 'manifest'))).toBe(true)
  })

  it('E-04 — generates routes.json with routes array', async () => {
    mkdirSync(join(TMP, 'src/api/admin/products'), { recursive: true })
    writeFileSync(join(TMP, 'src/api/admin/products/route.ts'), 'export function GET() {}')

    await buildCommand({}, TMP)

    const routesJson = JSON.parse(
      readFileSync(join(TMP, '.manta/manifest/routes.json'), 'utf-8'),
    )
    expect(routesJson.routes).toBeDefined()
    expect(Array.isArray(routesJson.routes)).toBe(true)
    expect(routesJson.routes.length).toBeGreaterThan(0)
    expect(routesJson.routes[0].path).toBe('/admin/products')
    expect(routesJson.routes[0].namespace).toBe('admin')
    expect(routesJson.routes[0].file).toBeDefined()
  })

  it('E-05 — generates empty arrays when no files found', async () => {
    await buildCommand({}, TMP)

    const files = ['routes.json', 'subscribers.json', 'workflows.json', 'jobs.json', 'links.json', 'modules.json']
    for (const file of files) {
      const content = JSON.parse(
        readFileSync(join(TMP, '.manta/manifest', file), 'utf-8'),
      )
      const key = Object.keys(content)[0]!
      expect(Array.isArray(content[key])).toBe(true)
    }
  })

  it('E-06 — generates subscribers.json', async () => {
    mkdirSync(join(TMP, 'src/subscribers'), { recursive: true })
    writeFileSync(join(TMP, 'src/subscribers/product-created.ts'), 'export default {}')

    await buildCommand({}, TMP)

    const subs = JSON.parse(
      readFileSync(join(TMP, '.manta/manifest/subscribers.json'), 'utf-8'),
    )
    expect(subs.subscribers).toHaveLength(1)
    expect(subs.subscribers[0].id).toBe('product-created')
    expect(subs.subscribers[0].file).toContain('subscribers/product-created.ts')
  })

  it('E-07 — generates workflows.json', async () => {
    mkdirSync(join(TMP, 'src/workflows'), { recursive: true })
    writeFileSync(join(TMP, 'src/workflows/create-product.ts'), 'export default {}')

    await buildCommand({}, TMP)

    const wf = JSON.parse(
      readFileSync(join(TMP, '.manta/manifest/workflows.json'), 'utf-8'),
    )
    expect(wf.workflows).toHaveLength(1)
    expect(wf.workflows[0].id).toBe('create-product')
  })

  it('E-08 — generates jobs.json', async () => {
    mkdirSync(join(TMP, 'src/jobs'), { recursive: true })
    writeFileSync(join(TMP, 'src/jobs/cleanup-carts.ts'), 'export default {}')

    await buildCommand({}, TMP)

    const jobs = JSON.parse(
      readFileSync(join(TMP, '.manta/manifest/jobs.json'), 'utf-8'),
    )
    expect(jobs.jobs).toHaveLength(1)
    expect(jobs.jobs[0].id).toBe('cleanup-carts')
  })

  it('E-09 — generates modules.json from src/modules/', async () => {
    mkdirSync(join(TMP, 'src/modules/product'), { recursive: true })
    writeFileSync(join(TMP, 'src/modules/product/index.ts'), 'export default {}')

    await buildCommand({}, TMP)

    const mods = JSON.parse(
      readFileSync(join(TMP, '.manta/manifest/modules.json'), 'utf-8'),
    )
    expect(mods.modules).toHaveLength(1)
    expect(mods.modules[0].name).toBe('product')
    expect(mods.modules[0].file).toBe('src/modules/product/index.ts')
  })

  it('E-10 — each manifest entry has id/name and file', async () => {
    mkdirSync(join(TMP, 'src/subscribers'), { recursive: true })
    writeFileSync(join(TMP, 'src/subscribers/test.ts'), '')
    mkdirSync(join(TMP, 'src/workflows'), { recursive: true })
    writeFileSync(join(TMP, 'src/workflows/test-wf.ts'), '')

    await buildCommand({}, TMP)

    const subs = JSON.parse(readFileSync(join(TMP, '.manta/manifest/subscribers.json'), 'utf-8'))
    for (const s of subs.subscribers) {
      expect(s.id).toBeDefined()
      expect(s.file).toBeDefined()
    }

    const wf = JSON.parse(readFileSync(join(TMP, '.manta/manifest/workflows.json'), 'utf-8'))
    for (const w of wf.workflows) {
      expect(w.id).toBeDefined()
      expect(w.file).toBeDefined()
    }
  })
})
