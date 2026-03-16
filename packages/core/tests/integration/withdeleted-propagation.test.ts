import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createTestContainer,
  resetAll,
  InMemoryContainer,
  type IRepository,
} from '@manta/test-utils'

describe('withDeleted Propagation Integration', () => {
  let container: InMemoryContainer
  let repo: IRepository

  beforeEach(() => {
    container = createTestContainer()
    repo = container.resolve<IRepository>('IRepository')
  })

  afterEach(async () => {
    await resetAll(container)
  })

  // SPEC-109/012: withDeleted:false (default) excludes soft-deleted from find
  it('find without withDeleted excludes soft-deleted entities', async () => {
    const entity = await repo.create({ name: 'to-delete' }) as any
    await repo.softDelete(entity.id)

    // Default find should NOT return the soft-deleted entity
    const results = await repo.find()
    const found = (results as any[]).find((e) => e.id === entity.id)
    expect(found).toBeUndefined()
  })

  // SPEC-109: withDeleted:true includes soft-deleted entities
  it('find with withDeleted:true includes soft-deleted entities', async () => {
    const active = await repo.create({ name: 'active' }) as any
    const deleted = await repo.create({ name: 'deleted' }) as any
    await repo.softDelete(deleted.id)

    const results = await repo.find({ withDeleted: true }) as any[]
    const ids = results.map((e) => e.id)
    expect(ids).toContain(active.id)
    expect(ids).toContain(deleted.id)

    const deletedEntity = results.find((e) => e.id === deleted.id)
    expect(deletedEntity.deleted_at).not.toBeNull()
  })

  // SPEC-109: withDeleted propagates uniformly to ALL relation types
  it.todo('withDeleted propagates to link tables and direct FK relations — blocked on: Query.graph() implementation (SPEC-109)')
})
