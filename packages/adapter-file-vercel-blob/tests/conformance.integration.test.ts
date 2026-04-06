// VercelBlobAdapter — IFilePort conformance (requires real BLOB_READ_WRITE_TOKEN)
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const SKIP = !process.env.BLOB_READ_WRITE_TOKEN

import type { IFilePort } from '@manta/core'
import { VercelBlobAdapter } from '../src'

describe.skipIf(SKIP)('VercelBlobAdapter — IFilePort conformance', () => {
  let file: IFilePort
  const testPrefix = `manta-test-${Date.now()}/`

  beforeEach(() => {
    file = new VercelBlobAdapter()
  })

  afterAll(async () => {
    // Cleanup test files
    if (!SKIP) {
      const adapter = new VercelBlobAdapter()
      const files = await adapter.list(testPrefix)
      if (files.length > 0) {
        await adapter.delete(files)
      }
    }
  })

  it('F-01 — upload/get roundtrip', async () => {
    const key = `${testPrefix}test.txt`
    const content = Buffer.from('hello world')
    const result = await file.upload(key, content, 'text/plain')

    expect(result.key).toBe(key)
    expect(typeof result.url).toBe('string')

    const retrieved = await file.getAsBuffer(key)
    expect(retrieved.toString()).toBe('hello world')
  })

  it('F-03 — presigned download URL is valid', async () => {
    const key = `${testPrefix}presigned.txt`
    await file.upload(key, Buffer.from('data'))
    const url = await file.getPresignedDownloadUrl(key)
    expect(typeof url).toBe('string')
    expect(url.length).toBeGreaterThan(0)
  })

  it('F-03b — presigned download for nonexistent file throws', async () => {
    await expect(file.getPresignedDownloadUrl(`${testPrefix}nonexistent-12345.txt`)).rejects.toThrow()
  })
})
