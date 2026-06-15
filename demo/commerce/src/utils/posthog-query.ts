type PosthogProject = {
  id: number | string
  api_token?: string | null
}

let resolvedProjectId: Promise<string> | null = null

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

export async function resolvePosthogProjectId(opts?: {
  host?: string
  privateKey?: string | null
  publicToken?: string | null
}): Promise<string> {
  const configured = process.env.POSTHOG_PROJECT_ID?.trim()
  if (configured) return configured

  if (!resolvedProjectId) {
    resolvedProjectId = (async () => {
      const host = cleanBaseUrl(opts?.host ?? posthogHost())
      const privateKey = opts?.privateKey ?? posthogPrivateKey()
      const publicToken = opts?.publicToken ?? process.env.POSTHOG_TOKEN ?? null

      if (!privateKey || !publicToken) return '@current'

      const res = await fetch(`${host}/api/projects/`, {
        headers: { Authorization: `Bearer ${privateKey}` },
      })
      if (!res.ok) return '@current'

      const body = (await res.json()) as { results?: PosthogProject[] }
      const match = (body.results ?? []).find((project) => project.api_token === publicToken)
      return match?.id != null ? String(match.id) : '@current'
    })()
  }

  return resolvedProjectId
}

export async function posthogQueryUrl(opts?: {
  host?: string
  privateKey?: string | null
  publicToken?: string | null
}): Promise<string> {
  const host = cleanBaseUrl(opts?.host ?? posthogHost())
  const projectId = await resolvePosthogProjectId(opts)
  return `${host}/api/projects/${encodeURIComponent(projectId)}/query/`
}

export async function runPosthogHogQL<T = unknown[][]>(
  query: string,
  opts?: {
    host?: string
    privateKey?: string | null
    publicToken?: string | null
    refresh?: 'force_blocking' | 'blocking' | 'async' | 'lazy_async'
    signal?: AbortSignal
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
