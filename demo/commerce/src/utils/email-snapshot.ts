import { createHash } from 'node:crypto'

import type { RuntimeFilePort } from './manta-runtime'

export interface EmailSnapshotInput {
  messageId: string
  subject: string
  html: string
  text: string
  sentAt?: Date
}

export interface EmailSnapshotResult {
  html_key: string | null
  html_url: string | null
  text_key: string | null
  text_url: string | null
  subject: string
  sha256: string
  saved_at: Date | null
  error: string | null
}

export async function archiveEmailSnapshot(
  file: RuntimeFilePort | null | undefined,
  input: EmailSnapshotInput,
): Promise<EmailSnapshotResult> {
  const sha256 = hashSnapshot(input)
  if (!file) {
    return emptyResult(input.subject, sha256, 'IFilePort not available')
  }

  const sentAt = input.sentAt ?? new Date()
  const day = sentAt.toISOString().slice(0, 10)
  const prefix = `email-snapshots/abandoned-cart/${day}/${input.messageId}`
  const htmlKey = `${prefix}.html`
  const textKey = `${prefix}.txt`

  try {
    const [html, text] = await Promise.all([
      file.upload(htmlKey, Buffer.from(input.html, 'utf8'), 'text/html; charset=utf-8'),
      file.upload(textKey, Buffer.from(input.text, 'utf8'), 'text/plain; charset=utf-8'),
    ])
    return {
      html_key: html.key,
      html_url: html.url,
      text_key: text.key,
      text_url: text.url,
      subject: input.subject,
      sha256,
      saved_at: sentAt,
      error: null,
    }
  } catch (err) {
    return emptyResult(input.subject, sha256, (err as Error).message)
  }
}

function emptyResult(subject: string, sha256: string, error: string): EmailSnapshotResult {
  return {
    html_key: null,
    html_url: null,
    text_key: null,
    text_url: null,
    subject,
    sha256,
    saved_at: null,
    error,
  }
}

function hashSnapshot(input: EmailSnapshotInput): string {
  return createHash('sha256')
    .update(input.subject)
    .update('\n---html---\n')
    .update(input.html)
    .update('\n---text---\n')
    .update(input.text)
    .digest('hex')
}
