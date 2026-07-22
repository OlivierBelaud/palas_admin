import { describe, expect, it, vi } from 'vitest'
import { runAfterKlaviyoProjectionSync } from '../klaviyo-synchronized-campaign'

describe('runAfterKlaviyoProjectionSync', () => {
  it('awaits a fresh sync before starting the campaign', async () => {
    const order: string[] = []

    const result = await runAfterKlaviyoProjectionSync(
      async () => {
        order.push('sync')
      },
      async () => {
        order.push('campaign')
        return 'sent'
      },
    )

    expect(result).toBe('sent')
    expect(order).toEqual(['sync', 'campaign'])
  })

  it('never starts the campaign when the provider sync fails', async () => {
    const campaign = vi.fn()
    const onError = vi.fn()

    await expect(
      runAfterKlaviyoProjectionSync(
        async () => {
          throw new Error('PostHog unavailable')
        },
        campaign,
        onError,
      ),
    ).rejects.toThrow('PostHog unavailable')

    expect(campaign).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('sync', expect.objectContaining({ message: 'PostHog unavailable' }))
  })

  it('reports campaign failures separately from sync failures', async () => {
    const onError = vi.fn()

    await expect(
      runAfterKlaviyoProjectionSync(
        async () => {},
        async () => {
          throw new Error('campaign database unavailable')
        },
        onError,
      ),
    ).rejects.toThrow('campaign database unavailable')

    expect(onError).toHaveBeenCalledWith(
      'campaign',
      expect.objectContaining({ message: 'campaign database unavailable' }),
    )
  })

  it('makes an event created after the scheduled sync visible before campaign arbitration', async () => {
    const upstream: string[] = []
    const projection: string[] = []
    const sync = async () => {
      projection.splice(0, projection.length, ...upstream)
    }

    await sync()
    upstream.push('klaviyo-email-between-sync-and-campaign')

    const decision = await runAfterKlaviyoProjectionSync(sync, async () =>
      projection.includes('klaviyo-email-between-sync-and-campaign') ? 'skip' : 'send',
    )

    expect(decision).toBe('skip')
  })
})
