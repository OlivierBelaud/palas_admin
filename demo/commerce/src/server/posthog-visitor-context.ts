import { isIP } from 'node:net'
import { POST } from '@mantajs/plugin-posthog-proxy/src/modules/posthog/api/[...path]/route.js'

type EventApp = { emit: (name: string, data: unknown) => Promise<unknown> }

// CRM compatibility for the pinned beta.12 proxy, which emits the body without
// its HTTP context. Keep the upstream proxy (identity, carts, gzip and CORS).
// This facade belongs to one request; never patch the shared application's emit.
export function posthogWithVisitorContext(request: Request, app: EventApp): Promise<Response> {
  // Vercel supplies x-forwarded-for. Only use its first hop; never substitute a
  // later proxy address when the visitor address is invalid.
  const candidate = (request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip'))?.split(',')[0]?.trim()
  const clientIp =
    candidate && isIP(candidate) && candidate !== '0.0.0.0' && !/^[0:]+$/.test(candidate) ? candidate : undefined
  const userAgent = request.headers.get('user-agent')?.trim().slice(0, 1024) || undefined
  const context = {
    ...(clientIp && { client_ip: clientIp }),
    ...(userAgent && { user_agent: userAgent }),
  }

  Object.defineProperty(request, 'app', {
    configurable: true,
    value: {
      emit(name: string, data: unknown) {
        return app.emit(
          name,
          name === 'posthog.events.received' ? { ...(data as Record<string, unknown>), context } : data,
        )
      },
    },
  })
  return POST(request)
}
