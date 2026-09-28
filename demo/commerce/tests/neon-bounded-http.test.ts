import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const cliRoot = dirname(createRequire(import.meta.url).resolve('@mantajs/cli/package.json'))
const { handleQueryRequest } = await import(
  pathToFileURL(join(cliRoot, 'dist/bootstrap/phases/wire/wire-adapter.js')).href
)

describe('bounded HTTP entity reads', () => {
  it('passes filters, pagination and numeric ordering to storage before projection', async () => {
    const list = vi.fn(() => {
      throw new Error('full-table read')
    })
    const __queryPage = vi.fn(async () => [[{ id: 'p', price: 10, private_payload: 'large' }], 250000])
    const response = await handleQueryRequest({ list, __queryPage }, 'product', {
      filters: { status: ['active', 'ready'] },
      fields: ['id', 'price'],
      order: 'price:desc',
      limit: 1,
      offset: 10,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [{ id: 'p', price: 10 }], count: 250000, limit: 1, offset: 10 })
    expect(__queryPage).toHaveBeenCalledWith({
      where: { status: { $in: ['active', 'ready'] } },
      limit: 1,
      offset: 10,
      order: { price: 'DESC' },
      fields: ['id', 'price'],
      count: undefined,
      search: undefined,
    })
    expect(list).not.toHaveBeenCalled()
  })
  it.each([
    -1,
    1.5,
    10001,
    Infinity,
    NaN,
    '10',
    null,
  ])('rejects invalid limit %s without storage access', async (limit) => {
    const __queryPage = vi.fn()
    const response = await handleQueryRequest({ __queryPage }, 'product', { limit })
    expect(response.status).toBe(400)
    expect(__queryPage).not.toHaveBeenCalled()
  })
  it('returns zero matches for an empty IN without broadening the filter', async () => {
    const __queryPage = vi.fn()
    const response = await handleQueryRequest({ __queryPage }, 'product', { filters: { id: [] } })
    expect(await response.json()).toMatchObject({ data: [], count: 0 })
    expect(__queryPage).not.toHaveBeenCalled()
  })
  it('fails explicitly when a service cannot guarantee bounded reads', async () => {
    const list = vi.fn()
    const response = await handleQueryRequest({ list }, 'product', { limit: 1 })
    expect(response.status).toBe(400)
    expect(list).not.toHaveBeenCalled()
  })
})

describe('bounded read compatibility', () => {
  it('preserves database failures for the server error handler', async () => {
    const __queryPage = vi.fn(async () => {
      throw new Error('database unavailable')
    })
    await expect(handleQueryRequest({ __queryPage }, 'product', {})).rejects.toThrow('database unavailable')
  })
  it('passes substring search to storage instead of rejecting it', async () => {
    const __queryPage = vi.fn(async () => [[{ id: 'p' }], 1])
    const response = await handleQueryRequest({ __queryPage }, 'product', { q: 'shoe', limit: 1 })
    expect(response.status).toBe(200)
    expect(__queryPage).toHaveBeenCalledWith(expect.objectContaining({ search: 'shoe', limit: 1 }))
  })
})
