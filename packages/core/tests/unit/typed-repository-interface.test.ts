// TypedRepository interface tests — verifies the interface contract includes upsertWithReplace
// and that MantaInfra has the db property.
// Uses direct imports to avoid barrel export issues.

import { describe, expect, it } from 'vitest'
import type { MantaInfra } from '../../src/app'
import type { TypedRepository } from '../../src/service/define'

describe('TypedRepository interface contract', () => {
  // TR-01 — TypedRepository includes upsertWithReplace
  it('TR-01: TypedRepository includes upsertWithReplace in its interface', () => {
    // Type-level test: create an object that satisfies TypedRepository
    // and verify upsertWithReplace is callable
    const repo: TypedRepository<{ id: string; name: string }> = {
      find: async () => [],
      findAndCount: async () => [[], 0],
      create: async (data) => (Array.isArray(data) ? data : data) as any,
      update: async (data) => data as any,
      delete: async () => {},
      softDelete: async () => ({}),
      restore: async () => {},
      upsertWithReplace: async (data) => data as any,
    }

    // Runtime verification
    expect(typeof repo.upsertWithReplace).toBe('function')
  })

  // TR-02 — upsertWithReplace accepts optional replaceFields and conflictTarget
  it('TR-02: upsertWithReplace signature accepts optional params', () => {
    const repo: TypedRepository<{ id: string; value: number }> = {
      find: async () => [],
      findAndCount: async () => [[], 0],
      create: async () => [] as any,
      update: async () => ({}) as any,
      delete: async () => {},
      softDelete: async () => ({}),
      restore: async () => {},
      upsertWithReplace: async (_data, _replaceFields?, _conflictTarget?) => [],
    }

    // All three call forms should compile
    expect(typeof repo.upsertWithReplace).toBe('function')
  })
})

describe('MantaInfra type contract', () => {
  // MI-01 — MantaInfra includes optional db property
  it('MI-01: MantaInfra has db as optional unknown', () => {
    // Type-level test: MantaInfra should accept db?: unknown
    const infra: MantaInfra = {
      eventBus: {} as any,
      logger: {} as any,
      cache: {} as any,
      locking: {} as any,
      file: {} as any,
      // db is optional — should compile without it
    }

    expect(infra.db).toBeUndefined()
  })

  // MI-02 — MantaInfra accepts db when provided
  it('MI-02: MantaInfra accepts db value', () => {
    const fakeDb = { query: () => {} }
    const infra: MantaInfra = {
      eventBus: {} as any,
      logger: {} as any,
      cache: {} as any,
      locking: {} as any,
      file: {} as any,
      db: fakeDb,
    }

    expect(infra.db).toBe(fakeDb)
  })
})
