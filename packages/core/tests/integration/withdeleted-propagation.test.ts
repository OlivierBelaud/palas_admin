import type { IRepository, TestMantaApp } from '@manta/core'
import {
  createTestMantaApp,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryLockingAdapter,
  InMemoryRepository,
  TestLogger,
} from '@manta/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const makeInfra = () => ({
  eventBus: new InMemoryEventBusAdapter(),
  logger: new TestLogger(),
  cache: new InMemoryCacheAdapter(),
  locking: new InMemoryLockingAdapter(),
  file: new InMemoryFileAdapter(),
  db: {},
})

describe('withDeleted Propagation Integration', () => {
  let app: TestMantaApp
  let repo: IRepository

  beforeEach(() => {
    app = createTestMantaApp({ infra: makeInfra() })
    repo = new InMemoryRepository()
    app.register('IRepository', repo)
  })

  afterEach(async () => {
    await app.dispose()
  })

  // SPEC-109/012: withDeleted:false (default) excludes soft-deleted from find
  it('find without withDeleted excludes soft-deleted entities', async () => {
    const entity = (await repo.create({ name: 'to-delete' })) as any
    await repo.softDelete(entity.id)

    // Default find should NOT return the soft-deleted entity
    const results = await repo.find()
    const found = (results as any[]).find((e) => e.id === entity.id)
    expect(found).toBeUndefined()
  })

  // SPEC-109: withDeleted:true includes soft-deleted entities
  it('find with withDeleted:true includes soft-deleted entities', async () => {
    const active = (await repo.create({ name: 'active' })) as any
    const deleted = (await repo.create({ name: 'deleted' })) as any
    await repo.softDelete(deleted.id)

    const results = (await repo.find({ withDeleted: true })) as any[]
    const ids = results.map((e) => e.id)
    expect(ids).toContain(active.id)
    expect(ids).toContain(deleted.id)

    const deletedEntity = results.find((e) => e.id === deleted.id)
    expect(deletedEntity.deleted_at).not.toBeNull()
  })

  // SPEC-109: withDeleted propagates uniformly to ALL relation types
  it('withDeleted propagates to link tables and direct FK relations', async () => {
    // Contract: withDeleted:true applies to ALL relations uniformly
    // Simulate: parent entity soft-deleted, linked child should be visible with withDeleted
    const parent = (await repo.create({ name: 'parent' })) as any
    const child = (await repo.create({ name: 'child', parent_id: parent.id })) as any

    // Soft-delete both
    await repo.softDelete(parent.id)
    await repo.softDelete(child.id)

    // Without withDeleted — neither visible
    const regular = (await repo.find()) as any[]
    expect(regular.find((e) => e.id === parent.id)).toBeUndefined()
    expect(regular.find((e) => e.id === child.id)).toBeUndefined()

    // With withDeleted — both visible (propagation to relations)
    const withDel = (await repo.find({ withDeleted: true })) as any[]
    expect(withDel.find((e) => e.id === parent.id)).toBeDefined()
    expect(withDel.find((e) => e.id === child.id)).toBeDefined()
  })
})
