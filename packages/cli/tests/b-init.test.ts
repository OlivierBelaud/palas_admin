// Section B — manta init command
// Tests: B-01 → B-10

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
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

    expect(existsSync(join(TMP, 'src/api/admin'))).toBe(true)
    expect(existsSync(join(TMP, 'src/api/store'))).toBe(true)
    expect(existsSync(join(TMP, 'src/modules'))).toBe(true)
    expect(existsSync(join(TMP, 'src/subscribers'))).toBe(true)
    expect(existsSync(join(TMP, 'src/workflows'))).toBe(true)
    expect(existsSync(join(TMP, 'src/jobs'))).toBe(true)
    expect(existsSync(join(TMP, 'src/links'))).toBe(true)
  })

  it('B-02 — creates manta.config.ts with defineConfig import', async () => {
    await initCommand({ dir: TMP })

    const content = readFileSync(join(TMP, 'manta.config.ts'), 'utf-8')
    expect(content).toContain("import { defineConfig } from '@manta/core'")
    expect(content).toContain('defineConfig(')
    expect(content).toContain('database')
  })

  it('B-03 — creates .env with DATABASE_URL', async () => {
    await initCommand({ dir: TMP })

    const content = readFileSync(join(TMP, '.env'), 'utf-8')
    expect(content).toContain('DATABASE_URL=')
    expect(content).toContain('PORT=')
  })

  it('B-04 — creates package.json with required fields', async () => {
    await initCommand({ dir: TMP })

    const pkg = JSON.parse(readFileSync(join(TMP, 'package.json'), 'utf-8'))
    expect(pkg.name).toBeDefined()
    expect(pkg.type).toBe('module')
    expect(pkg.scripts.dev).toBe('manta dev')
    expect(pkg.dependencies['@manta/core']).toBeDefined()
  })

  it('B-05 — creates tsconfig.json with correct target', async () => {
    await initCommand({ dir: TMP })

    const tsconfig = JSON.parse(readFileSync(join(TMP, 'tsconfig.json'), 'utf-8'))
    expect(tsconfig.compilerOptions.target).toBe('ES2022')
    expect(tsconfig.compilerOptions.module).toBe('ESNext')
    expect(tsconfig.compilerOptions.strict).toBe(true)
    expect(tsconfig.include).toContain('src/**/*.ts')
  })

  it('B-06 — creates drizzle.config.ts', async () => {
    await initCommand({ dir: TMP })

    const content = readFileSync(join(TMP, 'drizzle.config.ts'), 'utf-8')
    expect(content).toContain('drizzle-kit')
    expect(content).toContain('postgresql')
    expect(content).toContain('schema')
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
})
