import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error The standalone Node .mjs CLI intentionally has no TypeScript declarations.
import { bootstrapGoogleAdsOAuth } from '../scripts/google-ads-oauth.mjs'

const realFetch = globalThis.fetch
const directories: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'palas-oauth-'))
  directories.push(directory)
  const credentialsPath = join(directory, 'desktop.json')
  await writeFile(
    credentialsPath,
    JSON.stringify({ installed: { client_id: 'desktop-client', client_secret: 'desktop-secret' } }),
  )
  return { credentialsPath, outputPath: join(directory, '.env.google-ads') }
}

describe('Google Ads local OAuth bootstrap', () => {
  it('uses loopback, PKCE/state and offline datamanager scope then saves private credentials without logging tokens', async () => {
    const paths = await fixture()
    const tokenFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ refresh_token: 'refresh-token', scope: 'https://www.googleapis.com/auth/datamanager' }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', tokenFetch)
    let authorization: URL | undefined
    await bootstrapGoogleAdsOAuth({
      ...paths,
      onAuthorizationUrl: async (link: string) => {
        authorization = new URL(link)
        const callback = new URL(authorization.searchParams.get('redirect_uri')!)
        expect(callback.hostname).toBe('127.0.0.1')
        callback.searchParams.set('state', 'wrong-state')
        callback.searchParams.set('code', 'code')
        expect((await realFetch(callback)).status).toBe(400)
        callback.searchParams.set('state', authorization.searchParams.get('state')!)
        expect((await realFetch(callback)).status).toBe(200)
      },
    })
    expect(authorization?.origin).toBe('https://accounts.google.com')
    expect(authorization?.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/datamanager')
    expect(authorization?.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorization?.searchParams.get('access_type')).toBe('offline')
    expect(authorization?.searchParams.get('prompt')).toBe('consent')
    expect(tokenFetch.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token')
    expect(tokenFetch.mock.calls[0][1].body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    expect(await readFile(paths.outputPath, 'utf8')).toContain('GOOGLE_ADS_REFRESH_TOKEN="refresh-token"')
    expect((await stat(paths.outputPath)).mode & 0o777).toBe(0o600)
  })
  it('never overwrites an existing output file', async () => {
    const paths = await fixture()
    await writeFile(paths.outputPath, 'keep me')
    const show = vi.fn()
    await expect(bootstrapGoogleAdsOAuth({ ...paths, onAuthorizationUrl: show })).rejects.toThrow('output file')
    expect(show).not.toHaveBeenCalled()
    expect(await readFile(paths.outputPath, 'utf8')).toBe('keep me')
  })
  it('refuses web client credentials', async () => {
    const paths = await fixture()
    await writeFile(paths.credentialsPath, JSON.stringify({ web: { client_id: 'web', client_secret: 'secret' } }))
    await expect(bootstrapGoogleAdsOAuth(paths)).rejects.toThrow('Desktop')
  })
  it('cleans up on denied consent without exchanging or persisting tokens', async () => {
    const paths = await fixture()
    const tokenFetch = vi.fn()
    vi.stubGlobal('fetch', tokenFetch)
    await expect(
      bootstrapGoogleAdsOAuth({
        ...paths,
        onAuthorizationUrl: async (link: string) => {
          const authorization = new URL(link)
          const callback = new URL(authorization.searchParams.get('redirect_uri')!)
          callback.searchParams.set('state', authorization.searchParams.get('state')!)
          callback.searchParams.set('error', 'access_denied')
          await realFetch(callback)
        },
      }),
    ).rejects.toThrow('denied')
    expect(tokenFetch).not.toHaveBeenCalled()
    await expect(stat(paths.outputPath)).rejects.toThrow()
  })
  it('sanitizes token-exchange failures and removes the reserved file', async () => {
    const paths = await fixture()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'secret-token-value' }), { status: 400 })),
    )
    await expect(
      bootstrapGoogleAdsOAuth({
        ...paths,
        onAuthorizationUrl: async (link: string) => {
          const authorization = new URL(link)
          const callback = new URL(authorization.searchParams.get('redirect_uri')!)
          callback.searchParams.set('state', authorization.searchParams.get('state')!)
          callback.searchParams.set('code', 'code')
          await realFetch(callback)
        },
      }),
    ).rejects.toThrow('Google token exchange failed')
    await expect(stat(paths.outputPath)).rejects.toThrow()
  })
  it('times out and closes its listener', async () => {
    const paths = await fixture()
    await expect(bootstrapGoogleAdsOAuth({ ...paths, timeoutMs: 20, onAuthorizationUrl: () => {} })).rejects.toThrow(
      'timed out',
    )
    await expect(stat(paths.outputPath)).rejects.toThrow()
  })
})
