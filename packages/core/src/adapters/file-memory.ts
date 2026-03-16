// SPEC-065/080/081 — InMemoryFileAdapter implements IFilePort

import type { IFilePort } from '../ports'
import { MantaError } from '../errors/manta-error'

export class InMemoryFileAdapter implements IFilePort {
  private _files = new Map<string, { data: Buffer; contentType?: string }>()

  async upload(key: string, data: Buffer | ReadableStream, contentType?: string): Promise<{ key: string; url: string }> {
    const buffer = data instanceof Buffer ? data : Buffer.from(await new Response(data).arrayBuffer())
    this._files.set(key, { data: buffer, contentType })
    return { key, url: `memory://${key}` }
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key]
    for (const k of keys) this._files.delete(k)
  }

  async getPresignedDownloadUrl(key: string): Promise<string> {
    if (!this._files.has(key)) throw new MantaError('NOT_FOUND', `File "${key}" not found`)
    return `memory://download/${key}?token=test`
  }

  async getPresignedUploadUrl(key: string): Promise<string> {
    return `memory://upload/${key}?token=test`
  }

  async getDownloadStream(key: string): Promise<ReadableStream> {
    const file = this._files.get(key)
    if (!file) throw new MantaError('NOT_FOUND', `File "${key}" not found`)
    return new ReadableStream({
      start(controller) {
        controller.enqueue(file.data)
        controller.close()
      },
    })
  }

  async getAsBuffer(key: string): Promise<Buffer> {
    const file = this._files.get(key)
    if (!file) throw new MantaError('NOT_FOUND', `File "${key}" not found`)
    return file.data
  }

  /**
   * Returns a WritableStream that stores the uploaded data in memory.
   * The key is written when the stream is closed.
   */
  async getUploadStream(key: string, contentType?: string): Promise<{ stream: WritableStream; done: Promise<void> }> {
    const chunks: Uint8Array[] = []
    const files = this._files

    let resolveDone: () => void
    const done = new Promise<void>((resolve) => { resolveDone = resolve })

    const stream = new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk)
      },
      close() {
        const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
        const buffer = Buffer.alloc(totalLength)
        let offset = 0
        for (const chunk of chunks) {
          buffer.set(chunk, offset)
          offset += chunk.length
        }
        files.set(key, { data: buffer, contentType })
        resolveDone()
      },
    })

    return { stream, done }
  }

  _reset() { this._files.clear() }
}
