import { describe, it, expect, beforeEach } from 'vitest'
import { QueryService, MantaError } from '@manta/core'

describe('QueryService', () => {
  let query: QueryService

  beforeEach(() => {
    query = new QueryService()
  })

  // QG-01 — Query.gql() throws NOT_IMPLEMENTED
  it('gql() throws NOT_IMPLEMENTED', async () => {
    await expect(query.gql()).rejects.toThrow('Query.gql() has been removed')
  })

  // QG-02 — graph() with registered resolver
  it('graph() resolves entities via registered resolver', async () => {
    const products = [
      { id: '1', title: 'Widget' },
      { id: '2', title: 'Gadget' },
    ]

    query.registerResolver('product', async () => products)

    const result = await query.graph({ entity: 'product' })
    expect(result).toEqual(products)
  })

  // QG-03 — graph() throws for unknown entity
  it('graph() throws UNKNOWN_MODULES for unregistered entity', async () => {
    await expect(query.graph({ entity: 'nonexistent' }))
      .rejects.toThrow('No resolver registered')
  })

  // QG-04 — graph() passes filters to resolver
  it('graph() passes config to resolver', async () => {
    let receivedConfig: unknown = null

    query.registerResolver('order', async (config) => {
      receivedConfig = config
      return []
    })

    await query.graph({
      entity: 'order',
      fields: ['id', 'total'],
      filters: { status: 'completed' },
      sort: { total: 'desc' },
      pagination: { limit: 10, offset: 5 },
      withDeleted: true,
    })

    const config = receivedConfig as Record<string, unknown>
    expect(config.fields).toEqual(['id', 'total'])
    expect(config.filters).toEqual({ status: 'completed' })
    expect(config.sort).toEqual({ total: 'desc' })
    expect(config.pagination).toEqual({ limit: 10, offset: 5 })
    expect(config.withDeleted).toBe(true)
  })

  // QG-05 — graph() applies default pagination (limit: 100)
  it('graph() uses default pagination limit 100', async () => {
    let receivedPagination: unknown = null

    query.registerResolver('item', async (config) => {
      receivedPagination = config.pagination
      return []
    })

    await query.graph({ entity: 'item' })

    expect(receivedPagination).toEqual({ limit: 100, offset: 0 })
  })

  // QG-06 — graph() entity count protection
  it('graph() throws when exceeding maxTotalEntities', async () => {
    const qs = new QueryService({ maxTotalEntities: 5 })

    qs.registerResolver('big', async () => {
      return Array.from({ length: 10 }, (_, i) => ({ id: String(i) }))
    })

    await expect(qs.graph({ entity: 'big' }))
      .rejects.toThrow('exceeding maximum of 5')
  })

  // QG-07 — dangerouslyUnboundedRelations disables limit
  it('graph() allows exceeding limit with dangerouslyUnboundedRelations', async () => {
    const qs = new QueryService({ maxTotalEntities: 5 })

    qs.registerResolver('big', async () => {
      return Array.from({ length: 10 }, (_, i) => ({ id: String(i) }))
    })

    const result = await qs.graph({
      entity: 'big',
      dangerouslyUnboundedRelations: true,
    })

    expect(result).toHaveLength(10)
  })

  // QG-08 — index() throws without Index module
  it('index() throws UNKNOWN_MODULES without Index module', async () => {
    await expect(query.index({ entity: 'product' }))
      .rejects.toThrow('Index module is not loaded')
  })

  // QG-09 — index() works with registered Index module
  it('index() queries via Index module', async () => {
    const indexResults = [{ id: '1', title: 'Indexed' }]

    query.registerIndexModule({
      query: async () => indexResults,
    })

    const result = await query.index({ entity: 'product' })
    expect(result).toEqual(indexResults)
  })

  // QG-10 — beforeFetch hook short-circuits
  it('beforeFetch hook can short-circuit graph()', async () => {
    let resolverCalled = false

    query.registerResolver('cached', async () => {
      resolverCalled = true
      return [{ id: 'from-db' }]
    })

    query.beforeFetch = async (_module, _query) => {
      return [{ id: 'from-cache' }]
    }

    const result = await query.graph({ entity: 'cached' })
    expect(result).toEqual([{ id: 'from-cache' }])
    expect(resolverCalled).toBe(false)
  })

  // QG-11 — beforeFetch returning null proceeds normally
  it('beforeFetch returning null proceeds to resolver', async () => {
    query.registerResolver('normal', async () => [{ id: 'from-db' }])

    query.beforeFetch = async () => null

    const result = await query.graph({ entity: 'normal' })
    expect(result).toEqual([{ id: 'from-db' }])
  })

  // QG-12 — Case insensitive entity resolution
  it('entity name is case-insensitive', async () => {
    query.registerResolver('Product', async () => [{ id: '1' }])

    const result = await query.graph({ entity: 'product' })
    expect(result).toHaveLength(1)
  })
})
