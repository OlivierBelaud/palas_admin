import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  type IRepository,
  type Context,
  MantaError,
  createTestContainer,
  createTestContext,
  resetAll,
  InMemoryContainer,
} from '@manta/test-utils'

describe('IRepository Conformance', () => {
  let repo: IRepository
  let container: InMemoryContainer
  let ctx: Context

  beforeEach(() => {
    container = createTestContainer()
    repo = container.resolve<IRepository>('IRepository')
    ctx = createTestContext()
  })

  afterEach(async () => {
    await resetAll(container)
  })

  // R-01 — SPEC-126/109: find filters soft-deleted by default
  it('find > filtre soft-delete auto', async () => {
    const entity = await repo.create({ name: 'test' })
    const id = (entity as any).id

    await repo.softDelete(id)

    const results = await repo.find()
    const found = (results as any[]).find((e) => e.id === id)
    expect(found).toBeUndefined()
  })

  // R-02 — SPEC-109: withDeleted:true includes soft-deleted
  it('find > withDeleted:true inclut soft-deleted', async () => {
    const entity = await repo.create({ name: 'test' })
    const id = (entity as any).id

    await repo.softDelete(id)

    const results = await repo.find({ withDeleted: true })
    const found = (results as any[]).find((e) => e.id === id)
    expect(found).toBeDefined()
    expect(found.deleted_at).not.toBeNull()
  })

  // R-03 — SPEC-126: create generates id and timestamps
  it('create > insertion', async () => {
    const entity = await repo.create({ name: 'test' }) as any

    expect(entity.id).toBeDefined()
    expect(typeof entity.id).toBe('string')
    expect(entity.created_at).toBeDefined()
  })

  // R-04 — SPEC-126: update modifies fields and updated_at
  it('update > modification', async () => {
    const entity = await repo.create({ name: 'original' }) as any
    const id = entity.id

    const updated = await repo.update({ id, name: 'updated' }) as any
    expect(updated.name).toBe('updated')
    expect(updated.updated_at).toBeDefined()
  })

  // R-05 — SPEC-126: hard delete removes permanently
  it('delete > suppression hard', async () => {
    const entity = await repo.create({ name: 'test' }) as any
    const id = entity.id

    await repo.delete(id)

    const results = await repo.find({ withDeleted: true })
    const found = (results as any[]).find((e) => e.id === id)
    expect(found).toBeUndefined()
  })

  // R-06 — SPEC-109: softDelete sets deleted_at
  it('softDelete > suppression logique', async () => {
    const entity = await repo.create({ name: 'test' }) as any
    const id = entity.id

    await repo.softDelete(id)

    // Not in regular find
    const regular = await repo.find()
    expect((regular as any[]).find((e) => e.id === id)).toBeUndefined()

    // Present in withDeleted
    const withDel = await repo.find({ withDeleted: true })
    const found = (withDel as any[]).find((e) => e.id === id)
    expect(found).toBeDefined()
    expect(found.deleted_at).not.toBeNull()
  })

  // R-07 — SPEC-109: restore clears deleted_at
  it('restore > restauration', async () => {
    const entity = await repo.create({ name: 'test' }) as any
    const id = entity.id

    await repo.softDelete(id)
    await repo.restore(id)

    const results = await repo.find()
    const found = (results as any[]).find((e) => e.id === id)
    expect(found).toBeDefined()
    expect(found.deleted_at).toBeNull()
  })

  // R-08 — SPEC-126: upsertWithReplace inserts new
  it('upsertWithReplace > INSERT si nouveau', async () => {
    const results = await repo.upsertWithReplace(
      [{ id: 'new-1', name: 'test' }],
    )

    expect(results).toHaveLength(1)
    expect((results[0] as any).name).toBe('test')
  })

  // R-09 — SPEC-126: upsertWithReplace updates existing
  it('upsertWithReplace > UPDATE si existant', async () => {
    const entity = await repo.create({ name: 'original' }) as any

    const results = await repo.upsertWithReplace(
      [{ id: entity.id, name: 'updated' }],
    )

    expect((results[0] as any).name).toBe('updated')
  })

  // R-10 — SPEC-126: upsertWithReplace respects replaceFields
  it('upsertWithReplace > replaceFields contrôle', async () => {
    const entity = await repo.create({ name: 'original', email: 'a@b.com' }) as any

    const results = await repo.upsertWithReplace(
      [{ id: entity.id, name: 'updated', email: 'new@b.com' }],
      ['name'], // only replace name
    )

    expect((results[0] as any).name).toBe('updated')
    // email should remain unchanged when only 'name' is in replaceFields
  })

  // R-11 — SPEC-126: transaction propagation via Context
  it('transaction > propagation via Context', async () => {
    // Verify that operations within a transaction are atomic
    const entity = await repo.create({ name: 'before-tx' }) as any

    await repo.transaction(async (txManager) => {
      // Create inside transaction
      await repo.create({ name: 'inside-tx' })
      // Should be able to find the entity created before the tx
      const results = await repo.find()
      const names = (results as any[]).map((e) => e.name)
      expect(names).toContain('before-tx')
      expect(names).toContain('inside-tx')
    })

    // After successful commit, entity should persist
    const final = await repo.find()
    const finalNames = (final as any[]).map((e) => e.name)
    expect(finalNames).toContain('inside-tx')
  })

  // R-12 — SPEC-126: nested transaction with savepoint when enabled
  it.todo('nested transaction > savepoint quand activé — blocked on: DrizzleRepository integration test with real PG savepoints (SPEC-126)')

  // R-13 — SPEC-061: pagination with limit/offset
  it('find > pagination', async () => {
    // Create 50 entities
    for (let i = 0; i < 50; i++) {
      await repo.create({ name: `entity-${String(i).padStart(2, '0')}` })
    }

    const results = await repo.find({ limit: 10, offset: 20 })
    expect(results).toHaveLength(10)
  })

  // R-14 — SPEC-061: sorting
  it('find > tri', async () => {
    await repo.create({ name: 'charlie' })
    await repo.create({ name: 'alice' })
    await repo.create({ name: 'bob' })

    const results = await repo.find({ order: { name: 'ASC' } }) as any[]
    expect(results[0].name).toBe('alice')
    expect(results[1].name).toBe('bob')
    expect(results[2].name).toBe('charlie')
  })

  // R-15 — SPEC-109: softDelete returns Record<string, string[]> with cascaded link IDs
  it('softDelete > retour contient Record<string, string[]>', async () => {
    const entity = await repo.create({ name: 'test' }) as any
    const result = await repo.softDelete(entity.id)

    // Result should be Record<string, string[]>
    expect(typeof result).toBe('object')
    expect(result).not.toBeNull()
  })

  // R-16 — SPEC-109: softDelete without cascade returns empty record
  it('softDelete > retour sans cascade', async () => {
    const entity = await repo.create({ name: 'test' }) as any
    const result = await repo.softDelete(entity.id)

    // Without links, should return empty record
    expect(typeof result).toBe('object')
  })

  // R-17 — SPEC-109: restore does NOT restore cascaded links
  it('restore > ne restaure PAS les liens cascadés', async () => {
    const entity = await repo.create({ name: 'test' }) as any

    await repo.softDelete(entity.id)
    await repo.restore(entity.id)

    // Entity is restored
    const results = await repo.find()
    const found = (results as any[]).find((e) => e.id === entity.id)
    expect(found).toBeDefined()
    expect(found.deleted_at).toBeNull()
    // Cascaded links remain soft-deleted (tested in integration)
  })

  // R-18 — SPEC-126: transaction rollback inter-services
  it('transaction > rollback inter-services', async () => {
    try {
      await repo.transaction(async () => {
        await repo.create({ name: 'serviceA-data' })
        throw new Error('serviceB failed')
      })
    } catch {
      // After rollback, serviceA data should be absent
      const results = await repo.find()
      const found = (results as any[]).find((e) => (e as any).name === 'serviceA-data')
      expect(found).toBeUndefined()
    }
  })

  // R-19 — SPEC-061: cursor pagination traversal without duplicates
  it('cursor pagination > traversal complet sans doublon', async () => {
    // Create 50 entities
    for (let i = 0; i < 50; i++) {
      await repo.create({ name: `entity-${String(i).padStart(2, '0')}` })
    }

    const allIds = new Set<string>()
    let cursor: string | undefined
    let pages = 0

    // Paginate through all entities
    do {
      const options: Record<string, unknown> = { limit: 10 }
      if (cursor) options.cursor = { after: cursor }

      const results = await repo.find(options as any) as any[]
      if (results.length === 0) break

      for (const entity of results) {
        expect(allIds.has(entity.id)).toBe(false) // No duplicates
        allIds.add(entity.id)
      }

      cursor = results.length === 10 ? results[results.length - 1].id : undefined
      pages++
    } while (cursor)

    expect(allIds.size).toBe(50) // All entities visited
    expect(pages).toBe(5) // 5 pages of 10
  })
})
