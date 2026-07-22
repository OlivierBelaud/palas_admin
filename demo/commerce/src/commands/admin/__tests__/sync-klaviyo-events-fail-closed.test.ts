import { beforeAll, describe, expect, it, vi } from 'vitest'

const runPosthogHogQL = vi.fn()

vi.mock('../../../utils/posthog-query', () => ({
  posthogPrivateKey: () => 'phx_test',
  runPosthogHogQL,
}))

beforeAll(() => {
  vi.stubGlobal('defineCommand', (definition: unknown) => definition)
  vi.stubGlobal('z', {
    object: (shape: unknown) => shape,
    boolean: () => ({ default: () => ({}) }),
  })
})

describe('pullEventsFromHogQL', () => {
  it('propagates provider failure instead of reporting a successful empty projection', async () => {
    runPosthogHogQL.mockRejectedValueOnce(new Error('PostHog unavailable'))
    const { pullEventsFromHogQL } = await import('../sync-klaviyo-events')

    await expect(
      pullEventsFromHogQL({
        sinceIso: '2026-07-22T16:00:00.000Z',
        throughIso: '2026-07-22T17:00:00.000Z',
        warn: () => {},
      }),
    ).rejects.toThrow('PostHog unavailable')
  })

  it('queries a stable interval bounded by the advertised coverage watermark', async () => {
    runPosthogHogQL.mockResolvedValueOnce([])
    const { pullEventsFromHogQL } = await import('../sync-klaviyo-events')

    await pullEventsFromHogQL({
      sinceIso: '2026-07-22T16:00:00.000Z',
      throughIso: '2026-07-22T17:00:00.000Z',
      warn: () => {},
    })

    expect(runPosthogHogQL).toHaveBeenLastCalledWith(
      expect.stringContaining("ke.datetime <= '2026-07-22T17:00:00'"),
      expect.any(Object),
    )
  })
})
