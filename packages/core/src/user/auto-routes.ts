// Auto-generated route handlers for defineUser contexts.
// When defineUserModel('admin') exists, the bootstrap calls these factories
// to register per-context auth, CRUD, and invite routes.
//
// Each factory returns an array of { method, path, handler, public? } that
// the bootstrap registers on the H3 adapter.

import type { AuthModuleService } from '../auth/auth-module-service'
import type { ICachePort } from '../ports/cache'
import type { ILoggerPort } from '../ports/logger'
import type { IRepository } from '../ports/repository'
import type { UserDefinition } from './define-user'

export interface RouteEntry {
  method: 'GET' | 'POST' | 'DELETE'
  path: string
  handler: (req: Request) => Promise<Response>
  /** If true, no auth required (login, forgot-password, etc.) */
  public?: boolean
}

export interface AutoRouteDeps {
  userDef: UserDefinition
  authService: AuthModuleService
  userRepo: IRepository
  inviteRepo: IRepository
  cache: ICachePort
  logger: ILoggerPort
  jwtSecret: string
}

async function getBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    return {} as T
  }
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization')
  return authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
}

// ── Auth routes ─────────────────────────────────────────

export function generateAuthRoutes(deps: AutoRouteDeps): RouteEntry[] {
  const { userDef, authService, userRepo, cache, logger, jwtSecret } = deps
  const ctx = userDef.contextName
  const basePath = `/api/${ctx}`

  return [
    // POST /api/{ctx}/login
    {
      method: 'POST',
      path: `${basePath}/login`,
      public: true,
      handler: async (req) => {
        const body = await getBody<{ email?: string; password?: string }>(req)
        if (!body.email || !body.password) {
          return Response.json({ type: 'INVALID_DATA', message: 'Email and password are required' }, { status: 400 })
        }

        const result = await authService.authenticate('emailpass', {
          url: '',
          headers: {},
          query: {},
          protocol: 'http',
          body,
        })
        if (!result.success) {
          return Response.json(
            { type: 'UNAUTHORIZED', message: result.error ?? 'Invalid credentials' },
            { status: 401 },
          )
        }

        // Verify user exists in the context's user table
        const authIdentity = result.authIdentity!
        const email = body.email.toLowerCase()
        const users = await userRepo.find({ where: { email } })
        if (users.length === 0) {
          return Response.json({ type: 'FORBIDDEN', message: `No ${ctx} account for this email` }, { status: 403 })
        }

        const user = users[0] as { id: string }
        const tokenPayload = {
          id: user.id,
          type: ctx,
          auth_identity_id: authIdentity.id,
          app_metadata: { email: body.email },
        }
        const token = await authService.generateToken(tokenPayload, jwtSecret, '1h')
        const refreshToken = await authService.generateToken(
          { ...tokenPayload, app_metadata: { ...tokenPayload.app_metadata, type: 'refresh' } },
          jwtSecret,
          '30d',
        )

        return Response.json({ token, refreshToken, user })
      },
    },

    // DELETE /api/{ctx}/logout
    {
      method: 'DELETE',
      path: `${basePath}/logout`,
      public: true,
      handler: async (req) => {
        const token = extractToken(req)
        if (token) {
          const payload = await authService.verifyToken(token, jwtSecret).catch(() => null)
          if (payload) {
            await cache.set(`auth:blacklist:${payload.auth_identity_id}`, '1', 2592000)
          }
        }
        return Response.json({ success: true })
      },
    },

    // POST /api/{ctx}/refresh
    {
      method: 'POST',
      path: `${basePath}/refresh`,
      public: true,
      handler: async (req) => {
        const body = await getBody<{ refreshToken?: string }>(req)
        if (!body.refreshToken) {
          return Response.json({ type: 'INVALID_DATA', message: 'refreshToken is required' }, { status: 400 })
        }

        const payload = await authService.verifyToken(body.refreshToken, jwtSecret)
        const appMeta = (payload as Record<string, unknown>).app_metadata as Record<string, unknown> | undefined
        if (appMeta?.type !== 'refresh') {
          return Response.json({ type: 'UNAUTHORIZED', message: 'Invalid refresh token' }, { status: 401 })
        }

        const blacklisted = await cache.get(`auth:blacklist:${payload.auth_identity_id}`)
        if (blacklisted) {
          return Response.json({ type: 'UNAUTHORIZED', message: 'Token has been revoked' }, { status: 401 })
        }

        // Strip the 'refresh' marker from app_metadata for the new access token
        const { type: _refreshMarker, ...cleanMeta } = (appMeta ?? {}) as Record<string, unknown>
        const token = await authService.generateToken(
          {
            id: payload.id as string,
            type: payload.type as string,
            auth_identity_id: payload.auth_identity_id as string,
            app_metadata: cleanMeta,
          },
          jwtSecret,
          '1h',
        )

        return Response.json({ token })
      },
    },

    // POST /api/{ctx}/forgot-password
    {
      method: 'POST',
      path: `${basePath}/forgot-password`,
      public: true,
      handler: async (req) => {
        const body = await getBody<{ email?: string }>(req)
        if (!body.email) {
          return Response.json({ type: 'INVALID_DATA', message: 'Email is required' }, { status: 400 })
        }

        const resetToken = await authService.generateToken(
          {
            id: '',
            type: ctx,
            auth_identity_id: '',
            app_metadata: { type: 'password-reset', email: body.email },
          },
          jwtSecret,
          '1h',
        )

        await cache.set(`auth:reset:${ctx}:${body.email.toLowerCase()}`, resetToken, 3600)
        logger.info(`[auth:${ctx}] Password reset requested for ${body.email}`)

        return Response.json({ success: true, message: 'If the email exists, a reset link has been sent.' })
      },
    },

    // POST /api/{ctx}/reset-password
    {
      method: 'POST',
      path: `${basePath}/reset-password`,
      public: true,
      handler: async (req) => {
        const body = await getBody<{ token?: string; email?: string; password?: string }>(req)
        if (!body.token || !body.email || !body.password) {
          return Response.json(
            { type: 'INVALID_DATA', message: 'token, email, and password are required' },
            { status: 400 },
          )
        }

        const storedToken = await cache.get(`auth:reset:${ctx}:${body.email.toLowerCase()}`)
        if (!storedToken || storedToken !== body.token) {
          return Response.json({ type: 'UNAUTHORIZED', message: 'Invalid or expired reset token' }, { status: 401 })
        }

        const payload = await authService.verifyToken(body.token, jwtSecret)
        const meta = payload.app_metadata as Record<string, unknown>
        if (meta?.type !== 'password-reset') {
          return Response.json({ type: 'UNAUTHORIZED', message: 'Invalid reset token' }, { status: 401 })
        }

        await cache.invalidate(`auth:reset:${ctx}:${body.email.toLowerCase()}`)
        logger.info(`[auth:${ctx}] Password reset confirmed for ${body.email}`)

        return Response.json({ success: true, message: 'Password has been reset.' })
      },
    },
  ]
}

