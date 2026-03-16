// SPEC-065/080/081 — IFilePort interface

/**
 * File storage port contract.
 * Adapters: LocalFileAdapter (dev), VercelBlobAdapter (prod).
 */
export interface IFilePort {
  /**
   * Upload a file.
   * @param key - The file key/path
   * @param data - The file content as Buffer or ReadableStream
   * @param contentType - Optional MIME type
   * @returns The stored key and public URL
   */
  upload(key: string, data: Buffer | ReadableStream, contentType?: string): Promise<{ key: string; url: string }>

  /**
   * Delete one or more files.
   * @param key - Single key or array of keys
   */
  delete(key: string | string[]): Promise<void>

  /**
   * Get a presigned URL for downloading a file.
   * @param key - The file key
   * @returns The presigned download URL
   */
  getPresignedDownloadUrl(key: string): Promise<string>

  /**
   * Optional: get a presigned URL for uploading a file.
   * @param key - The file key
   * @returns The presigned upload URL
   */
  getPresignedUploadUrl?(key: string): Promise<string>

  /**
   * Get a readable stream for downloading a file.
   * @param key - The file key
   * @returns A ReadableStream of the file content
   */
  getDownloadStream(key: string): Promise<ReadableStream>

  /**
   * Get file content as a Buffer.
   * @param key - The file key
   * @returns The file content as Buffer
   */
  getAsBuffer(key: string): Promise<Buffer>

  /**
   * Optional: get a writable stream for uploading a file.
   * @param key - The file key
   * @returns An object with the writable stream and a done promise
   */
  getUploadStream?(key: string): Promise<{ stream: WritableStream; done: Promise<void> }>
}
