import { loadDashboard, rangeFromUrl } from './abandoned-cart-campaign-common.mjs'
import { json, nowMs, requireAdmin, timingHeader, unauthorized } from './runtime.mjs'

export default {
  async fetch(req) {
    const started = nowMs()
    const auth = requireAdmin(req)
    if (!auth) return unauthorized()
    const authDone = nowMs()

    const parsed = rangeFromUrl(req)
    if (parsed.error) return json(parsed.error, { status: 400 })

    const data = await loadDashboard(parsed.from, parsed.to)
    const queryDone = nowMs()

    return json(
      { data },
      {
        headers: {
          'server-timing': timingHeader({
            auth: authDone - started,
            query: queryDone - authDone,
            total: queryDone - started,
          }),
        },
      },
    )
  },
}
