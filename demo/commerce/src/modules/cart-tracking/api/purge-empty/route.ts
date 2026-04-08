export async function POST(req: Request & { app?: any }) {
  const db = req.app?.resolve?.('IDatabasePort')
  const pool = db?.getPool?.()
  if (!pool) {
    return new Response(JSON.stringify({ error: 'No DB pool' }), { status: 500 })
  }

  try {
    const pg = pool as { unsafe: (q: string) => Promise<any[]> }

    // Delete events for empty carts, then delete the carts
    const result = await pg.unsafe(`
      WITH empty_carts AS (
        SELECT id FROM carts WHERE item_count = 0 OR item_count IS NULL
      ),
      deleted_events AS (
        DELETE FROM cart_events WHERE cart_id IN (SELECT id FROM empty_carts)
        RETURNING id
      ),
      deleted_carts AS (
        DELETE FROM carts WHERE id IN (SELECT id FROM empty_carts)
        RETURNING id
      )
      SELECT
        (SELECT COUNT(*) FROM deleted_carts) AS carts_deleted,
        (SELECT COUNT(*) FROM deleted_events) AS events_deleted
    `)

    const stats = result[0] ?? { carts_deleted: 0, events_deleted: 0 }
    console.log(`[cart-tracking] Purged ${stats.carts_deleted} empty carts, ${stats.events_deleted} events`)

    return new Response(JSON.stringify(stats), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[cart-tracking] Purge error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 })
  }
}
