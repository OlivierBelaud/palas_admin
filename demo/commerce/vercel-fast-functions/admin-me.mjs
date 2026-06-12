import { db, json, nowMs, requireAdmin, timingHeader, unauthorized } from './runtime.mjs'

export default {
  async fetch(req) {
    const started = nowMs()
    const auth = requireAdmin(req)
    if (!auth?.id) return unauthorized()
    const authDone = nowMs()

    const rows = await db().unsafe(
      `SELECT id, first_name, last_name, email, avatar_url, metadata, role,
              created_at, updated_at, deleted_at
         FROM admins
        WHERE id = $1
          AND deleted_at IS NULL
        LIMIT 1`,
      [auth.id],
    )
    const queryDone = nowMs()
    const admin = rows[0]
    if (!admin) return unauthorized()

    return json(
      { data: admin },
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