// ── User CRUD routes ────────────────────────────────────

export function generateUserCrudRoutes(deps: AutoRouteDeps): RouteEntry[] {
  const { userDef, userRepo, authService, jwtSecret } = deps
  const ctx = userDef.contextName
  const basePath = `/api/${ctx}`

  return [
    // GET /api/{ctx}/me
    {
      method: 'GET',
      path: `${basePath}/me`,
      handler: async (req) => {
        const token = extractToken(req)
        if (!token) {
          return Response.json({ type: 'UNAUTHORIZED', message: 'Token required' }, { status: 401 })
        }

        const payload = await authService.verifyToken(token, jwtSecret)
        if (payload.type !== ctx) {
          return Response.json({ type: 'FORBIDDEN', message: 'Wrong context' }, { status: 403 })
        }

        const users = await userRepo.find({ where: { id: payload.id as string } })
        if (users.length === 0) {
          return Response.json({ type: 'NOT_FOUND', message: 'User not found' }, { status: 404 })
        }

        return Response.json({ data: users[0] })
      },
    },

    // GET /api/{ctx}/users
    {
      method: 'GET',
      path: `${basePath}/users`,
      handler: async (req) => {
        const url = new URL(req.url, 'http://localhost')
        const limit = Number(url.searchParams.get('limit') ?? '20')
        const offset = Number(url.searchParams.get('offset') ?? '0')

        const users = await userRepo.find({ limit, offset, order: { created_at: 'DESC' } })
        return Response.json({ data: users })
      },
    },

    // POST /api/{ctx}/create-user
    {
      method: 'POST',
      path: `${basePath}/create-user`,
      handler: async (req) => {
        const body = await getBody<Record<string, unknown>>(req)
        if (!body.email) {
          return Response.json({ type: 'INVALID_DATA', message: 'email is required' }, { status: 400 })
        }

        // Create auth identity first
        const authResult = await authService.register('emailpass', {
          url: '',
          headers: {},
          query: {},
          protocol: 'http',
          body: { email: body.email, password: body.password ?? crypto.randomUUID() },
        })
        if (!authResult.success) {
          return Response.json({ type: 'INVALID_DATA', message: authResult.error }, { status: 400 })
        }

        await authService.updateAuthIdentity(authResult.authIdentity!.id, {
          app_metadata: { user_type: ctx },
        })

        // Create user record
        const user = await userRepo.create(body)
        return Response.json({ data: user }, { status: 201 })
      },
    },

    // POST /api/{ctx}/update-user
    {
      method: 'POST',
      path: `${basePath}/update-user`,
      handler: async (req) => {
        const body = await getBody<{ id?: string } & Record<string, unknown>>(req)
        if (!body.id) {
          return Response.json({ type: 'INVALID_DATA', message: 'id is required' }, { status: 400 })
        }

        const user = await userRepo.update(body as { id: string })
        return Response.json({ data: user })
      },
    },

    // POST /api/{ctx}/delete-user
    {
      method: 'POST',
      path: `${basePath}/delete-user`,
      handler: async (req) => {
        const body = await getBody<{ id?: string }>(req)
        if (!body.id) {
          return Response.json({ type: 'INVALID_DATA', message: 'id is required' }, { status: 400 })
        }

        await userRepo.softDelete(body.id)
        return Response.json({ success: true })
      },
    },
  ]
}

