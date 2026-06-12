import { listInputFromUrl, loadMessageList } from './abandoned-cart-campaign-common.mjs'
import { json, nowMs, requireAdmin, timingHeader, unauthorized } from './runtime.mjs'

export default {
  async fetch(req) {
    const started = nowMs()
    const auth = requireAdmin(req)
    if (!auth) return unauthorized()
    const authDone = nowMs()

    const input = listInputFromUrl(req)
    if (input.error) return json(input.error, { status: 400 })

    const data = await loadMessageList(input)
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
