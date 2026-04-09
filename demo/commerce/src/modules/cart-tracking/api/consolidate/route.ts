export async function POST(req: Request & { app?: any }) {
  const db = req.app?.resolve?.('IDatabasePort')
  const pool = db?.getPool?.()
  if (!pool) {
    return new Response(JSON.stringify({ error: 'No DB pool' }), { status: 500 })
  }

  try {
    const pg = pool as { unsafe: (q: string) => Promise<any[]> }

    // Find duplicate carts: same distinct_id with multiple entries.
    // For each group, keep the one with the most events (= the real cart_token),
    // move events from the others, merge identity, delete duplicates.
    const duplicates = await pg.unsafe(`
      SELECT distinct_id, array_agg(id ORDER BY updated_at DESC) AS cart_ids,
             array_agg(cart_token ORDER BY updated_at DESC) AS tokens,
             COUNT(*) AS cnt
      FROM carts
      WHERE distinct_id IS NOT NULL
      GROUP BY distinct_id
      HAVING COUNT(*) > 1
    `)

    if (duplicates.length === 0) {
      return new Response(JSON.stringify({ consolidated: 0, events_moved: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    let totalMerged = 0
    let totalEventsMoved = 0

    for (const group of duplicates) {
      const cartIds = group.cart_ids as string[]
      const keepId = cartIds[0] // most recently updated = main cart

      for (let i = 1; i < cartIds.length; i++) {
        const orphanId = cartIds[i]
        const esc = (v: string) => v.replace(/'/g, "''")

        // Move events from orphan to keeper
        await pg.unsafe(`UPDATE cart_events SET cart_id = '${esc(keepId)}' WHERE cart_id = '${esc(orphanId)}'`)

        // Merge identity and checkout info from orphan into keeper
        await pg.unsafe(`
          UPDATE carts SET
            email = COALESCE(carts.email, o.email),
            first_name = COALESCE(carts.first_name, o.first_name),
            last_name = COALESCE(carts.last_name, o.last_name),
            phone = COALESCE(carts.phone, o.phone),
            city = COALESCE(carts.city, o.city),
            country_code = COALESCE(carts.country_code, o.country_code),
            shopify_customer_id = COALESCE(carts.shopify_customer_id, o.shopify_customer_id),
            checkout_token = COALESCE(carts.checkout_token, o.checkout_token),
            shopify_order_id = COALESCE(carts.shopify_order_id, o.shopify_order_id),
            highest_stage = CASE
              WHEN array_position(ARRAY['cart','checkout_started','checkout_engaged','payment_attempted','completed'], carts.highest_stage)
                 >= array_position(ARRAY['cart','checkout_started','checkout_engaged','payment_attempted','completed'], o.highest_stage)
              THEN carts.highest_stage ELSE o.highest_stage END,
            updated_at = NOW()
          FROM carts o
          WHERE carts.id = '${esc(keepId)}' AND o.id = '${esc(orphanId)}'
        `)

        // Delete orphan
        await pg.unsafe(`DELETE FROM cart_events WHERE cart_id = '${esc(orphanId)}'`)
        await pg.unsafe(`DELETE FROM carts WHERE id = '${esc(orphanId)}'`)

        totalMerged++
      }
    }

    console.log(`[cart-tracking] Consolidated ${totalMerged} duplicate carts`)

    return new Response(JSON.stringify({ consolidated: totalMerged, groups: duplicates.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[cart-tracking] Consolidate error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 })
  }
}
