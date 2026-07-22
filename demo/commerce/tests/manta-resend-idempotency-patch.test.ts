import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendMock = vi.fn()

import { ResendNotificationAdapter } from '@mantajs/adapter-notification-resend'

describe('Manta Resend idempotency compatibility patch', () => {
  beforeEach(() => {
    sendMock.mockReset()
    sendMock.mockResolvedValue({ data: { id: 'message-id' }, error: null, headers: {} })
  })

  it('passes the durable key as the Resend HTTP request option, not an email header', async () => {
    const adapter = new ResendNotificationAdapter({ apiKey: 'test', defaultFrom: 'reports@example.com' })
    const internal = adapter as unknown as { _client: { emails: { send: typeof sendMock } } }
    internal._client.emails.send = sendMock

    await adapter.send({
      channel: 'email',
      to: 'recipient@example.com',
      subject: 'Daily report',
      text: 'Report body',
      headers: { 'List-Unsubscribe': '<https://example.com/unsubscribe>' },
      idempotency_key: 'daily-report:2026-06-16:recipient@example.com',
    })

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'List-Unsubscribe': '<https://example.com/unsubscribe>' },
      }),
      { idempotencyKey: 'daily-report:2026-06-16:recipient@example.com' },
    )
  })
})
