// FileService — convenience wrapper around IFilePort for demo scenario
// Provides write/exists/list/delete that the demo spec expects

import type { IFilePort } from '@manta/core'

export class FileService {
  constructor(private filePort: IFilePort) {}

  async write(key: string, content: Buffer | string): Promise<string> {
    const data = typeof content === 'string' ? Buffer.from(content) : content
    const result = await this.filePort.upload(key, data)
    return result.url
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.filePort.getAsBuffer(key)
      return true
    } catch {
      return false
    }
  }

  async list(prefix: string): Promise<string[]> {
    // InMemoryFileAdapter stores by key — we access the internal _files map
    // For a real adapter this would call a list API
    const adapter = this.filePort as Record<string, unknown>
    if (adapter._files instanceof Map) {
      const files = adapter._files as Map<string, unknown>
      return Array.from(files.keys()).filter(k => k.startsWith(prefix))
    }
    return []
  }

  async delete(key: string): Promise<void> {
    await this.filePort.delete(key)
  }

  async read(key: string): Promise<Buffer> {
    return this.filePort.getAsBuffer(key)
  }
}
