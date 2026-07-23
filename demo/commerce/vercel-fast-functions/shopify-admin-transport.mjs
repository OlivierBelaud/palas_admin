export const SHOPIFY_ADMIN_DEFAULTS = Object.freeze({
  apiVersion: '2025-10',
  domain: 'fancy-palas.myshopify.com',
  timeoutMs: 10_000,
})

export class ShopifyAdminTransportError extends Error {
  constructor(kind, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined)
    this.name = 'ShopifyAdminTransportError'
    this.kind = kind
    this.status = options.status
    this.retryable = options.retryable ?? false
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function resolveShopifyAdminConfig(overrides = {}, env = process.env) {
  const domain = overrides.domain ?? env.SHOPIFY_SHOP_DOMAIN ?? SHOPIFY_ADMIN_DEFAULTS.domain
  const token = overrides.token ?? env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? env.SHOPIFY_ADMIN_TOKEN ?? env.SHOPIFY_ACCESS_TOKEN
  const apiVersion = overrides.apiVersion ?? env.SHOPIFY_ADMIN_API_VERSION ?? SHOPIFY_ADMIN_DEFAULTS.apiVersion
  const timeoutMs = positiveInteger(
    overrides.timeoutMs ?? env.SHOPIFY_ADMIN_TIMEOUT_MS,
    SHOPIFY_ADMIN_DEFAULTS.timeoutMs,
  )
  if (!domain) {
    throw new ShopifyAdminTransportError('configuration', 'SHOPIFY_SHOP_DOMAIN is not configured')
  }
  if (!token) {
    throw new ShopifyAdminTransportError('authentication', '[shopify-admin] SHOPIFY_ADMIN_ACCESS_TOKEN not set')
  }
  return {
    domain,
    token,
    apiVersion,
    timeoutMs,
    endpoint: `https://${domain}/admin/api/${apiVersion}`,
  }
}

function classifyHttpError(response, detail, method) {
  const suffix = detail ? `: ${detail}` : ''
  if (response.status === 401 || response.status === 403) {
    return new ShopifyAdminTransportError(
      'authentication',
      `Shopify Admin authentication failed (HTTP ${response.status})${suffix}`,
      { status: response.status },
    )
  }
  if (response.status === 404) {
    return new ShopifyAdminTransportError('not_found', `Shopify resource not found${suffix}`, {
      status: response.status,
    })
  }
  if (response.status === 429) {
    return new ShopifyAdminTransportError('rate_limited', `Shopify rate limit exceeded${suffix}`, {
      status: response.status,
      retryable: true,
    })
  }
  if (response.status >= 500) {
    if (method !== 'GET') {
      return new ShopifyAdminTransportError(
        'outcome_unknown',
        `Shopify Admin mutation outcome is unknown (HTTP ${response.status})${suffix}`,
        { status: response.status },
      )
    }
    return new ShopifyAdminTransportError('upstream', `Shopify Admin unavailable (HTTP ${response.status})${suffix}`, {
      status: response.status,
      retryable: true,
    })
  }
  return new ShopifyAdminTransportError(
    'request',
    `Shopify Admin request rejected (HTTP ${response.status})${suffix}`,
    { status: response.status },
  )
}

function isAbort(error) {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

function delay(ms, signal) {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

function requestSignal(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}

export async function shopifyAdminRequest(pathOrUrl, init = {}, options = {}) {
  const config = resolveShopifyAdminConfig(options, options.env)
  const method = (init.method ?? 'GET').toUpperCase()
  const maxAttempts = positiveInteger(options.maxAttempts, 1)
  if (maxAttempts > 1 && method !== 'GET' && !options.allowUnsafeRetry) {
    throw new ShopifyAdminTransportError(
      'configuration',
      `Retries require a safe GET request or allowUnsafeRetry=true (received ${method})`,
    )
  }
  const baseUrl = new URL(`${config.endpoint}/`)
  const url = /^https?:\/\//.test(pathOrUrl)
    ? new URL(pathOrUrl)
    : new URL(String(pathOrUrl).replace(/^\/+/, ''), baseUrl)
  if (url.protocol !== 'https:' || url.hostname !== baseUrl.hostname || !url.pathname.startsWith(baseUrl.pathname)) {
    throw new ShopifyAdminTransportError(
      'configuration',
      `Refusing Shopify Admin credentials for unapproved origin ${url.origin}`,
    )
  }
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const headers =
        init.headers instanceof Headers
          ? Object.fromEntries(init.headers.entries())
          : Array.isArray(init.headers)
            ? Object.fromEntries(init.headers)
            : { ...init.headers }
      const response = await fetch(url.toString(), {
        ...init,
        headers: { ...headers, 'X-Shopify-Access-Token': config.token },
        redirect: 'error',
        signal: requestSignal(init.signal, config.timeoutMs),
      })
      if (response.ok) return response
      const detail = await response.text().catch(() => '')
      const error = classifyHttpError(response, detail, method)
      if (!error.retryable || attempt === maxAttempts) throw error
      lastError = error
    } catch (error) {
      if (error instanceof ShopifyAdminTransportError) {
        if (!error.retryable || attempt === maxAttempts) throw error
        lastError = error
      } else if (init.signal?.aborted) {
        throw new ShopifyAdminTransportError('cancelled', 'Shopify Admin request cancelled', {
          cause: error,
        })
      } else if (isAbort(error)) {
        const timeoutError = new ShopifyAdminTransportError(
          method === 'GET' ? 'timeout' : 'outcome_unknown',
          method === 'GET'
            ? `Shopify Admin request timed out after ${config.timeoutMs}ms`
            : `Shopify Admin mutation outcome is unknown after ${config.timeoutMs}ms`,
          { cause: error, retryable: method === 'GET' },
        )
        if (attempt === maxAttempts) throw timeoutError
        lastError = timeoutError
      } else {
        const networkError = new ShopifyAdminTransportError(
          method === 'GET' ? 'network' : 'outcome_unknown',
          method === 'GET'
            ? `Shopify Admin network failure: ${error instanceof Error ? error.message : String(error)}`
            : 'Shopify Admin mutation outcome is unknown after a network failure',
          { cause: error, retryable: method === 'GET' },
        )
        if (attempt === maxAttempts) throw networkError
        lastError = networkError
      }
    }
    try {
      await delay(options.retryDelayMs ?? 100, init.signal)
    } catch (error) {
      throw new ShopifyAdminTransportError('cancelled', 'Shopify Admin request cancelled', {
        cause: error,
      })
    }
  }
  throw lastError
}

export async function shopifyAdminJson(pathOrUrl, init = {}, options = {}) {
  const method = (init.method ?? 'GET').toUpperCase()
  const maxAttempts = positiveInteger(options.maxAttempts, 1)
  if (maxAttempts > 1 && method !== 'GET' && !options.allowUnsafeRetry) {
    throw new ShopifyAdminTransportError(
      'configuration',
      `Retries require a safe GET request or allowUnsafeRetry=true (received ${method})`,
    )
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await shopifyAdminRequest(pathOrUrl, init, { ...options, maxAttempts: 1 })
      try {
        return { data: await response.json(), response }
      } catch (error) {
        if (init.signal?.aborted) {
          throw new ShopifyAdminTransportError('cancelled', 'Shopify Admin request cancelled', {
            cause: error,
          })
        }
        if (isAbort(error)) {
          throw new ShopifyAdminTransportError(
            method === 'GET' ? 'timeout' : 'outcome_unknown',
            method === 'GET'
              ? 'Shopify Admin response body timed out'
              : 'Shopify Admin mutation outcome is unknown because its response body timed out',
            { cause: error, retryable: method === 'GET' },
          )
        }
        if (!(error instanceof SyntaxError)) {
          throw new ShopifyAdminTransportError(
            method === 'GET' ? 'network' : 'outcome_unknown',
            method === 'GET'
              ? 'Shopify Admin response body failed'
              : 'Shopify Admin mutation outcome is unknown because its response body failed',
            { cause: error, retryable: method === 'GET' },
          )
        }
        throw new ShopifyAdminTransportError('invalid_response', 'Shopify Admin returned invalid JSON', {
          cause: error,
        })
      }
    } catch (error) {
      if (!(error instanceof ShopifyAdminTransportError) || !error.retryable || attempt === maxAttempts) {
        throw error
      }
      try {
        await delay(options.retryDelayMs ?? 100, init.signal)
      } catch (delayError) {
        throw new ShopifyAdminTransportError('cancelled', 'Shopify Admin request cancelled', {
          cause: delayError,
        })
      }
    }
  }
  throw new ShopifyAdminTransportError('network', 'Shopify Admin request exhausted retries')
}

export async function shopifyAdminGraphql(query, variables = {}, options = {}) {
  const { data } = await shopifyAdminJson(
    'graphql.json',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: options.signal,
    },
    options,
  )
  if (!data || typeof data !== 'object') {
    throw new ShopifyAdminTransportError('invalid_response', 'Shopify Admin returned a non-object response')
  }
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    throw new ShopifyAdminTransportError(
      'graphql',
      `Shopify Admin GraphQL error: ${data.errors.map((error) => error?.message ?? String(error)).join(' | ')}`,
    )
  }
  if (!('data' in data) || data.data == null) {
    throw new ShopifyAdminTransportError('invalid_response', 'Shopify Admin response omitted data')
  }
  return data.data
}
