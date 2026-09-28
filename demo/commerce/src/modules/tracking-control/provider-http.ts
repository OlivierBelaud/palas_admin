import type { ControlWindow, EvidenceSection, EvidenceState } from './types'

export const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
export const identifier = (value: unknown): string | null =>
  typeof value === 'string' && /^\d{1,32}$/.test(value) ? value : null
export const eventName = (value: unknown): string | null =>
  typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_.: -]{0,99}$/.test(value) ? value : null
export function number(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}
export class ReadError extends Error {
  constructor(
    public state: EvidenceState,
    message: string,
  ) {
    super(message)
  }
}

// Never use connector endpoint overrides for authenticated diagnostics. Do not follow
// provider pagination URLs, redirects, or include upstream error bodies in public output.
const ORIGINS = new Set([
  'https://graph.facebook.com',
  'https://oauth2.googleapis.com',
  'https://datamanager.googleapis.com',
  'https://api.pinterest.com',
  'https://analyticsdata.googleapis.com',
])
export async function readJson(url: URL, init: RequestInit, fetcher: typeof fetch): Promise<unknown> {
  if (!ORIGINS.has(url.origin)) throw new ReadError('error', 'Origine de lecture invalide.')
  const controller = new AbortController()
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        const response = await fetcher(url, { ...init, redirect: 'error', signal: controller.signal })
        const graphError = url.origin === 'https://graph.facebook.com' && response.status === 400
        if (!response.ok && !graphError) {
          if (response.status === 401 || response.status === 403)
            throw new ReadError(
              'permission_denied',
              'Accès de lecture refusé. Vérifier les droits du token sur cette ressource.',
            )
          if (response.status === 429)
            throw new ReadError('rate_limited', 'Quota de lecture atteint. Réessayer plus tard.')
          if (response.status === 404)
            throw new ReadError('unavailable', 'Ressource ou capacité de lecture indisponible pour ce compte.')
          throw new ReadError('error', `Lecture distante refusée (HTTP ${response.status}).`)
        }
        const reader = response.body?.getReader()
        if (!reader) throw new ReadError('error', 'Réponse distante vide.')
        activeReader = reader
        const decoder = new TextDecoder()
        let raw = ''
        let bytes = 0
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            bytes += value.byteLength
            if (bytes > 1_000_000) {
              controller.abort()
              void reader.cancel().catch(() => {})
              throw new ReadError('error', 'Réponse distante trop volumineuse.')
            }
            raw += decoder.decode(value, { stream: true })
          }
          raw += decoder.decode()
        } finally {
          reader.releaseLock()
          activeReader = undefined
        }
        try {
          const parsed: unknown = JSON.parse(raw)
          if (graphError) {
            const code = number(object(object(parsed).error).code)
            if ([10, 190, 200].includes(code ?? -1))
              throw new ReadError(
                'permission_denied',
                'Meta refuse la lecture. Vérifier le token et son accès au pixel.',
              )
            if ([4, 17, 32, 613].includes(code ?? -1))
              throw new ReadError('rate_limited', 'Quota de lecture Meta atteint. Réessayer plus tard.')
            if (code === 100)
              throw new ReadError(
                'unavailable',
                'Meta ne permet pas cette lecture pour ce pixel ou ces paramètres (code 100).',
              )
            throw new ReadError('error', 'Lecture Meta refusée (HTTP 400). Vérifier la configuration de lecture.')
          }
          return parsed
        } catch (error) {
          if (error instanceof ReadError) throw error
          throw new ReadError('error', 'Réponse distante non interprétable.')
        }
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort()
          void activeReader?.cancel().catch(() => {})
          reject(new ReadError('unavailable', 'Délai de lecture dépassé. Réessayer plus tard.'))
        }, 7_000)
      }),
    ])
  } catch (error) {
    if (error instanceof ReadError) throw error
    throw new ReadError('unavailable', 'Lecture distante indisponible. Réessayer plus tard.')
  } finally {
    clearTimeout(timeout)
  }
}

export function section(
  key: string,
  title: string,
  source: string,
  window: ControlWindow | null = null,
): EvidenceSection {
  return {
    key,
    title,
    source,
    window,
    state: 'available',
    fetched_at: null,
    granularity: 'Non déterminée',
    provenance: 'Périmètre non déterminé',
    message: '',
    limitations: [],
    rows: [],
  }
}
export async function evidence(base: EvidenceSection, read: () => Promise<EvidenceSection>): Promise<EvidenceSection> {
  try {
    return { ...(await read()), fetched_at: new Date().toISOString() }
  } catch (error) {
    const safe = error instanceof ReadError ? error : new ReadError('error', 'Réponse distante non interprétable.')
    return { ...base, state: safe.state, message: safe.message, fetched_at: new Date().toISOString() }
  }
}
export const missing = (base: EvidenceSection, message: string): EvidenceSection => ({
  ...base,
  state: 'not_configured',
  message,
})
export const bearer = (token: string): RequestInit => ({ headers: { Authorization: `Bearer ${token}` } })
export function malformed(): never {
  throw new ReadError('error', 'Format de réponse inattendu. Aucune réception ne peut être confirmée.')
}

export async function googleToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  fetcher: typeof fetch,
): Promise<string> {
  const result = object(
    await readJson(
      new URL('https://oauth2.googleapis.com/token'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
      },
      fetcher,
    ),
  )
  if (typeof result.access_token !== 'string' || !result.access_token || result.access_token.length > 16384) malformed()
  return result.access_token
}
