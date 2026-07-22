import { afterEach, describe, expect, it, vi } from 'vitest'

async function freshModule() {
  vi.resetModules()
  delete process.env.POSTHOG_PROJECT_ID
  return import('./posthog-query')
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.POSTHOG_PROJECT_ID
})

describe('PostHog project resolution in warm runtimes', () => {
  it('shares a concurrent lookup and reuses its successful result', async () => {
    let release: (() => void) | undefined
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () =>
            resolve(
              Response.json({
                results: [{ id: 42, api_token: 'public-token' }],
              }),
            )
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { resolvePosthogProjectId } = await freshModule()
    const opts = { host: 'https://eu.posthog.com', privateKey: 'private-key', publicToken: 'public-token' }

    const first = resolvePosthogProjectId(opts)
    const second = resolvePosthogProjectId(opts)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    release?.()

    await expect(Promise.all([first, second])).resolves.toEqual(['42', '42'])
    await expect(resolvePosthogProjectId(opts)).resolves.toBe('42')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('evicts a rejected lookup so a warm instance can recover', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary DNS failure'))
      .mockResolvedValueOnce(Response.json({ results: [{ id: 7, api_token: 'public-token' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const { resolvePosthogProjectId } = await freshModule()
    const opts = { host: 'https://eu.posthog.com', privateKey: 'private-key', publicToken: 'public-token' }

    await expect(resolvePosthogProjectId(opts)).rejects.toThrow('temporary DNS failure')
    await expect(resolvePosthogProjectId(opts)).resolves.toBe('7')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('isolates cached project ids by PostHog configuration', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ results: [{ id: 11, api_token: 'token-a' }] }))
      .mockResolvedValueOnce(Response.json({ results: [{ id: 22, api_token: 'token-b' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const { resolvePosthogProjectId } = await freshModule()

    await expect(
      resolvePosthogProjectId({ host: 'https://a.posthog.test', privateKey: 'key-a', publicToken: 'token-a' }),
    ).resolves.toBe('11')
    await expect(
      resolvePosthogProjectId({ host: 'https://b.posthog.test', privateKey: 'key-b', publicToken: 'token-b' }),
    ).resolves.toBe('22')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
