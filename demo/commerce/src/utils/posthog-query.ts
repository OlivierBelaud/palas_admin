type PosthogProject = {
  id: number | string
  api_token?: string | null
}

const resolvedProjectIds = new Map<string, Promise<string>>()

interface PosthogConnectionOptions {
  host?: string
  privateKey?: string | null
  publicToken?: string | null
  signal?: AbortSignal
}

function cleanBaseUrl(host: string): string {
  return host
    .replace('://eu.i.posthog.com', '://eu.posthog.com')
    .replace('://us.i.posthog.com', '://us.posthog.com')
    .replace(/\/+$/, '')
}

export function posthogHost(): string {
  return cleanBaseUrl(process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com')
}

export function posthogPrivateKey(): string | null {
  return process.env.POSTHOG_PERSONAL_API_KEY ?? process.env.POSTHOG_API_KEY ?? null
}

export async function resolvePosthogProjectId(opts?: PosthogConnectionOptions): Promise<string> {
  const configured = process.env.POSTHOG_PROJECT_ID?.trim()
  if (configured) return configured

  const host = cleanBaseUrl(opts?.host ?? posthogHost())
  const privateKey = opts?.privateKey ?? posthogPrivateKey()
  const publicToken = opts?.publicToken ?? process.env.POSTHOG_TOKEN ?? null
  const cacheKey = `${host}\0${privateKey ?? ''}\0${publicToken ?? ''}`
  let projectId = resolvedProjectIds.get(cacheKey)

  if (!projectId) {
    const current = (async () => {

      if (!privateKey || !publicToken) return '@current'

      const res = await fetch(`${host}/api/projects/`, {
        headers: { Authorization: `Bearer ${privateKey}` },
        signal: opts?.signal,
      })
      if (!res.ok) return '@current'

      const body = (await res.json()) as { results?: PosthogProject[] }
      const match = (body.results ?? []).find((project) => project.api_token === publicToken)
      return match?.id != null ? String(match.id) : '@current'
    })()
    projectId = current
    resolvedProjectIds.set(cacheKey, current)
    current.catch(() => {
      if (resolvedProjectIds.get(cacheKey) === current) resolvedProjectIds.delete(cacheKey)
    })
  }

  return projectId
}

export async function posthogQueryUrl(opts?: PosthogConnectionOptions): Promise<string> {
  const host = cleanBaseUrl(opts?.host ?? posthogHost())
  const projectId = await resolvePosthogProjectId(opts)
  return `${host}/api/projects/${encodeURIComponent(projectId)}/query/`
}

export async function runPosthogHogQL<T = unknown[][]>(
  query: string,
  opts?: PosthogConnectionOptions & {
    refresh?: 'force_blocking' | 'blocking' | 'async' | 'lazy_async'
  },
): Promise<T> {
  const privateKey = opts?.privateKey ?? posthogPrivateKey()
  if (!privateKey) throw new MantaError('INVALID_STATE', 'POSTHOG_API_KEY is required')

  const res = await fetch(await posthogQueryUrl(opts), {
    method: 'POST',
    headers: { Authorization: `Bearer ${privateKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: { kind: 'HogQLQuery', query },
      ...(opts?.refresh ? { refresh: opts.refresh } : {}),
    }),
    signal: opts?.signal,
  })
  if (!res.ok) {
    throw new MantaError('UNEXPECTED_STATE', `PostHog HogQL ${res.status} ${await res.text().catch(() => '')}`)
  }
  const data = (await res.json()) as { results?: T }
  return (data.results ?? ([] as T)) as T
}
