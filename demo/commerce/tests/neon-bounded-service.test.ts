// biome-ignore lint/style/noRestrictedImports: exercise the installed runtime patch, outside app bootstrap
import { InMemoryRepository, instantiateServiceDescriptor } from '@mantajs/core'
import { describe, expect, it, vi } from 'vitest'

describe('bounded service capabilities', () => {
  it('does not bypass a custom list visibility policy', () => {
    const repo = new InMemoryRepository()
    const service = instantiateServiceDescriptor(
      { entity: { name: 'Item', schema: {} }, factory: () => ({ list: async () => [] }) } as never,
      repo,
    )
    expect(service.__queryPage).toBeUndefined()
  })
  it('keeps memory multi-value filtering, counting and projection consistent', async () => {
    const repo = new InMemoryRepository()
    await repo.create([
      { id: 'a', name: 'active', price: 2 },
      { id: 'b', name: 'active', price: 10 },
      { id: 'c', name: 'hidden', price: 20 },
    ])
    const service = instantiateServiceDescriptor(
      { entity: { name: 'Item', schema: { name: {}, price: {} } }, factory: () => ({}) } as never,
      repo,
    )
    const page = service.__queryPage as (input: unknown) => Promise<[Record<string, unknown>[], number]>
    const [rows, count] = await page({
      where: { name: { $in: ['active'] } },
      fields: ['id'],
      order: { price: 'DESC' },
      limit: 1,
      offset: 0,
    })
    expect(rows).toEqual([{ id: 'b' }])
    expect(count).toBe(2)
  })
  it('rejects malformed operators before they can broaden a query', async () => {
    const repo = new InMemoryRepository()
    const read = vi.spyOn(repo, 'findAndCount')
    const service = instantiateServiceDescriptor(
      { entity: { name: 'Item', schema: { name: {} } }, factory: () => ({}) } as never,
      repo,
    )
    const page = service.__queryPage as (input: unknown) => Promise<unknown>
    await expect(page({ where: { name: { $in: 'active' } }, limit: 1, offset: 0 })).rejects.toThrow()
    await expect(page({ where: { name: {} }, limit: 1, offset: 0 })).rejects.toThrow()
    expect(read).not.toHaveBeenCalled()
  })
})
