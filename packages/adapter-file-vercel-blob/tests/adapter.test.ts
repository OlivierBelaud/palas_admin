// VercelBlobAdapter — unit tests (@vercel/blob mocked)
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock @vercel/blob
const mockPut = vi.fn()
const mockDel = vi.fn()
const mockList = vi.fn()

vi.mock('@vercel/blob', () => ({
  put: (...args: unknown[]) => mockPut(...args),
  del: (...args: unknown[]) => mockDel(...args),
  list: (...args: unknown[]) => mockList(...args),
}))

import { VercelBlobAdapter } from '../src'

describe('VercelBlobAdapter', () => {
  let adapter: VercelBlobAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new VercelBlobAdapter({ token: 'fake-token' })
  })

  // F-01 — upload returns key and url
  it('upload > returns key and url', async () => {
    mockPut.mockResolvedValue({ url: 'https://blob.vercel.com/test.txt', pathname: 'test.txt' })

    const result = await adapter.upload('test.txt', Buffer.from('hello'), 'text/plain')

    expect(result.key).toBe('test.txt')
    expect(result.url).toBe('https://blob.vercel.com/test.txt')
    expect(mockPut).toHaveBeenCalledWith('test.txt', expect.anything(), {
      access: 'public',
      contentType: 'text/plain',
      addRandomSuffix: false,
      token: 'fake-token',
    })
  })

  // F-02 — delete looks up URL and calls del
  it('delete > looks up blob URL and deletes', async () => {
    mockList.mockResolvedValue({
      blobs: [{ pathname: 'test.txt', url: 'https://blob.vercel.com/test.txt' }],
    })
    mockDel.mockResolvedValue(undefined)

    await adapter.delete('test.txt')

    expect(mockList).toHaveBeenCalled()
    expect(mockDel).toHaveBeenCalledWith(['https://blob.vercel.com/test.txt'], { token: 'fake-token' })
  })

  // F-03 — getPresignedDownloadUrl returns blob URL
  it('getPresignedDownloadUrl > returns blob URL', async () => {
    mockList.mockResolvedValue({
      blobs: [{ pathname: 'test.txt', url: 'https://blob.vercel.com/test.txt' }],
    })

    const url = await adapter.getPresignedDownloadUrl('test.txt')
    expect(url).toBe('https://blob.vercel.com/test.txt')
  })

  // F-03b — getPresignedDownloadUrl throws NOT_FOUND
  it('getPresignedDownloadUrl > throws NOT_FOUND for missing file', async () => {
    mockList.mockResolvedValue({ blobs: [] })

    await expect(adapter.getPresignedDownloadUrl('nonexistent.txt')).rejects.toThrow()
  })

  // list with pagination
  it('list > returns all pathnames with pagination', async () => {
    mockList
      .mockResolvedValueOnce({
        blobs: [{ pathname: 'a.txt' }, { pathname: 'b.txt' }],
        cursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        blobs: [{ pathname: 'c.txt' }],
        cursor: null,
      })

    const result = await adapter.list()
    expect(result).toEqual(['a.txt', 'b.txt', 'c.txt'])
  })

  // Constructor validation
  it('constructor > throws without token', () => {
    expect(() => new VercelBlobAdapter({ token: '' })).toThrow()
  })
})
