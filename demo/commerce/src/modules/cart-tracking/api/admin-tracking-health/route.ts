import { loadTrackingHealthData } from '../../../../queries/admin/tracking-health'
import { type AdminApiRequest, dbFrom, requireAdmin } from '../../../admin/api/_shared'

export async function GET(req: AdminApiRequest) {
  const unauthorized = await requireAdmin(req)
  if (unauthorized) return unauthorized

  const url = new URL(req.url)
  const data = await loadTrackingHealthData(
    {
      hours: clampInt(url.searchParams.get('hours'), 4, 1, 24),
      limit: clampInt(url.searchParams.get('limit'), 50, 1, 200),
      offset: clampInt(url.searchParams.get('offset'), 0, 0, 100_000),
      event_name: url.searchParams.get('event_name') ?? undefined,
    },
    dbFrom(req),
  )
  return Response.json({ data })
}

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = value == null ? fallback : Number(value)
  if (!Number.isInteger(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}