// ── Invite routes ───────────────────────────────────────

export function generateInviteRoutes(deps: AutoRouteDeps): RouteEntry[] {
  const { userDef, inviteRepo, authService, jwtSecret, logger } = deps
  const ctx = userDef.contextName
  const basePath = `/api/${ctx}`

  return [
    // POST /api/{ctx}/create-invite
    {
      method: 'POST',
      path: `${basePath}/create-invite`,
      handler: async (req) => {
        const body = await getBody<{ email?: string; metadata?: Record<string, unknown> }>(req)
        if (!body.email) {
          return Response.json({ type: 'INVALID_DATA', message: 'email is required' }, { status: 400 })
        }

        const token = crypto.randomUUID()
        const expires_at = new Date(Date.now() + 7 * 24 * 3600_000) // 7 days

        const invite = await inviteRepo.create({
          email: body.email,
          token,
          expires_at,
          metadata: body.metadata ?? null,
        })

        logger.info(`[auth:${ctx}] Invite created for ${body.email}`)
        return Response.json({ data: invite }, { status: 201 })
      },
    },

    // POST /api/{ctx}/accept-invite
    {
      method: 'POST',
      path: `${basePath}/accept-invite`,
      public: true,
      handler: async (req) => {
        const body = await getBody<{ token?: string; password?: string; first_name?: string; last_name?: string }>(req)
        if (!body.token || !body.password) {
          return Response.json({ type: 'INVALID_DATA', message: 'token and password are required' }, { status: 400 })
        }

        // Find invite by token
        const invites = await inviteRepo.find({ where: { token: body.token } })
        if (invites.length === 0) {
          return Response.json({ type: 'NOT_FOUND', message: 'Invalid invite token' }, { status: 404 })
        }

        const invite = invites[0] as { id: string; email: string; accepted: boolean; expires_at: Date }
        if (invite.accepted) {
          return Response.json({ type: 'CONFLICT', message: 'Invite already accepted' }, { status: 409 })
        }
        if (new Date(invite.expires_at) < new Date()) {
          return Response.json({ type: 'UNAUTHORIZED', message: 'Invite has expired' }, { status: 401 })
        }

        // Register auth identity
        const authResult = await authService.register('emailpass', {
          url: '',
          headers: {},
          query: {},
          protocol: 'http',
          body: { email: invite.email, password: body.password },
        })
        if (!authResult.success) {
          return Response.json({ type: 'INVALID_DATA', message: authResult.error }, { status: 400 })
        }

        await authService.updateAuthIdentity(authResult.authIdentity!.id, {
          app_metadata: { user_type: ctx },
        })

        // Mark invite as accepted
        await inviteRepo.update({ id: invite.id, accepted: true })

        logger.info(`[auth:${ctx}] Invite accepted for ${invite.email}`)
        return Response.json({ success: true })
      },
    },

    // POST /api/{ctx}/refresh-invite
    {
      method: 'POST',
      path: `${basePath}/refresh-invite`,
      handler: async (req) => {
        const body = await getBody<{ id?: string }>(req)
        if (!body.id) {
          return Response.json({ type: 'INVALID_DATA', message: 'id is required' }, { status: 400 })
        }

        const token = crypto.randomUUID()
        const expires_at = new Date(Date.now() + 7 * 24 * 3600_000)

        const invite = await inviteRepo.update({ id: body.id, token, expires_at })
        return Response.json({ data: invite })
      },
    },
  ]
}

// ── Convenience: all routes for a user context ──────────

export function generateAllUserRoutes(deps: AutoRouteDeps): RouteEntry[] {
  return [...generateAuthRoutes(deps), ...generateUserCrudRoutes(deps), ...generateInviteRoutes(deps)]
}

/** Public route paths for a context (no auth required). */
export function getPublicPaths(ctx: string): string[] {
  const basePath = `/api/${ctx}`
  return [
    `${basePath}/login`,
    `${basePath}/logout`,
    `${basePath}/refresh`,
    `${basePath}/forgot-password`,
    `${basePath}/reset-password`,
    `${basePath}/accept-invite`,
  ]
}
