import type { IFilePort, TestMantaApp } from '@manta/core'
import {
  createTestMantaApp,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryLockingAdapter,
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

describe('IFilePort Conformance', () => {
  let file: IFilePort
  let app: TestMantaApp

  beforeEach(() => {
    app = createTestMantaApp({ infra: makeInfra() })
    file = app.infra.file
  })

  afterEach(async () => {
    await app.dispose()
  })

  // F-01 — SPEC-065/080: upload/get roundtrip
  it('upload/get > roundtrip', async () => {
    const content = Buffer.from('hello world')
    const result = await file.upload('test.txt', content, 'text/plain')

    expect(result.key).toBe('test.txt')
    expect(typeof result.url).toBe('string')

    const retrieved = await file.getAsBuffer('test.txt')
    expect(retrieved).toEqual(content)
  })

  // F-02 — SPEC-065: delete removes file
  it('delete > suppression', async () => {
    await file.upload('test.txt', Buffer.from('data'))
    await file.delete('test.txt')

    await expect(file.getAsBuffer('test.txt')).rejects.toThrow()
  })

  // F-03 — SPEC-081: presigned download URL is valid string
  it('presigned download > URL valide', async () => {
    await file.upload('test.txt', Buffer.from('data'))
    const url = await file.getPresignedDownloadUrl('test.txt')

    expect(typeof url).toBe('string')
    expect(url.length).toBeGreaterThan(0)
  })

  // F-04 — SPEC-081: presigned upload URL
  it('presigned upload > URL valide', async () => {
    const url = await file.getPresignedUploadUrl!('upload-target.txt')
    expect(typeof url).toBe('string')
    expect(url.length).toBeGreaterThan(0)
    expect(url).toContain('upload-target.txt')
  })

  // F-05 — SPEC-065: download stream returns correct content
  it('stream > download', async () => {
    const content = Buffer.from('stream content')
    await file.upload('stream.txt', content)

    const stream = await file.getDownloadStream('stream.txt')
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []

    let done = false
    while (!done) {
      const result = await reader.read()
      if (result.value) chunks.push(result.value)
      done = result.done
    }

    const downloaded = Buffer.concat(chunks)
    expect(downloaded).toEqual(content)
  })

  // F-06 — SPEC-065: upload stream writes correct content
  it('stream > upload', async () => {
    expect(file.getUploadStream).toBeDefined()
    const { stream, done } = await file.getUploadStream!('streamed.txt')
    const writer = stream.getWriter()
    const encoder = new TextEncoder()

    await writer.write(encoder.encode('Hello '))
    await writer.write(encoder.encode('World'))
    await writer.close()
    await done

    const buffer = await file.getAsBuffer('streamed.txt')
    expect(buffer.toString()).toBe('Hello World')
  })

  // F-07 — SPEC-065: large file upload (10MB)
  it('upload > fichier volumineux', async () => {
    const tenMB = Buffer.alloc(10 * 1024 * 1024, 0x42) // 10MB of 'B'
    const result = await file.upload('large.bin', tenMB, 'application/octet-stream')

    expect(result.key).toBe('large.bin')

    const retrieved = await file.getAsBuffer('large.bin')
    expect(retrieved.length).toBe(tenMB.length)
    expect(retrieved).toEqual(tenMB)
  })

  // F-08 — SPEC-065: get nonexistent file throws NOT_FOUND
  it('get > fichier inexistant', async () => {
    await expect(file.getAsBuffer('nonexistent.txt')).rejects.toThrow()
  })

  // F-02b — SPEC-065: delete multiple files at once
  it('delete > suppression multiple', async () => {
    await file.upload('a.txt', Buffer.from('a'))
    await file.upload('b.txt', Buffer.from('b'))

    await file.delete(['a.txt', 'b.txt'])

    await expect(file.getAsBuffer('a.txt')).rejects.toThrow()
    await expect(file.getAsBuffer('b.txt')).rejects.toThrow()
  })

  // F-03b — SPEC-081: presigned download URL for nonexistent file throws
  it('presigned download > fichier inexistant', async () => {
    await expect(file.getPresignedDownloadUrl('nonexistent.txt')).rejects.toThrow()
  })
})
