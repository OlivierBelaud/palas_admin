// SPEC TS-04 — Input sanitization + output validation in generate-types
// Ref: TS-04

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MantaError } from '@manta/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateTypesFromModules } from '../../src/bootstrap/generate-types'

let testDir: string

function createFile(relativePath: string, content: string): void {
  const fullPath = join(testDir, relativePath)
  const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(fullPath, content)
}

beforeEach(() => {
  testDir = join(tmpdir(), `manta-gts-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
    return undefined
  } catch (err) {
    return err
  }
}

describe('TS-04 — generate-types input sanitization', () => {
  // -------------------------------------------------------------------
  // GTS-01 — Entity with invalid PascalCase name throws
  // -------------------------------------------------------------------
  it('GTS-01 — rejects an entity whose name is not PascalCase', async () => {
    // `bad name` has a space → runtime defineModel() accepts it (compile-time only
    // guard), so codegen must catch it via assertSafeIdentifierComponent().
    createFile(
      'src/modules/product/entities/product/model.ts',
      `export const Product = defineModel('bad name', { title: field.text() })\n`,
    )

    const err = await captureError(() => generateTypesFromModules(testDir))
    expect(MantaError.is(err)).toBe(true)
    expect((err as MantaError).type).toBe('INVALID_DATA')
    expect((err as MantaError).message).toMatch(/PascalCase/)
  })

  // -------------------------------------------------------------------
  // GTS-02 — Actor with invalid name throws
  // -------------------------------------------------------------------
  it('GTS-02 — rejects a defineContext actor with invalid name', async () => {
    // A valid module is still required so codegen reaches the context loop.
    createFile(
      'src/modules/product/entities/product/model.ts',
      `export const Product = defineModel('Product', { title: field.text() })\n`,
    )
    createFile('src/contexts/admin.ts', `export default { actors: ['BadActor'] }\n`)

    const err = await captureError(() => generateTypesFromModules(testDir))
    expect(MantaError.is(err)).toBe(true)
    expect((err as MantaError).type).toBe('INVALID_DATA')
    expect((err as MantaError).message).toMatch(/camelCase/)
  })

  // -------------------------------------------------------------------
  // GTS-03 — Subscriber event with space throws
  // -------------------------------------------------------------------
  it('GTS-03 — rejects a subscriber whose event name contains a space', async () => {
    createFile(
      'src/modules/product/entities/product/model.ts',
      `export const Product = defineModel('Product', { title: field.text() })\n`,
    )
    createFile('src/subscribers/bad.ts', `export default { event: 'bad event name', handler: async () => {} }\n`)

    const err = await captureError(() => generateTypesFromModules(testDir))
    expect(MantaError.is(err)).toBe(true)
    expect((err as MantaError).type).toBe('INVALID_DATA')
    expect((err as MantaError).message).toMatch(/Invalid subscriber event name/)
  })

  // -------------------------------------------------------------------
  // GTS-04 — Command with dot in filename (→ camelCase conversion fails)
  // -------------------------------------------------------------------
  it('GTS-04 — rejects a command whose id does not produce a valid camelCase identifier', async () => {
    createFile(
      'src/modules/product/entities/product/model.ts',
      `export const Product = defineModel('Product', { title: field.text() })\n`,
    )
    // A filename like 'bad.command' produces id 'bad.command' → camel 'bad.command' (dot survives) → invalid
    createFile(
      'src/commands/bad.command.ts',
      `export default { name: 'bad.command', input: {}, handler: async () => ({}) }\n`,
    )

    const err = await captureError(() => generateTypesFromModules(testDir))
    expect(MantaError.is(err)).toBe(true)
    expect((err as MantaError).type).toBe('INVALID_DATA')
    expect((err as MantaError).message).toMatch(/camelCase/)
  })

  // -------------------------------------------------------------------
  // GTS-05 — Valid resources succeed and produce parseable TS
  // -------------------------------------------------------------------
  it('GTS-05 — valid resources succeed and produce parseable TS', async () => {
    createFile(
      'src/modules/product/entities/product/model.ts',
      `export const Product = defineModel('Product', { title: field.text() })\n`,
    )
    createFile(
      'src/subscribers/on-created.ts',
      `export const event = 'product.created'\nexport default async function handler() {}\n`,
    )

    await generateTypesFromModules(testDir)

    const out = join(testDir, '.manta', 'generated.d.ts')
    expect(existsSync(out)).toBe(true)
    const content = readFileSync(out, 'utf-8')
    expect(content).toContain('ProductEntity')
    expect(content).toContain('product.created')
  })
})
