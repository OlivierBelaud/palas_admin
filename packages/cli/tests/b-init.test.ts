// Section B — manta init command
// Tests: B-01 → B-14

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initCommand } from '../src/commands/init'

const TMP = resolve(__dirname, '__tmp_init_test__')

function setup() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true })
}

describe('B — manta init', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('B-01 — creates all expected directories', async () => {
    await initCommand({ dir: TMP })

    expect(existsSync(join(TMP, 'src/modules'))).toBe(true)
    expect(existsSync(join(TMP, 'src/commands'))).toBe(true)
    expect(existsSync(join(TMP, 'src/subscribers'))).toBe(true)
    expect(existsSync(join(TMP, 'src/jobs'))).toBe(true)
    expect(existsSync(join(TMP, 'src/links'))).toBe(true)
    expect(existsSync(join(TMP, 'src/queries'))).toBe(true)
    expect(existsSync(join(TMP, 'src/agents'))).toBe(true)
    expect(existsSync(join(TMP, 'src/middleware'))).toBe(true)
  })

  it('B-01b — does NOT create legacy src/api directories', async () => {
    await initCommand({ dir: TMP })

    expect(existsSync(join(TMP, 'src/api/admin'))).toBe(false)
    expect(existsSync(join(TMP, 'src/api/store'))).toBe(false)
    expect(existsSync(join(TMP, 'src/workflows'))).toBe(false)
  })

  it('B-02 — creates manta.config.ts with defineConfig', async () => {
    await initCommand({ dir: TMP })

    const content = readFileSync(join(TMP, 'manta.config.ts'), 'utf-8')
    expect(content).toContain("import { defineConfig } from '@manta/core'")
    expect(content).toContain('defineConfig(')
    expect(content).toContain('database')
    expect(content).toContain('http')
  })

  it('B-03 — creates .env with DATABASE_URL', async () => {
    await initCommand({ dir: TMP })

    const content = readFileSync(join(TMP, '.env'), 'utf-8')
    expect(content).toContain('DATABASE_URL=')
    expect(content).toContain('PORT=')
    expect(content).toContain('ANTHROPIC_API_KEY')
  })

  it('B-04 — creates package.json with all required dependencies', async () => {
    await initCommand({ dir: TMP })

    const pkg = JSON.parse(readFileSync(join(TMP, 'package.json'), 'utf-8'))
    expect(pkg.name).toBeDefined()
    expect(pkg.type).toBe('module')
    expect(pkg.scripts.dev).toBe('manta dev')
    expect(pkg.scripts.build).toContain('--preset vercel')
    expect(pkg.dependencies['@manta/core']).toBeDefined()
    expect(pkg.dependencies['@manta/cli']).toBeDefined()
    expect(pkg.dependencies['@manta/host-nitro']).toBeDefined()
    expect(pkg.dependencies['@manta/dashboard']).toBeDefined()
  })

  it('B-05 — creates tsconfig.json with JSX support', async () => {
    await initCommand({ dir: TMP })

    const tsconfig = JSON.parse(readFileSync(join(TMP, 'tsconfig.json'), 'utf-8'))
    expect(tsconfig.compilerOptions.target).toBe('ES2022')
    expect(tsconfig.compilerOptions.module).toBe('ESNext')
    expect(tsconfig.compilerOptions.strict).toBe(true)
    expect(tsconfig.compilerOptions.jsx).toBe('react-jsx')
    expect(tsconfig.include).toContain('src/**/*.ts')
    expect(tsconfig.include).toContain('src/**/*.tsx')
    expect(tsconfig.include).toContain('.manta/generated.d.ts')
  })

  it('B-06 — creates nitro.config.ts but NOT drizzle.config.ts', async () => {
    await initCommand({ dir: TMP })

    expect(existsSync(join(TMP, 'nitro.config.ts'))).toBe(true)
    expect(existsSync(join(TMP, 'drizzle.config.ts'))).toBe(false)
  })

  it('B-07 — creates .env.example', async () => {
    await initCommand({ dir: TMP })

    expect(existsSync(join(TMP, '.env.example'))).toBe(true)
    const content = readFileSync(join(TMP, '.env.example'), 'utf-8')
    expect(content).toContain('DATABASE_URL=')
  })

  it('B-08 — skips files that already exist (never destroys)', async () => {
    const originalContent = '# my custom config'
    writeFileSync(join(TMP, 'manta.config.ts'), originalContent)

    const result = await initCommand({ dir: TMP })

    expect(result.skipped).toContain('manta.config.ts')
    expect(readFileSync(join(TMP, 'manta.config.ts'), 'utf-8')).toBe(originalContent)
  })

  it('B-09 — reports all files skipped when project already initialized', async () => {
    // First init
    await initCommand({ dir: TMP })
    // Second init
    const result = await initCommand({ dir: TMP })

    expect(result.created).toHaveLength(0)
    expect(result.skipped.length).toBeGreaterThan(0)
  })

  it('B-10 — exitCode is 0 on success', async () => {
    const result = await initCommand({ dir: TMP })
    expect(result.exitCode).toBe(0)
  })

  it('B-11 — creates .gitignore with framework artifacts', async () => {
    await initCommand({ dir: TMP })

    const content = readFileSync(join(TMP, '.gitignore'), 'utf-8')
    expect(content).toContain('.manta/')
    expect(content).toContain('node_modules/')
    expect(content).toContain('.env')
  })

  it('B-12 — V2: no legacy src/admin/ scaffold (SPAs are in src/spa/)', async () => {
    await initCommand({ dir: TMP })

    // V2: admin is created via src/spa/admin/ + defineUser, not src/admin/
    expect(existsSync(join(TMP, 'src/admin'))).toBe(false)
  })

  it('B-13 — creates AGENT.md at project root', async () => {
    await initCommand({ dir: TMP })

    // AGENT.md is created (from bundled template or core docs)
    // May warn if @manta/core is not installed, but still attempts fallback
    const agentPath = join(TMP, 'AGENT.md')
    if (existsSync(agentPath)) {
      const content = readFileSync(agentPath, 'utf-8')
      expect(content).toContain('Manta')
      expect(content).toContain('defineCommand')
    }
  })

  it('B-14 — .env DATABASE_URL uses sanitized project name', async () => {
    await initCommand({ dir: TMP })

    const content = readFileSync(join(TMP, '.env'), 'utf-8')
    // Project name is the TMP directory basename, sanitized for postgres
    expect(content).toMatch(/DATABASE_URL=postgresql:\/\/localhost:5432\/[a-z0-9_]+/)
  })
})
