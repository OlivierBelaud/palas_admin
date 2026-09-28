import { ControlInputError, parseControlRequest } from '../../../tracking-control/local-query'
import { loadTrackingControl } from '../../../tracking-control/loader'
import { type AdminApiRequest, dbFrom, requireAdmin } from '../_shared'

export async function GET(req: AdminApiRequest) {
  const unauthorized = await requireAdmin(req)
  if (unauthorized) return unauthorized
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    const input = parseControlRequest(new URL(req.url).searchParams)
    return Response.json({ data: await loadTrackingControl(input, dbFrom(req)) }, { headers })
  } catch (error) {
    if (error instanceof ControlInputError) {
      return Response.json({ message: error.message }, { status: 400, headers })
    }
    // Database errors can include connection credentials; never forward them.
    return Response.json(
      { message: 'Contrôle indisponible. Réessayez dans quelques instants.' },
      { status: 503, headers },
    )
  }
}
