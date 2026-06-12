import { loadSystemDashboardData } from '../../../../queries/admin/system-dashboard'
import { type AdminApiRequest, dbFrom, requireAdmin } from '../../../admin/api/_shared'

export async function GET(req: AdminApiRequest) {
  const unauthorized = await requireAdmin(req)
  if (unauthorized) return unauthorized

  const data = await loadSystemDashboardData(dbFrom(req))
  return Response.json({ data })
}
