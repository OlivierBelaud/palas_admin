// SPEC-065/080/081 — VercelBlobAdapter implements IFilePort

import type { IFilePort } from '@manta/core'
import { MantaError } from '@manta/core'
import { del, list, put } from '@vercel/blob'

export interface VercelBlobOptions {
  token?: string
}

export class VercelBlobAdapter implements IFilePort {
  private _token: string

  constructor(options: VercelBlobOptions = {}) {
    const token = options.token ?? process.env.BLOB_READ_WRITE_TOKEN
    if (!token) {
      throw new MantaError(
        'INVALID_DATA',
        'VercelBlobAdapter requires BLOB_READ_WRITE_TOKEN (env or constructor options)',
      )
    }
    this._token = token
  }

  async upload(
    key: string,
    data: Buffer | ReadableStream,
    contentType?: string,
  ): Promise<{ key: string; url: string }> {
    // biome-ignore lint/suspicious/noExplicitAny: Buffer/ReadableStream→PutBody compat
    const blobData: any = data instanceof Buffer ? data : data
    const blob = await put(key, blobData, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      token: this._token,
    })
    return { key, url: blob.url }
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key]

    // Vercel Blob del() requires full URLs. Look up each key's URL.
    const urls: string[] = []
    for (const k of keys) {
      const result = await list({ prefix: k, token: this._token, limit: 1 })
      for (const blob of result.blobs) {
        if (blob.pathname === k) {
          urls.push(blob.url)
        }
      }
    }

    if (urls.length > 0) {
      await del(urls, { token: this._token })
    }
  }

  async getPresignedDownloadUrl(key: string): Promise<string> {
    const result = await list({ prefix: key, token: this._token, limit: 1 })
    const blob = result.blobs.find((b) => b.pathname === key)
    if (!blob) {
      throw new MantaError('NOT_FOUND', `File "${key}" not found in Vercel Blob`)
    }
    return blob.url
  }

  async getDownloadStream(key: string): Promise<ReadableStream> {
    const url = await this.getPresignedDownloadUrl(key)
    const response = await fetch(url)
    if (!response.ok || !response.body) {
      throw new MantaError('NOT_FOUND', `Failed to download file "${key}" from Vercel Blob`)
    }
    return response.body
  }

  async getAsBuffer(key: string): Promise<Buffer> {
    const url = await this.getPresignedDownloadUrl(key)
    const response = await fetch(url)
    if (!response.ok) {
      throw new MantaError('NOT_FOUND', `Failed to download file "${key}" from Vercel Blob`)
    }
    return Buffer.from(await response.arrayBuffer())
  }

  async list(prefix?: string): Promise<string[]> {
    const allPaths: string[] = []
    let cursor: string | undefined

    do {
      const result = await list({
        prefix: prefix ?? '',
        token: this._token,
        limit: 1000,
        cursor,
      })
      for (const blob of result.blobs) {
        allPaths.push(blob.pathname)
      }
      cursor = result.cursor ?? undefined
    } while (cursor)

    return allPaths
  }
}
