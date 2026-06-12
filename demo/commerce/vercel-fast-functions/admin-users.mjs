import { clampInt, db, iso, json, nowMs, requireAdmin, timingHeader, unauthorized } from './runtime.mjs'

export default {
  async fetch(req) {
    const started = nowMs()
    const auth = requireAdmin(req)
    if (!auth) return unauthorized()
    const authDone = nowMs()
    const url = new URL(req.url)
    const limit = clampInt(url.searchParams.get('limit'), 100, 1, 500)
    const rows = await db().unsafe(
      `SELECT id, email, first_name, last_name, role, created_at
         FROM admins
        WHERE deleted_at IS NULL
        ORDER BY email ASC
        LIMIT $1`,
      [limit],
    )
    const dbDone = nowMs()
    const data = rows.map((row) => ({
      id: row.id,
      email: row.email,
      first_name: row.first_name,
      last_name: row.last_name,
      role: row.role,
      created_at: row.created_at ? iso(row.created_at) : null,
    }))
    const done = nowMs()
    return json(
      { data },
      {
        headers: {
          'server-timing': timingHeader({
            auth: authDone - started,
            query: dbDone - authDone,
            serialize: done - dbDone,
            total: done - started,
          }),
        },
      },
    )
  },
}
