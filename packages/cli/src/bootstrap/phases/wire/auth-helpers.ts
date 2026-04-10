// Shared auth helpers for wire-phase route handlers.
// Extracted from the duplicated Bearer-token parsing blocks in cqrs-routes
// and query-endpoints (previously marked [13e], [13f], [13g]).

import type { AuthContext } from '@manta/core'
import type { BootstrapContext } from '../../bootstrap-context'

/**
 * Parse a `Bearer <token>` authorization header and verify it through the
 * bootstrap's AuthModuleService. Returns the verified AuthContext or `null`
 * if the header is absent or the token fails verification.
 *
 * Mirrors the original inline blocks verbatim: no header → null, bad token →
 * null (error swallowed), no exceptions propagated to the caller.
 */
export async function parseBearer(ctx: BootstrapContext, req: Request): Promise<AuthContext | null> {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return null
  try {
    const payload = await ctx.authService.verifyToken(token, ctx.jwtSecret)
    return payload as unknown as AuthContext
  } catch {
    return null
  }
}
